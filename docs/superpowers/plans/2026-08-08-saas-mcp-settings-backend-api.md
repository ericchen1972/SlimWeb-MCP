# SaaS MCP Settings Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move SaaS MCP site identity resolution and basic-settings reads/writes, including website-name updates, from direct PostgreSQL access to a versioned Webless Laravel API without changing any public MCP tool contract.

**Architecture:** Webless exposes protected `/internal/mcp/v1` endpoints that authenticate the MCP service and independently resolve the Google actor, site membership, and permissions. A new Node `WeblessBackendClient` implements the first methods of the `SlimWebBackend` interface; `WeblessAccountRepository` temporarily delegates only the migrated methods to that client while all other tool domains continue through the legacy repository until their own migration plans pass.

**Tech Stack:** Node.js 20, native Fetch/Undici, Node test runner, Laravel/PHP, Eloquent, PHPUnit, PostgreSQL, Cloud Run.

---

## Scope and file map

This plan is the first independently deployable slice of the approved SaaS design. It migrates these repository methods:

- `listSitesForAdminIdentity`
- `resolveAdminSiteForIdentity`
- `getBasicSettings`
- `updateBasicSettings`

`listAdminSitesForGoogleProfile` and `selectSiteForAdminIdentity` retain their public behavior but automatically use the migrated identity methods through normal method dispatch. The other MCP domains remain on the current repository during this slice.

### SlimWeb-MCP files

- Create `src/backends/slimWebBackend.js`: interface method list and runtime interface assertion.
- Create `src/backends/weblessBackendClient.js`: authenticated HTTP implementation and stable backend errors.
- Modify `src/weblessRepository.js`: delegate the four migrated methods when a backend client is configured.
- Modify `src/app.js`: construct and inject the backend client from explicit SaaS environment configuration.
- Create `test/weblessBackendClient.test.js`: HTTP mapping, headers, response envelope, error, timeout, and idempotency tests.
- Modify `test/weblessRepository.test.js`: prove migrated methods do not call the PostgreSQL pool.
- Modify `test/app.test.js`: freeze the 125-tool discovery contract and verify end-to-end tool mapping.
- Modify `.github/workflows/deploy.yml`: provide the Webless Backend API base URL; retain DB/storage variables until later domains migrate.
- Modify `README.md`: document the temporary mixed migration state accurately.

### Webless files

- Create `app/Services/Mcp/McpActorResolver.php`: authoritative Google identity, membership, system-admin, and permission resolution.
- Create `app/Support/McpApiResponse.php`: stable success/error envelopes.
- Create `app/Support/McpApiExceptionRenderer.php`: convert Laravel exceptions into stable backend error envelopes.
- Create `app/Http/Controllers/Internal/McpV1/SiteContextController.php`: version, site list, and site resolution endpoints.
- Create `app/Http/Controllers/Internal/McpV1/BasicSettingsController.php`: settings read and patch operations.
- Create `app/Models/McpIdempotencyKey.php`: persisted write-replay record.
- Create `app/Services/Mcp/McpIdempotencyStore.php`: transactional idempotency-key execution.
- Create `database/migrations/2026_08_08_120000_create_mcp_idempotency_keys_table.php`: shared Cloud Run idempotency storage.
- Create `app/Http/Middleware/AttachMcpRequestContext.php`: require/copy request ID and bind safe audit context.
- Modify `routes/web.php`: register `/internal/mcp/v1` routes behind existing service-secret middleware and request-context middleware.
- Modify `bootstrap/app.php`: exempt only the protected versioned MCP API prefix from browser CSRF validation.
- Create `tests/Feature/McpV1SiteContextTest.php`: service authentication, identity, permissions, and tenant isolation.
- Create `tests/Unit/McpActorResolverTest.php`: direct actor-resolution and permission tests.
- Create `tests/Feature/McpV1BasicSettingsTest.php`: read, patch, website-name, removed-field compatibility, idempotency, and logo behavior.
- Modify `.env.example`: document the shared service secret already used by the bridge.
- Modify `DB_SCHEMA.md`: document the `mcp_idempotency_keys` table and its retention purpose.

