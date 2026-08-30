# MCP Page Formal JavaScript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SlimWeb page tools manage one canonical page-level JavaScript asset so Swiper and GSAP work without executable inline scripts or duplicate animation files.

**Architecture:** Webless owns validation, storage, conflict detection, compensation, and storefront delivery. MCP behavior always replaces `assets/js/90-mcp-page.js`; third-party libraries remain declarations in `enabled_libraries`. SlimWeb-MCP-Core owns the public contract and error mapping; SlimWeb-MCP consumes the released Core tag before Sweety is updated.

**Tech Stack:** Laravel/PHPUnit, GCS-backed page storage, Node.js MCP Core with `node:test`, Cloud Run, Git tags, browser acceptance.

---

## Repository and file map

- `/Users/eric/Documents/webless/app/Services/Mcp/Content/PageService.php`: coordinate page HTML, metadata, and JavaScript.
- `/Users/eric/Documents/webless/app/Services/Mcp/Content/PageJavascriptService.php`: canonical path, validation, inventory, digest verification, and conflict response.
- `/Users/eric/Documents/webless/tests/Feature/McpV1PageTest.php`: lifecycle, validation, conflicts, and compensation.
- `/Users/eric/Documents/webless/tests/Unit/SitePageTemplateStoragePathTest.php`: storefront ordering/versioning.
- `/Users/eric/Documents/SlimWeb-MCP-Core/src/app.js`: public page schema, guidance, and error mapping.
- `/Users/eric/Documents/SlimWeb-MCP-Core/test/pageJavascriptContract.test.js`: page contract/error tests.
- `/Users/eric/Documents/SlimWeb-MCP-Core/test/backendRepository.test.js`: nested forwarding test.
- `/Users/eric/Documents/SlimWeb-MCP-Core/package.json`, `package-lock.json`: Core patch release.
- `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`: consumer contract assertions.
- `/Users/eric/Documents/SlimWeb-MCP/test/fixtures/saas-tool-contract.json`: regenerated public catalog.
- `/Users/eric/Documents/SlimWeb-MCP/package.json`, `package-lock.json`, `README.md`: released dependency and documentation.
- `/Users/eric/Documents/SlimWeb-Standalone/app/Services/Mcp/Content/PageService.php` and `PageJavascriptService.php`: local-object-storage implementation of the same lifecycle.
- `/Users/eric/Documents/SlimWeb-Standalone/tests/Feature/Standalone/McpV1BackendTest.php`: Standalone backend lifecycle and safety tests.
- `/Users/eric/Documents/SlimWeb-Standalone-MCP/package.json`, `package-lock.json`, `test/app.test.js`, `README.md`: full-contract consumer alignment.
- `/Users/eric/Documents/SlimWeb-MCP/docs/acceptance/sweety-carousel-2026-08-31.md`: live evidence.

Do not stage unrelated dirty files in `/Users/eric/Documents/webless`. Every `git add` below uses explicit paths.

### Task 1: Define the Webless lifecycle with failing tests