## Task 1: Freeze the public MCP contract

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`

- [ ] **Step 1: Add a failing tools-list contract assertion**

Import `createHash` from `node:crypto`, then add this assertion to the existing unauthenticated `tools/list` test after `body.result.tools` is available:

```js
const toolsContractHash = createHash('sha256')
  .update(JSON.stringify(body.result.tools))
  .digest('hex');

assert.equal(body.result.tools.length, 125);
assert.equal(
  toolsContractHash,
  'd6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871'
);
```

- [ ] **Step 2: Run the focused test and confirm the import is initially missing**

Run: `node --test --test-name-pattern='lists MCP tools' test/app.test.js`

Expected: FAIL with `createHash is not defined` before the import is added.

- [ ] **Step 3: Add the exact import**

```js
import { createHash } from 'node:crypto';
```

- [ ] **Step 4: Run the focused and complete MCP tests**

Run: `node --test --test-name-pattern='lists MCP tools' test/app.test.js`

Expected: PASS and report 125 tools.

Run: `npm test`

Expected: all current Node tests PASS.

- [ ] **Step 5: Commit the contract freeze**

```bash
git add test/app.test.js
git commit -m "test: freeze SaaS MCP tool contract"
```

## Task 2: Add authoritative Webless MCP actor resolution

**Files:**
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/McpActorResolver.php`
- Create: `/Users/eric/Documents/webless/app/Support/McpApiResponse.php`
- Create: `/Users/eric/Documents/webless/app/Http/Middleware/AttachMcpRequestContext.php`
- Create: `/Users/eric/Documents/webless/app/Support/McpApiExceptionRenderer.php`
- Test: `/Users/eric/Documents/webless/tests/Unit/McpActorResolverTest.php`

- [ ] **Step 1: Write failing direct identity and tenant-isolation tests**

Create fixtures with two sites and admins, construct Laravel requests carrying the actor headers, then cover these exact cases:

```php
public function test_actor_can_list_only_sites_with_backend_ai_permission(): void
{
    [$allowed, $denied] = $this->createActorSites();
    $request = $this->actorRequest();

    $sites = app(McpActorResolver::class)->sitesFor($request);

    $this->assertCount(1, $sites);
    $this->assertTrue($sites->first()['site']->is($allowed));
    $this->assertFalse($sites->contains(fn (array $item): bool => $item['site']->is($denied)));
}

public function test_actor_cannot_resolve_another_merchants_site(): void
{
    [, , $foreign] = $this->createActorSites();
    $request = $this->actorRequest();

    $this->expectException(HttpException::class);
    $this->expectExceptionMessage('Site not found or not accessible.');

    app(McpActorResolver::class)->resolve($request, $foreign);
}
```

`actorRequest()` uses `Request::create()` and sets actor sub/email, tool name, required permission, and a fixed request ID. Add separate direct tests for blank actor identity (422), a matching admin without `backend_ai_assistant` (404), missing endpoint permission (403), and first-admin `system_admin` synthesis.

- [ ] **Step 2: Run the unit test and verify the resolver is absent**

Run: `php artisan test tests/Unit/McpActorResolverTest.php`

Expected: FAIL because `McpActorResolver` does not exist.

- [ ] **Step 3: Implement the actor resolver**

`McpActorResolver` must expose these exact methods:

```php
/** @return Collection<int, array{admin: SiteAdmin, site: Site, permissions: array<int,string>}> */
public function sitesFor(Request $request): Collection;

/** @param array<int,string> $requiredPermissions */
public function resolve(Request $request, Site $site, array $requiredPermissions = []): array;

/** @return array{sub:string,email:string} */
private function identity(Request $request): array;

/** @return array<int,string> */
private function permissionsFor(SiteAdmin $admin): array;
```

Identity matching must use nonblank `X-SlimWeb-Actor-Sub` or case-insensitive `X-SlimWeb-Actor-Email`. `sitesFor()` excludes admins lacking both `backend_ai_assistant` and `system_admin`. `permissionsFor()` adds `system_admin` only when the admin is the site's lowest-ID admin. `resolve()` returns 404 when the identity does not match the selected site's admin and 403 when a required endpoint permission is absent.

- [ ] **Step 4: Implement the response and request-context helpers**

`McpApiResponse` must provide:

```php
public static function success(array $data, int $status = 200, array $warnings = [], ?string $auditId = null): JsonResponse;
public static function error(string $code, string $message, int $status, array $details = []): JsonResponse;
```

`AttachMcpRequestContext` must accept `X-Request-Id` matching `[A-Za-z0-9._:-]{8,128}` or generate a UUID, store it as request attribute `mcp_request_id`, and add it to the response header. It must never log the service secret or Google subject.

`McpApiExceptionRenderer` is registered through `bootstrap/app.php` `withExceptions()->render()` only for `internal/mcp/v1/*`. Laravel 12's routing pipeline renders downstream exceptions before an outer route middleware can catch them, so the global path-scoped renderer maps `ValidationException` to 422 `VALIDATION_FAILED`, authorization failures to 403 `FORBIDDEN`, missing models/resources to 404 `NOT_FOUND`, conflicts to 409 `CONFLICT`, throttling to 429 `RATE_LIMITED`, and unexpected exceptions to 500 `INTERNAL_ERROR`. Validation details may include field names/messages; stack traces, SQL, secrets, Google subjects, and credentials must not enter the response.

- [ ] **Step 5: Run the resolver tests**

Run: `php artisan test tests/Unit/McpActorResolverTest.php`

Expected: all identity, membership, system-admin, and permission tests PASS.

- [ ] **Step 6: Commit the actor boundary**

```bash
git add app/Services/Mcp/McpActorResolver.php app/Support/McpApiResponse.php app/Support/McpApiExceptionRenderer.php app/Http/Middleware/AttachMcpRequestContext.php bootstrap/app.php tests/Unit/McpActorResolverTest.php
git commit -m "feat: add MCP actor authorization boundary"
```

## Task 3: Expose versioned site-context endpoints

**Files:**
- Create: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/SiteContextController.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/webless/bootstrap/app.php`
- Test: `/Users/eric/Documents/webless/tests/Feature/McpV1SiteContextTest.php`

- [ ] **Step 1: Add failing version and selector tests**

Add tests for `GET /internal/mcp/v1/version`, resolving by `site_code`, resolving by legacy `site_id`, rejecting a request containing neither selector, rejecting a missing service secret with the stable error envelope, and confirming POST is not rejected by CSRF after valid service authentication. Assert the response contains this stable data:

```php
[
    'contract' => 'slimweb-backend',
    'major' => 1,
    'capabilities' => [
        'site_context',
        'basic_settings_read',
        'basic_settings_write',
    ],
]
```

- [ ] **Step 2: Run the test and verify the controller is absent**

Run: `php artisan test tests/Feature/McpV1SiteContextTest.php`

Expected: FAIL on the version and endpoint assertions.

- [ ] **Step 3: Implement `SiteContextController`**

The controller must expose `version()`, `index(Request, McpActorResolver)`, and `resolve(Request, McpActorResolver)`. `resolve()` validates exactly one of `site_code` or integer `site_id`, looks up the `Site`, calls the actor resolver, and returns:

```php
McpApiResponse::success([
    'actor' => [
        'account_id' => $site->account_id,
        'site_admin_id' => $context['admin']->id,
        'site_id' => $site->id,
        'permissions' => $context['permissions'],
    ],
    'site' => [
        'site_id' => $site->id,
        'site_code' => $site->callback_code,
        'slug' => $site->slug,
        'name' => $site->name,
        'domain' => $site->domain,
        'account_id' => $site->account_id,
        'site_status' => $site->site_status ?: 'active',
        'theme_mode' => $site->theme_mode ?: 'light',
    ],
]);
```

The site list uses the same field names and includes `permissions` for each entry.

- [ ] **Step 4: Register the versioned routes**

Add controller imports and this route group outside browser-session middleware:

```php
Route::prefix('internal/mcp/v1')
    ->middleware([AttachMcpRequestContext::class, EnsureMcpInternalRequest::class])
    ->group(function (): void {
        Route::get('/version', [McpV1SiteContextController::class, 'version']);
        Route::get('/sites', [McpV1SiteContextController::class, 'index']);
        Route::post('/site-context/resolve', [McpV1SiteContextController::class, 'resolve']);
    });