**Files:**
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1PageTest.php`

- [ ] **Step 1: Extend `FakePageStorage`**

Add `failUploadPath` and `corruptReadbackPath` controls. Override `upload()` to throw for the selected path, `delete()` to remove one object, and `downloadIfExists()` to append `-corrupt` only for the selected read-back path. Preserve the existing `GcsStorage` return shape and content type.

- [ ] **Step 2: Add one canonical lifecycle test**

For `brand-story`, create with:

```php
'content' => [
    'html' => '<main class="hero">Initial</main>',
    'javascript' => "window.pageRuns = (window.pageRuns || 0) + 1;\n",
]
```

Assert the exact object is `sites/{site_id}/templates/default/pages/brand-story/assets/js/90-mcp-page.js`. Update HTML while omitting `javascript` and assert preservation. Update with `gsap.to('.hero', { opacity: 1 });` and assert whole-file replacement at the same path. Send explicit `javascript: ''` and assert deletion. After every step, assert `content.javascript`, `javascript_asset`, `javascript_conflicts`, and that the page JS directory never contains more than one MCP file.

- [ ] **Step 3: Add homepage and validation cases**

Assert `index` uses the Default page layer. Keep the existing `<script>`-in-HTML rejection. Add field-detail assertions for non-string JavaScript, over 102400 UTF-8 bytes, `<script>`, `{{`, `{!!`, `<?`, `<%`, static/dynamic import, and `sourceMappingURL`. A 102400-byte source must pass.

- [ ] **Step 4: Confirm RED and commit the contract tests**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/McpV1PageTest.php
git add tests/Feature/McpV1PageTest.php
git commit -m "test: define page javascript asset lifecycle"
```

Expected before implementation: new persistence/read assertions fail.

### Task 2: Implement the canonical service and read/write semantics

**Files:**
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Content/PageJavascriptService.php`
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/PageService.php`
- Test: `/Users/eric/Documents/webless/tests/Feature/McpV1PageTest.php`

- [ ] **Step 1: Implement the focused service**

Use these constants and public contracts:

```php
public const FILE_NAME = '90-mcp-page.js';
public const MAX_BYTES = 102400;

public function path(Site $site, string $key): string;
public function input(array $content): array; // {provided:bool, source:string}
public function validate(string $source): string;
public function inspect(Site $site, string $key): array; // source, asset, conflicts
public function store(string $path, string $source): void;
public function remove(string $path): void;
public function restore(string $path, ?string $previous): void;
```

`input()` distinguishes omission from explicit blank. `validate()` enforces the approved 100 KiB and forbidden-pattern rules. `inspect()` scans `.js`, `.mjs`, and `.cjs`, returns the canonical body only as `source`, and returns sorted metadata `{path, ownership, bytes, sha256}` for canonical and conflicting assets.

- [ ] **Step 2: Verify every mutation**

`store()` uploads as `text/javascript; charset=utf-8`, reads back, and compares SHA-256. `remove()` deletes, reads back, and requires absence. Throw `RuntimeException` on verification failure.

- [ ] **Step 3: Wire reads into `PageService`**

Inject the new service. For homepage and custom pages return:

```php
'content' => ['html' => $cleanHtml, 'javascript' => $inspection['source']],
'javascript_asset' => $inspection['asset'],
'javascript_conflicts' => $inspection['conflicts'],
```

Never merge noncanonical file bodies into `content.javascript`.

- [ ] **Step 4: Wire create/update semantics**

Parse `content` once and validate HTML plus JavaScript before writing. Create treats omitted/blank as no asset. Update omits to preserve, nonblank replaces the complete canonical file, and explicit blank deletes it. Keep `safeHtml()` unchanged. Include `javascript_asset`, `javascript_conflicts`, and `javascript_bytes_written` in the result.

- [ ] **Step 5: Run and commit**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/McpV1PageTest.php
git add app/Services/Mcp/Content/PageJavascriptService.php app/Services/Mcp/Content/PageService.php tests/Feature/McpV1PageTest.php
git commit -m "feat: manage one formal javascript asset per page"
```

### Task 3: Add fail-closed conflicts and compensation

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/PageJavascriptService.php`
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/PageService.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1PageTest.php`

- [ ] **Step 1: Add failing conflict tests**

Seed `assets/js/90-migrated-inline.js`. A request containing `content.javascript` must return HTTP 409 with `error.code=CONFLICT`, `error.details.reason=PAGE_JAVASCRIPT_CONFLICT`, and the asset metadata; no object may change. An HTML-only update omitting JavaScript must succeed and preserve both scripts.

- [ ] **Step 2: Implement the structured conflict**

Before any write, and only when JavaScript was provided, throw:

```php
new HttpResponseException(McpApiResponse::error(
    'CONFLICT',
    'Page JavaScript is already managed by noncanonical assets. Consolidate them before changing content.javascript.',
    409,
    ['reason' => 'PAGE_JAVASCRIPT_CONFLICT', 'conflicts' => $inspection['conflicts']],
));
```

- [ ] **Step 3: Add failing compensation tests**

Seed old HTML, metadata, and canonical JS. Independently inject HTML upload, metadata upload, JS upload, corrupt JS read-back, and failed-deletion verification. Each failed update must restore all old objects. A failed create must leave none of the three objects.

- [ ] **Step 4: Implement coordinated snapshot/restore**

Validate everything before mutation. Snapshot `{body, contentType}` or `null` for HTML, metadata, and canonical JS. Write HTML, metadata, then JS inside `try`. On any `Throwable`, restore JS, metadata, then HTML and verify each restored state before rethrowing. If rollback fails, report both failures and throw a rollback `RuntimeException`; never report the page as updated.

- [ ] **Step 5: Run and commit**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/McpV1PageTest.php
git add app/Services/Mcp/Content/PageJavascriptService.php app/Services/Mcp/Content/PageService.php tests/Feature/McpV1PageTest.php
git commit -m "fix: fail closed and compensate page asset writes"
```

### Task 4: Prove storefront dependency order and versioning

**Files:**
- Modify: `/Users/eric/Documents/webless/tests/Unit/SitePageTemplateStoragePathTest.php`
- Modify only if required by RED test: `/Users/eric/Documents/webless/app/Http/Controllers/StorefrontController.php`

- [ ] **Step 1: Extend the existing formal-script tests**

Seed Default homepage `assets/js/90-mcp-page.js`. Assert exactly one same-origin URL `90-mcp-page.js?v=<content digest>`, `defer`, Default page-layer selection under a custom Theme shell, and root scripts before page scripts.

- [ ] **Step 2: Add a Swiper ordering test**

Render stored content containing the managed Swiper CDN tag and assert it appears before the formal page initializer in final HTML. If RED, move only the formal-script emission point so it follows managed library tags; retain same-origin, `defer`, and root-before-page behavior.

- [ ] **Step 3: Run regression tests and commit**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/McpV1PageTest.php tests/Unit/SitePageTemplateStoragePathTest.php tests/Feature/ExtractStorefrontPageScriptsTest.php
git add tests/Unit/SitePageTemplateStoragePathTest.php app/Http/Controllers/StorefrontController.php
git commit -m "test: verify formal page javascript delivery order"
```

Omit the controller from `git add` if unchanged.

### Task 5: Implement the SlimWeb-MCP-Core contract

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP-Core/test/pageJavascriptContract.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/test/backendRepository.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/src/app.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/package.json`, `package-lock.json`

- [ ] **Step 1: Add failing contract tests**

Using the existing authenticated `createRequestHandler` helper, assert create/update expose `content.javascript` as a string with `maxLength: 102400`; update describes omitted/preserve and blank/delete; read describes `content.javascript`, `javascript_asset`, and `javascript_conflicts`; descriptions no longer tell clients to put executable inline JavaScript in HTML.

- [ ] **Step 2: Add forwarding and error-detail tests**

Pass `{content:{html:'<main class="swiper">...</main>',javascript:"new Swiper('.swiper');"},enabled_libraries:['swiper']}` and assert the repository PUT body is unchanged. Make the fake repository throw `BackendRepositoryError` with `details.fields['content.javascript']`; assert the MCP error retains it. Add a 409 `PAGE_JAVASCRIPT_CONFLICT` case with its conflict list.

- [ ] **Step 3: Confirm RED**

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core
npm test -- test/pageJavascriptContract.test.js test/backendRepository.test.js
```

- [ ] **Step 4: Implement the shared schema/guidance**

Create one reusable page-content schema. JavaScript description must say “complete source without `<script>` tags”; HTML stays non-executable; dependencies use `enabled_libraries`; repeated edits replace `90-mcp-page.js`. Document read-before-replace and conflict handling.

- [ ] **Step 5: Fix error mapping**

`BackendRepositoryError` stores `details`, not `data`. Change `toolExceptionToMcpError()` to return `{reason, details: error.details ?? {}}`. Map `CONFLICT` to the package's existing conflict code; if absent, use `-32009` and test it.

- [ ] **Step 6: Run all tests, bump, and commit**

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core
npm test
npm version 0.1.7 --no-git-tag-version
git add src/app.js test/pageJavascriptContract.test.js test/backendRepository.test.js package.json package-lock.json
git commit -m "feat: expose formal page javascript contract"
```

Do not tag or push until the Webless candidate passes Task 6.

### Task 6: Verify Webless and publish the Core dependency

- [ ] **Step 1: Verify and deploy a no-traffic Webless candidate**

```bash
cd /Users/eric/Documents/webless
git status --short
php artisan test tests/Feature/McpV1PageTest.php tests/Unit/SitePageTemplateStoragePathTest.php tests/Feature/ExtractStorefrontPageScriptsTest.php
npm run build
scripts/deploy-cloud-run.sh
```

Verify the emitted candidate `/up` URL and exercise create/read/replace/delete plus conflict behavior on a disposable test page. Promote that exact revision with the command emitted by the script, clear temporary tags, then record the production revision and tested commit SHA.

- [ ] **Step 2: Publish Core v0.1.7**

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core
npm test
git push origin main
git tag -a v0.1.7 -m "SlimWeb MCP Core v0.1.7"
git push origin v0.1.7
```

Confirm the remote tag resolves to the tested commit before any consumer installs it.

### Task 7: Align and deploy the Standalone backend and MCP shell

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-Standalone/app/Services/Mcp/Content/PageJavascriptService.php`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone/app/Services/Mcp/Content/PageService.php`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone/tests/Feature/Standalone/McpV1BackendTest.php`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone-MCP/package.json`, `package-lock.json`, `test/app.test.js`, `README.md`

- [ ] **Step 1: Add and verify failing Standalone backend tests**

Extend the existing full-contract page test to cover create/read, omitted preservation, whole-file replacement, explicit blank deletion, canonical metadata, noncanonical conflict, and inline-HTML rejection using `Storage::fake('standalone_objects')`. Run the focused test and confirm RED.

- [ ] **Step 2: Implement the same storage contract locally**

Port the reviewed Webless `PageJavascriptService` and `PageService` lifecycle without SaaS-only diagnostics. Keep identical path, validation, conflict, digest, and compensation semantics over `LocalObjectStorage`. Run the focused backend test and the full Standalone suite.

- [ ] **Step 3: Upgrade and test Standalone-MCP**

Install Core `v0.1.7`, assert a full-contract backend exposes the new page schema and wording, update README, and run all Standalone-MCP tests. Commit and push both Standalone repositories on `main`.

- [ ] **Step 4: Deploy both Standalone layers**

Push `SlimWeb-Standalone-MCP/main` and verify its matching Cloud Run workflow, `/readyz`, serving revision, and `COMMIT_SHA`. Build the Standalone release package, verify its checksum/exclusions, deploy a backed-up no-production candidate with `scripts/deploy-test-machine.sh`, exercise the page lifecycle, then promote the exact verified release while preserving `.env`, MySQL, uploaded media, templates, and writable storage.

### Task 8: Update, verify, and deploy SlimWeb-MCP

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/package.json`, `package-lock.json`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`
- Regenerate: `/Users/eric/Documents/SlimWeb-MCP/test/fixtures/saas-tool-contract.json`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/README.md`

- [ ] **Step 1: Change tests first and confirm RED**

Assert page tools expose `content.javascript`, preserve/delete wording, `maxLength: 102400`, and `enabled_libraries`; remove the old inline-executable assertion.

```bash
cd /Users/eric/Documents/SlimWeb-MCP
npm test -- test/app.test.js
```

- [ ] **Step 2: Install the released Core tag exactly**

```bash
npm install github:eric19831010/SlimWeb-MCP-Core#v0.1.7
```

Verify both package files resolve `v0.1.7`.

- [ ] **Step 3: Regenerate and inspect the contract**

```bash
node scripts/generate-saas-tool-contract.mjs
git diff -- test/fixtures/saas-tool-contract.json
```

Only the intended page-contract/error-description changes are acceptable.

- [ ] **Step 4: Update README**

Show a Swiper request with HTML in `content.html`, initialization in `content.javascript`, and `enabled_libraries: ["swiper"]`. Explain that GSAP/Swiper are platform dependencies, repeated edits replace one file, HTML-only updates preserve JS, blank deletes it, and conflicts require operator consolidation.

- [ ] **Step 5: Run and commit**

```bash
npm test
git add package.json package-lock.json test/app.test.js test/fixtures/saas-tool-contract.json README.md
git commit -m "feat: consume formal page javascript contract"
```

- [ ] **Step 6: Run cross-consumer verification**

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core
node scripts/verify-consumers.mjs
```

Core, SlimWeb-MCP, SlimWeb-Standalone-MCP, and Standalone backend consumer suites must pass. Investigate real contract drift; do not blindly overwrite fixtures.

- [ ] **Step 7: Push and verify SlimWeb-MCP deployment**

```bash
cd /Users/eric/Documents/SlimWeb-MCP
git push origin main
gh run list --workflow deploy.yml --limit 5
```

Inspect the matching run, verify `/readyz`, and record its Cloud Run serving revision and `COMMIT_SHA` separately from Git state.

### Task 9: Repair Sweety and audit EasyDays

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP/docs/acceptance/sweety-carousel-2026-08-31.md`

- [ ] **Step 1: Refresh tools and re-read live state**

Reconnect the MCP contract and verify the new schema. Read Sweety and EasyDays `index`, recording HTML, JavaScript, enabled libraries, canonical asset, and conflicts. If Sweety has conflicts, stop and perform a separately backed-up operator consolidation; never create another initializer.

- [ ] **Step 2: Submit one Sweety behavior source**

Use the four already uploaded WebP assets. Send carousel HTML without `<script>`, `enabled_libraries: ["swiper"]`, and one complete initializer in `content.javascript` containing autoplay, previous/next, clickable pagination, keyboard support, reduced-motion handling, and an idempotent guard.

- [ ] **Step 3: Read back ownership and digest**

Require exact JavaScript equality, a path ending `/assets/js/90-mcp-page.js`, matching SHA-256, empty conflicts, no executable script in HTML, and Swiper in enabled libraries.

- [ ] **Step 4: Browser acceptance**

At desktop and mobile widths, exercise autoplay, both arrows, pagination, keyboard, reduced-motion, image crops, and overflow. Check console/network for duplicate initialization, missing Swiper, CSP errors, and 404s.

- [ ] **Step 5: Audit EasyDays read-only**

Exercise its carousel on desktop/mobile and record whether it uses a migrated/manual asset. Do not rewrite it merely to normalize filenames.

- [ ] **Step 6: Record and commit evidence**

Document commit SHAs, serving revisions, timestamps, read-back hashes, viewport sizes, interaction results, and EasyDays ownership. Exclude secrets and signed URLs.

```bash
cd /Users/eric/Documents/SlimWeb-MCP
git add docs/acceptance/sweety-carousel-2026-08-31.md
git commit -m "docs: record Sweety carousel acceptance"
git push origin main
```

## Final verification checklist

- [ ] Inline executable HTML is still rejected.
- [ ] JavaScript create/read/replace/preserve/delete semantics pass.
- [ ] Exactly one MCP-owned file exists per managed page.
- [ ] GSAP/Swiper remain dependencies, not generated files.
- [ ] Conflicts block only JavaScript mutation and return actionable metadata.
- [ ] Failed writes restore HTML, metadata, and JavaScript.
- [ ] Formal URLs are same-origin, versioned, deferred, and dependency-ordered.
- [ ] Core exposes backend field details.
- [ ] All three repositories pass at the exact released versions.
- [ ] Git state and live deployment state are recorded separately.
- [ ] Sweety works on desktop/mobile and EasyDays remains unchanged.