```

Add `internal/mcp/v1/*` to the existing `validateCsrfTokens(except: [...])` list in `bootstrap/app.php`. Do not broaden the exception to all internal routes; `EnsureMcpInternalRequest` remains mandatory for every route in this group.

- [ ] **Step 5: Run the complete site-context feature test**

Run: `php artisan test tests/Feature/McpV1SiteContextTest.php`

Expected: all site list, selector, permission, tenant-isolation, request-ID, and version tests PASS.

- [ ] **Step 6: Commit the site-context API**

```bash
git add app/Http/Controllers/Internal/McpV1/SiteContextController.php routes/web.php bootstrap/app.php tests/Feature/McpV1SiteContextTest.php
git commit -m "feat: expose MCP site context API"
```

## Task 4: Expose basic-settings read and patch endpoints

**Files:**
- Create: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/BasicSettingsController.php`
- Create: `/Users/eric/Documents/webless/app/Models/McpIdempotencyKey.php`
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/McpIdempotencyStore.php`
- Create: `/Users/eric/Documents/webless/database/migrations/2026_08_08_120000_create_mcp_idempotency_keys_table.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/webless/DB_SCHEMA.md`
- Test: `/Users/eric/Documents/webless/tests/Feature/McpV1BasicSettingsTest.php`

- [ ] **Step 1: Write failing settings feature tests**

Cover exact patch semantics: omitted fields remain unchanged; a trimmed `name` updates only `sites.name`; blank or 256-character names return `VALIDATION_FAILED`; invalid enum values return 422; the source-of-truth migration that removed `member_verification` is respected and writes to that absent column return `VALIDATION_FAILED`; a foreign actor is rejected; a repeated request with the same `Idempotency-Key` produces the same response without a second model update; logo `media_path` and `svg_base64` continue through `SiteLogoManager`.

The name test must assert immutable identifiers:

```php
$response = $this->withHeaders($this->mcpHeaders('slimweb_settings_update', 'basic_settings'))
    ->patchJson("/internal/mcp/v1/sites/{$site->callback_code}/settings/basic", [
        'name' => '  新的網站名稱  ',
    ]);

$response->assertOk()
    ->assertJsonPath('data.settings.name', '新的網站名稱')
    ->assertJsonPath('data.site.slug', $site->slug)
    ->assertJsonPath('data.site.site_code', $site->callback_code);

$this->assertDatabaseHas('sites', [
    'id' => $site->id,
    'name' => '新的網站名稱',
    'slug' => $site->slug,
    'callback_code' => $site->callback_code,
    'domain' => $site->domain,
]);
```

- [ ] **Step 2: Run the test and confirm both settings routes are absent**

Run: `php artisan test tests/Feature/McpV1BasicSettingsTest.php`

Expected: FAIL with 404 for GET/PATCH settings routes.

- [ ] **Step 3: Add shared PostgreSQL idempotency storage**

Create `mcp_idempotency_keys` with this exact migration shape:

```php
Schema::create('mcp_idempotency_keys', function (Blueprint $table): void {
    $table->id();
    $table->foreignId('site_id')->constrained()->cascadeOnDelete();
    $table->string('operation', 100);
    $table->string('idempotency_key', 128);
    $table->char('request_hash', 64);
    $table->unsignedSmallInteger('response_status')->nullable();
    $table->json('response_body')->nullable();
    $table->timestamp('completed_at')->nullable();
    $table->timestamps();
    $table->unique(['site_id', 'operation', 'idempotency_key'], 'mcp_idempotency_scope_unique');
    $table->index('created_at');
});
```

The model casts `response_body` to `array` and `completed_at` to `datetime`. `McpIdempotencyStore::run()` accepts `Site $site`, operation, key, request payload, and a closure. It calculates SHA-256 from canonical JSON, uses `firstOrCreate()` followed by `lockForUpdate()` inside `DB::transaction()`, returns the stored response when completed, and stores the successful response before commit. A reused key with a different hash throws an `HttpResponseException` containing HTTP 409 and `IDEMPOTENCY_CONFLICT`.

Update `DB_SCHEMA.md` with the table columns, unique scope, foreign key, and the operational rule that records older than 24 hours may be pruned only after all in-flight retries have expired.

- [ ] **Step 4: Implement the controller read path**

`show()` resolves the actor with `basic_settings`, then returns `site` plus `settings`. Settings must use the current MCP snake_case fields: `name`, `site_status`, `member_verification`, `website_type`, `default_country_code`, `product_load_mode`, `return_days_allowed`, `category_navigation_mode`, `logo`, and `client_mcp_url`. Logo URLs must be generated by Webless from `icon_path`; Node must not construct storage URLs.

- [ ] **Step 5: Implement transactional patch semantics**

`update()` must:

1. require `Idempotency-Key` matching `[A-Za-z0-9._:-]{8,128}`;
2. resolve the actor with `basic_settings`;
3. validate only submitted fields with the same enums and limits as the MCP schema;
4. trim `name`, reject empty/over-255 values, and never modify slug, callback code, or domain;
5. return `VALIDATION_FAILED` for `member_verification` writes while the authoritative `sites` schema does not contain that retired column;
6. call `SiteLogoManager` for exactly one logo source;
7. execute the save and logo replacement through `McpIdempotencyStore::run()`;
8. return the same shape as `show()` with `ok: true` inside `data`.

The operation string is `basic_settings.update`. Persist the complete `data` object so replay returns the same public result. Delete no idempotency record on a successful response; failed transactions roll back the pending record so a corrected retry can execute.

- [ ] **Step 6: Register the settings routes**

Inside the existing `/internal/mcp/v1` group add:

```php
Route::get('/sites/{site:callback_code}/settings/basic', [McpV1BasicSettingsController::class, 'show']);
Route::patch('/sites/{site:callback_code}/settings/basic', [McpV1BasicSettingsController::class, 'update']);
```

- [ ] **Step 7: Run settings and existing logo tests**

Run: `php artisan migrate --env=testing && php artisan test tests/Feature/McpV1BasicSettingsTest.php tests/Feature/SiteBasicSettingsTest.php`

Expected: all new API and existing browser/Logo bridge tests PASS.

- [ ] **Step 8: Commit the settings API**

```bash
git add app/Http/Controllers/Internal/McpV1/BasicSettingsController.php app/Models/McpIdempotencyKey.php app/Services/Mcp/McpIdempotencyStore.php database/migrations/2026_08_08_120000_create_mcp_idempotency_keys_table.php routes/web.php tests/Feature/McpV1BasicSettingsTest.php DB_SCHEMA.md
git commit -m "feat: expose MCP basic settings API"
```

## Task 5: Implement the Node `SlimWebBackend` HTTP client

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP/src/backends/slimWebBackend.js`
- Create: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessBackendClient.test.js`

- [ ] **Step 1: Write failing client tests**

Use a local HTTP test server and cover these exact methods and behaviors:

```js
await client.listSitesForAdminIdentity(identity);
await client.resolveAdminSiteForIdentity(identity, { site_code: 'swcb_demo' });
await client.getBasicSettings(actor, { site_id: 101 });
await client.updateBasicSettings(actor, { site_id: 101, name: '新名稱' });
```

Assert `X-SlimWeb-MCP-Secret`, actor headers, `X-SlimWeb-Tool`, `X-SlimWeb-Permission`, `X-Request-Id`, JSON content type, and `Idempotency-Key` on PATCH. Also assert 403 maps to `FORBIDDEN`, 404 to `NOT_FOUND`, 422 to `VALIDATION_FAILED`, 409 to `CONFLICT`, 5xx to `UPSTREAM_FAILED`, malformed envelopes to `UPSTREAM_INVALID_RESPONSE`, and timeout to `UPSTREAM_TIMEOUT`.

- [ ] **Step 2: Run the new test and verify imports fail**

Run: `node --test test/weblessBackendClient.test.js`

Expected: FAIL with module-not-found for `src/backends/weblessBackendClient.js`.

- [ ] **Step 3: Define and assert the interface**

`slimWebBackend.js` exports:

```js
export const SLIMWEB_BACKEND_METHODS = Object.freeze([
  'listSitesForAdminIdentity',
  'resolveAdminSiteForIdentity',
  'getBasicSettings',
  'updateBasicSettings'
]);

export function assertSlimWebBackend(backend) {
  for (const method of SLIMWEB_BACKEND_METHODS) {
    if (typeof backend?.[method] !== 'function') {
      throw new TypeError(`SlimWebBackend is missing ${method}().`);
    }
  }
  return backend;
}
```

- [ ] **Step 4: Implement `WeblessBackendClient`**

The constructor accepts `{ baseUrl, secret, fetchImpl = fetch, timeoutMs = 15000, requestIdFactory = randomUUID, idempotencyKeyFactory = randomUUID }` and rejects blank base URL/secret. Its private request method parses the response envelope, returns `payload.data`, and throws an error carrying `code`, `status`, `details`, and `requestId`.

Method return mappings must preserve current repository shapes:

```js
async listSitesForAdminIdentity(identity) {
  const data = await this.request('/internal/mcp/v1/sites', {
    identity,
    tool: 'slimweb_sites_list'
  });
  return data.sites;
}

async resolveAdminSiteForIdentity(identity, args) {
  const data = await this.request('/internal/mcp/v1/site-context/resolve', {
    method: 'POST', identity, tool: 'site_context', body: {
      ...(args.site_code ? { site_code: args.site_code } : { site_id: args.site_id })
    }
  });
  return { ...identity, ...data.actor, site: data.site };
}

async getBasicSettings(actor) {
  return this.request(`/internal/mcp/v1/sites/${encodeURIComponent(actor.site.site_code)}/settings/basic`, {
    identity: actor,
    tool: 'slimweb_settings_get',
    permission: 'basic_settings'
  });
}

async updateBasicSettings(actor, args) {
  const { site_id, site_code, ...patch } = args;
  return this.request(`/internal/mcp/v1/sites/${encodeURIComponent(actor.site.site_code)}/settings/basic`, {
    method: 'PATCH', identity: actor,
    tool: 'slimweb_settings_update', permission: 'basic_settings',
    idempotencyKey: this.idempotencyKeyFactory(), body: patch
  });
}
```

- [ ] **Step 5: Run the client tests**

Run: `node --test test/weblessBackendClient.test.js`

Expected: all request mapping, error mapping, timeout, and idempotency tests PASS.

- [ ] **Step 6: Commit the backend client**

```bash
git add src/backends/slimWebBackend.js src/backends/weblessBackendClient.js test/weblessBackendClient.test.js
git commit -m "feat: add Webless backend API client"
```

## Task 6: Delegate the migrated repository methods

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/app.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`

- [ ] **Step 1: Write failing no-SQL delegation tests**

Construct `WeblessAccountRepository` with a pool whose `query()` always throws and a backend fake that records calls. Assert all four migrated methods return the fake results and the pool call count remains zero.

```js
const pool = { query: async () => { throw new Error('unexpected SQL'); } };
const backendClient = {
  listSitesForAdminIdentity: async () => [site],
  resolveAdminSiteForIdentity: async (identity) => ({ ...identity, site_id: 101, permissions: ['system_admin'], site }),
  getBasicSettings: async () => ({ site, settings }),
  updateBasicSettings: async () => ({ ok: true, site: renamedSite, settings: renamedSettings })
};
const repository = new WeblessAccountRepository(pool, { backendClient });
```

Add an app-level test where `slimweb_settings_update` reaches the backend fake and returns the unchanged MCP `structuredContent` shape.

- [ ] **Step 2: Run the tests and verify SQL is still attempted**

Run: `node --test --test-name-pattern='backend client|settings update through backend' test/weblessRepository.test.js test/app.test.js`

Expected: FAIL with `unexpected SQL`.

- [ ] **Step 3: Add constructor delegation**

Store `options.backendClient ?? null` in the repository. At the start of each migrated method, return the matching backend method when configured:

```js
if (this.backendClient) {
  return this.backendClient.updateBasicSettings(accountId, args);
}
```

Use the equivalent method name in all four methods. Keep the current direct implementation immediately below as a temporary migration oracle for local unit coverage; do not add catch-and-fallback behavior.

- [ ] **Step 4: Wire production configuration explicitly**

In `createDefaultContext`, create a backend client only when `WEBLESS_BACKEND_API_BASE_URL` is nonblank:

```js
const backendClient = options.backendClient ?? (
  process.env.WEBLESS_BACKEND_API_BASE_URL
    ? new WeblessBackendClient({
        baseUrl: process.env.WEBLESS_BACKEND_API_BASE_URL,
        secret: process.env.WEBLESS_MCP_SECRET
      })
    : null
);

const accountRepository = options.accountRepository
  ?? new WeblessAccountRepository(undefined, { backendClient });
```

Pass `accountRepository` into the returned context. An invalid configured client must fail service startup; it must not silently return to direct SQL.

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test test/weblessBackendClient.test.js test/weblessRepository.test.js test/app.test.js`

Expected: all tests PASS and the frozen tools hash remains `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`.

Run: `npm test`

Expected: complete suite PASS.

- [ ] **Step 6: Commit repository delegation**

```bash
git add src/weblessRepository.js src/app.js test/weblessRepository.test.js test/app.test.js
git commit -m "refactor: route SaaS settings through backend API"
```

## Task 7: Document and configure the first migration slice

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/.github/workflows/deploy.yml`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/README.md`
- Modify: `/Users/eric/Documents/webless/.env.example`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`

- [ ] **Step 1: Update the MCP deployment environment**

Add this nonsecret value to the Cloud Run `--set-env-vars` list:

```text
WEBLESS_BACKEND_API_BASE_URL=https://webless-aakwcbp2ca-de.a.run.app
```

Keep `DB_*`, the Cloud SQL attachment, GCS, and storage variables in this phase because non-settings tools still use them.

- [ ] **Step 2: Update runtime documentation**

Replace the README claim that all MCP authentication/settings work directly connects PostgreSQL with an explicit migration table:

```markdown
| Domain | Current SaaS execution path |
| --- | --- |
| Google admin site list and site permission resolution | Webless `/internal/mcp/v1` API |
| Basic settings read/update, including site name and logo | Webless `/internal/mcp/v1` API |
| Other tool domains | Temporary direct repository until their approved migration phase |
```

Document `WEBLESS_BACKEND_API_BASE_URL`, `WEBLESS_MCP_SECRET`, 15-second request timeout, request IDs, and the rule that a configured-but-unreachable API fails the operation without SQL fallback.

- [ ] **Step 3: Document Webless service configuration**

Add `WEBLESS_MCP_SECRET=` to `/Users/eric/Documents/webless/.env.example` next to the MCP URLs with a comment that it is a service credential, not a merchant credential.

- [ ] **Step 4: Run documentation/contract tests**

Run from SlimWeb-MCP: `npm test`

Expected: PASS, including README tool-table and frozen contract assertions.

Run from Webless: `php artisan test tests/Feature/McpV1SiteContextTest.php tests/Feature/McpV1BasicSettingsTest.php tests/Feature/McpInternalRouteContractTest.php`

Expected: PASS.

- [ ] **Step 5: Commit configuration and documentation in each repository**

From `/Users/eric/Documents/webless`:

```bash
git add .env.example
git commit -m "docs: configure SaaS MCP backend API"
```

From `/Users/eric/Documents/SlimWeb-MCP`:

```bash
git add .github/workflows/deploy.yml README.md test/app.test.js
git commit -m "docs: describe SaaS backend migration slice"
```

## Task 8: Full verification and ordered deployment

**Files:**
- Verify: `/Users/eric/Documents/webless`
- Verify: `/Users/eric/Documents/SlimWeb-MCP`

- [ ] **Step 1: Run final local verification in Webless**

Run:

```bash
php artisan test tests/Feature/McpV1SiteContextTest.php tests/Feature/McpV1BasicSettingsTest.php tests/Feature/SiteBasicSettingsTest.php tests/Feature/McpInternalRouteContractTest.php
php artisan test
npm run build
git status --short
```

Expected: all PHP tests PASS, Vite build succeeds, and Git status is clean.

- [ ] **Step 2: Run final local verification in SlimWeb-MCP**

Run:

```bash
npm test
docker build -t slimweb-mcp:saas-backend-api .
git status --short
```

Expected: all Node tests PASS, Docker build succeeds, and Git status is clean.

- [ ] **Step 3: Deploy Webless first as a no-traffic candidate**

Run from `/Users/eric/Documents/webless`:

```bash
php artisan migrate --force
php artisan migrate:status | rg '2026_08_08_120000.*Ran'
previous_webless_revision="$(gcloud run services describe webless --project=webless-489821 --region=asia-east1 --format=json | jq -r '.status.traffic[] | select(.percent == 100) | .revisionName' | sed -n '1p')"
TAG=mcp-v1-settings scripts/deploy-cloud-run.sh --health-path /up
```

Expected: the idempotency migration is recorded as `Ran`, then the candidate deploys with zero production traffic and its health check passes. The configured local Webless environment targets the production Synology PostgreSQL database documented in `CLOUD_RUN_DEPLOYMENT_LOCAL.md`; do not run the migration from a differently configured shell.

Call the candidate `/internal/mcp/v1/version` with the configured service secret and request ID. Expected: HTTP 200, `contract=slimweb-backend`, `major=1`, and all three Phase 1 capabilities.

- [ ] **Step 4: Promote Webless and verify production API**

Run the exact promotion command printed by the candidate script, routing the verified candidate revision to 100%. Then call production `/up` and `/internal/mcp/v1/version`.

Expected: both return HTTP 200 and the version envelope matches the candidate.

- [ ] **Step 5: Push SlimWeb-MCP main and wait for its deployment workflow**

Run from `/Users/eric/Documents/SlimWeb-MCP`:

```bash
previous_mcp_revision="$(gcloud run services describe slimweb-mcp --project=webless-489821 --region=asia-east1 --format=json | jq -r '.status.traffic[] | select(.percent == 100) | .revisionName' | sed -n '1p')"
git push origin main
run_id="$(gh run list --workflow='Deploy SlimWeb MCP' --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

Expected: the selected workflow concludes `success` and Cloud Run routes 100% traffic to the new MCP revision.

- [ ] **Step 6: Verify live health and the frozen contract**

Call production `/readyz`, `/`, and unauthenticated `tools/list`. Expected: health endpoints return HTTP 200, tool count is 125, and SHA-256 of `JSON.stringify(result.tools)` is `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`.

- [ ] **Step 7: Run authenticated read and reversible website-name smoke tests**

Use the designated SaaS test site and its existing authenticated MCP session:

1. call `slimweb_settings_get` and record the original name;
2. call `slimweb_settings_update` with a temporary unique name;
3. call `slimweb_settings_get` and confirm the temporary name;
4. verify the Webless admin/runtime shows the temporary name;
5. call `slimweb_settings_update` with the recorded original name;
6. call `slimweb_settings_get` and confirm restoration.

Expected: both writes return success, immutable slug/site code/domain stay unchanged, and Webless logs for the request IDs show the `/internal/mcp/v1` route rather than a Node SQL update.

- [ ] **Step 8: Roll back immediately on a failed live check**

If health, contract hash, authenticated read, write, restoration, or log-path verification fails, run:

```bash
gcloud run services update-traffic slimweb-mcp --project=webless-489821 --region=asia-east1 --to-revisions="${previous_mcp_revision}=100"
gcloud run services update-traffic webless --project=webless-489821 --region=asia-east1 --to-revisions="${previous_webless_revision}=100"
```

Expected: both services return to their recorded pre-deployment revisions. Diagnose from correlated request-ID logs, add a regression test, fix locally, rerun Steps 1-7, and leave Phase 1 incomplete until every live check passes.

- [ ] **Step 9: Record the Phase 1 acceptance result**

Append a dated section to the approved design document containing the Webless revision, MCP revision, GitHub Actions run ID, test counts, contract hash, test `site_code`, and confirmation that the original name was restored. Commit that evidence in SlimWeb-MCP:

```bash
git add docs/superpowers/specs/2026-08-08-saas-mcp-backend-interface-design.md
git commit -m "docs: record SaaS settings API verification"
git push origin main
```

Phase 1 is complete only after this evidence is committed. The next plan may then migrate catalog/navigation; Standalone remains out of scope.
