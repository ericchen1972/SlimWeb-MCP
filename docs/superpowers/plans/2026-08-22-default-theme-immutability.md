# Default Theme Immutability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Default Theme immutable across SaaS and Standalone, route AI Theme edits according to the active Theme, support cloning the current Theme, and safely migrate EasyDays' historical Default customization into a new active Theme.

**Architecture:** Put the public tool workflow and literal-Default preflight guard in the shared `SlimWeb-MCP-Core`, while Webless and SlimWeb Standalone remain the authoritative data-integrity boundary for numeric Default IDs and active-custom confirmation. Default never persists root-elements; creating from Default produces an empty custom shell that renders through canonical runtime fallback, while cloning a non-Default Theme copies that custom shell. Handle EasyDays with a separately tested internal migration command that copies its historical Default overrides to a new custom Theme before backing up and removing only those legacy overrides.

**Tech Stack:** Node.js 20 MCP Core and consumers, Laravel/PHPUnit SaaS and Standalone backends, GCS-backed Theme storage, Cloud Run, GitHub Actions, SlimWeb MCP live acceptance.

---

## Repository and file map

- `/Users/eric/Documents/SlimWeb-MCP-Core/src/app.js`: shared tool catalog, server guidelines, pre-dispatch Default guard, and dispatch for source-Theme cloning.
- `/Users/eric/Documents/SlimWeb-MCP-Core/src/backendRepository.js`: backend transport method for `source_theme_id` cloning.
- `/Users/eric/Documents/SlimWeb-MCP-Core/test/toolProfile.test.js`: tool list/schema/guideline regression tests.
- `/Users/eric/Documents/SlimWeb-MCP-Core/test/backendRepository.test.js`: backend path/body tests.
- `/Users/eric/Documents/SlimWeb-MCP-Core/test/themePolicy.test.js`: focused MCP dispatch tests for literal Default rejection and clone routing.
- `/Users/eric/Documents/webless/app/Services/Mcp/Content/ThemeService.php`: SaaS authoritative immutability, active-custom confirmation, Theme policy context, and source clone logic.
- `/Users/eric/Documents/webless/tests/Feature/McpV1ThemeTest.php`: SaaS Theme API behavior tests.
- `/Users/eric/Documents/SlimWeb-Standalone/app/Services/Mcp/Content/ThemeService.php`: Standalone equivalent behavior.
- `/Users/eric/Documents/SlimWeb-Standalone/tests/Feature/Standalone/McpThemePolicyTest.php`: Standalone Theme behavior tests.
- `/Users/eric/Documents/SlimWeb-MCP/package.json`, `package-lock.json`: consume the released Core version.
- `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`, `test/toolContract.test.js`, `test/fixtures/saas-tool-contract.json`, `README.md`: SaaS consumer contract and documentation.
- `/Users/eric/Documents/SlimWeb-Standalone-MCP/package.json`, `package-lock.json`, `test/app.test.js`, `README.md`: Standalone consumer contract and documentation.
- `/Users/eric/Documents/webless/app/Console/Commands/MigrateEasyDaysDefaultTheme.php`: internal, non-MCP EasyDays copy/backup/cleanup command.
- `/Users/eric/Documents/webless/tests/Feature/MigrateEasyDaysDefaultThemeTest.php`: exact copy, safety, and backup tests for the migration command.
- `/Users/eric/Documents/SlimWeb-MCP/docs/acceptance/easydays-theme-migration-2026-08-22.md`: persisted migration evidence and viewport results.

Do not stage or modify unrelated dirty files already present in `/Users/eric/Documents/webless`, especially `videos/`, `output/`, `outputs/`, `tmp/`, and `storage/template-backups/`.

### Task 1: Add failing shared-Core contract tests

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP-Core/test/themePolicy.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/test/toolProfile.test.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP-Core/test/backendRepository.test.js`

- [ ] **Step 1: Add failing tool-catalog assertions**

Extend `test/toolProfile.test.js` with assertions equivalent to:

```js
test('Theme contract makes Default immutable and exposes active-theme branching', async () => {
  const tools = await listTools();
  const clone = tools.find(({ name }) => name === 'slimweb_themes_create_from_theme');
  const update = tools.find(({ name }) => name === 'slimweb_themes_update_root_elements');
  const profile = tools.find(({ name }) => name === 'slimweb_theme_style_profile_upsert');
  const append = tools.find(({ name }) => name === 'slimweb_theme_style_profile_append_request');

  assert.ok(clone);
  assert.deepEqual(clone.inputSchema.required, ['site_code', 'name', 'source_theme_id']);
  assert.equal(clone.inputSchema.properties.source_theme_id.type.includes('integer'), true);
  assert.match(update.description, /Default theme is immutable/i);
  assert.equal(update.inputSchema.properties.confirmed_active_theme_edit.type, 'boolean');
  assert.equal(profile.inputSchema.properties.confirmed_active_theme_edit.type, 'boolean');
  assert.equal(append.inputSchema.properties.confirmed_active_theme_edit.type, 'boolean');
});
```

- [ ] **Step 2: Add failing literal-Default dispatch tests**

Create `test/themePolicy.test.js` using `createRequestHandler`, a logged-in test session, and a repository spy. Assert that each call returns `VALIDATION_FAILED` and the spy is not invoked:

```js
for (const [name, args] of [
  ['slimweb_themes_update_root_elements', { theme_id: 'default', css: '.x{}' }],
  ['slimweb_theme_style_profile_upsert', { theme_id: 'default', summary: 'x' }],
  ['slimweb_theme_style_profile_append_request', { theme_id: 'default', request: 'x' }],
]) {
  const payload = await callTool(name, { site_code: 'swcb_test', ...args });
  assert.equal(payload.error.data.reason, 'VALIDATION_FAILED');
  assert.match(payload.error.message, /Default theme is immutable/i);
}
assert.equal(repositoryCalls.length, 0);
```

- [ ] **Step 3: Add failing repository clone transport test**

Extend `test/backendRepository.test.js` so `createThemeFromTheme` must POST to `/themes`, use tool name `slimweb_themes_create_from_theme`, and preserve `name` plus `source_theme_id` in the body.

- [ ] **Step 4: Run the focused tests and confirm RED**

Run:

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core
npm test -- test/toolProfile.test.js test/backendRepository.test.js test/themePolicy.test.js
```

Expected: FAIL because the clone tool, confirmation schema, dispatch guard, and repository method do not exist.

### Task 2: Implement the shared MCP Core policy

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/src/app.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/src/backendRepository.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP-Core/package.json`

- [ ] **Step 1: Add a focused literal-Default guard**

Add and use a helper before the three Theme write repository calls:

```js
function assertMutableThemeTarget(args) {
  if (String(args?.theme_id ?? '').trim().toLowerCase() === 'default') {
    const error = new Error('Default theme is immutable. Create a new theme before changing theme-managed elements.');
    error.code = 'VALIDATION_FAILED';
    throw error;
  }
}
```

Call it in the dispatch cases for root-elements update, style-profile upsert, and style-profile request append. Do not apply it to reads, preview, activation, or cloning.

- [ ] **Step 2: Add the source-Theme clone tool**

Add `slimweb_themes_create_from_theme` beside `slimweb_themes_create_from_default` with required `site_id`, `name`, and `source_theme_id`. The description must say the source is read-only, copies shell/assets/style profile, and never copies page bodies.

Register the same page-template permission and dispatch it to:

```js
context.accountRepository.createThemeFromTheme(actor, args)
```

- [ ] **Step 3: Add repository transport**

Add:

```js
async createThemeFromTheme(actor, args) {
  return this.themeMutation(actor, '/themes', 'POST', 'slimweb_themes_create_from_theme', args);
}
```

Include `createThemeFromTheme` in the required backend repository method list.

- [ ] **Step 4: Publish the active-Theme decision contract**

Rewrite the Theme create/edit server guidelines so they require `slimweb_design_context_get` first and implement these exact branches:

```text
active Default -> create a new Theme automatically, then edit the inactive new Theme
active custom -> ask whether to clone current Theme or edit current Theme
edit active custom -> pass confirmed_active_theme_edit=true only after explicit user confirmation
```

Add `confirmed_active_theme_edit` as an optional boolean property to the three Theme write schemas. State that it is required only when the target is the active non-Default Theme.

- [ ] **Step 5: Bump Core to `0.1.6` and run GREEN tests**

Run:

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core
npm test
npm run verify:consumers
```

Expected: all Core tests pass; consumer verification may report the expected dependency-version drift until Task 6.

- [ ] **Step 6: Commit Core implementation**

```bash
git add src/app.js src/backendRepository.js package.json package-lock.json test
git commit -m "feat: enforce immutable default themes"
```

### Task 3: Add failing SaaS backend behavior tests

**Files:**
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1ThemeTest.php`

- [ ] **Step 1: Test Default root and profile rejection**

Add table-driven requests for both `'default'` and the numeric Default ID:

```php
foreach (['default', (string) $default->id] as $themeId) {
    $this->withHeaders($this->headers('slimweb_themes_update_root_elements', true))
        ->putJson($this->url($site, "/themes/{$themeId}/root-elements"), ['css' => '.x{}'])
        ->assertUnprocessable()
        ->assertJsonPath('error.message', 'Default theme is immutable. Create a new theme before changing theme-managed elements.');

    $this->withHeaders($this->headers('slimweb_theme_style_profile_upsert', true))
        ->putJson($this->url($site, "/themes/{$themeId}/style-profile"), ['summary' => 'x'])
        ->assertUnprocessable();
}
```

Also cover the append-request endpoint.

Add a creation assertion that `slimweb_themes_create_from_default` does not copy any object from `templates/default/root-elements` or `templates/default/assets/root-elements`; the new Theme must render through fallback until it receives its own custom fragment.

- [ ] **Step 2: Test active-custom confirmation**

Create an active custom Theme and assert root/profile writes fail without `confirmed_active_theme_edit`, pass with it set to `true`, and pass without it for an inactive custom Theme.

- [ ] **Step 3: Test source-Theme cloning**

Seed a non-Default source Theme with shell files, root CSS, one page body, and a style profile. POST `/themes` with `source_theme_id` and assert:

```php
$this->assertSame($sourceNavbar, $this->storage->body($newNavbarPath));
$this->assertSame($sourceCss, $this->storage->body($newCssPath));
$this->assertNull($this->storage->body($newPageBodyPath));
$this->assertDatabaseHas('site_theme_style_profiles', [
    'site_page_id' => $newThemeId,
    'summary' => '來源版型摘要',
]);
```

- [ ] **Step 4: Test context policy**

Assert `design-context` and `shell-context` include `theme_edit_policy.default_is_immutable`, `managed_elements`, and the correct branch for Default versus custom active Theme.

- [ ] **Step 5: Run the focused test and confirm RED**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/McpV1ThemeTest.php
```

Expected: FAIL because current `ThemeService` writes Default, ignores confirmation, omits the policy, and always clones Default without its style profile.

### Task 4: Implement SaaS authoritative Theme protection

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/ThemeService.php`

- [ ] **Step 1: Add one mutation policy helper**

Add:

```php
private function assertMutableTheme(SitePage $theme, array $input): void
{
    if ((bool) $theme->is_default) {
        throw ValidationException::withMessages([
            'theme_id' => 'Default theme is immutable. Create a new theme before changing theme-managed elements.',
        ]);
    }

    if ((bool) $theme->is_active && ($input['confirmed_active_theme_edit'] ?? null) !== true) {
        throw ValidationException::withMessages([
            'confirmed_active_theme_edit' => 'Ask the user whether to create a new theme or modify the active theme before continuing.',
        ]);
    }
}
```

Call it immediately after `resolve()` in `updateRootElements`, `upsertProfile`, and `appendProfileRequest`, before any storage or database write.

- [ ] **Step 2: Clone an explicit source Theme**

Refactor `create()` so the absence of `source_theme_id` creates the non-Default Theme record without copying Default storage objects or a Default style profile. When `source_theme_id` is supplied, resolve it, reject it if `is_default`, copy only non-page storage objects from `directory($sourceTheme)` to `directory($newTheme)`, and clone the source style-profile row with new create/update account IDs, timestamps, `version: 1`, and the new `site_page_id`.

For a custom source return:

```php
'source_theme' => $this->theme($sourceTheme),
'copied_scope' => 'theme_shell_and_style_profile',
```

- [ ] **Step 3: Add the policy payload**

Create one `themeEditPolicy(SitePage $theme): array` helper and include it in `designContext()` and `shellContext()`. Its `next_action` is `create_new_theme` for Default and `ask_create_or_modify` for custom active Theme.

- [ ] **Step 4: Keep confirmation metadata out of persistence**

Do not store `confirmed_active_theme_edit` in style profiles or returned design notes. It is request-control metadata only.

- [ ] **Step 5: Run focused and adjacent tests**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/McpV1ThemeTest.php tests/Feature/StorefrontPreviewPageRoutingTest.php tests/Feature/MediaLibraryUploadTest.php
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit only SaaS Theme files**

```bash
git add app/Services/Mcp/Content/ThemeService.php tests/Feature/McpV1ThemeTest.php
git commit -m "feat: protect immutable default themes"
```

### Task 5: Port the same backend invariant to Standalone

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-Standalone/app/Services/Mcp/Content/ThemeService.php`
- Create: `/Users/eric/Documents/SlimWeb-Standalone/tests/Feature/Standalone/McpThemePolicyTest.php`

- [ ] **Step 1: Write the Standalone failing tests**

Mirror the SaaS assertions for Default string/numeric rejection, active-custom confirmation, inactive custom writes, source-Theme shell/style-profile clone, page exclusion, and `theme_edit_policy` response. Use the Standalone fixed-site MCP request authentication helpers already used under `tests/Feature/Standalone/`.

- [ ] **Step 2: Run and confirm RED**

```bash
cd /Users/eric/Documents/SlimWeb-Standalone
php artisan test tests/Feature/Standalone/McpThemePolicyTest.php
```

Expected: FAIL for the same missing behavior as SaaS.

- [ ] **Step 3: Apply the same focused ThemeService implementation**

Port the exact `assertMutableTheme`, source clone, style-profile clone, and `themeEditPolicy` behavior from Webless. Do not introduce SaaS account/site selection behavior into Standalone.

Also preserve the same Default creation invariant: `create_from_default` creates no stored shell, and custom-source cloning rejects a Default `source_theme_id`.

- [ ] **Step 4: Run Standalone verification**

```bash
cd /Users/eric/Documents/SlimWeb-Standalone
php artisan test tests/Feature/Standalone/McpThemePolicyTest.php tests/Feature/Standalone/InternalMcpFullContractTest.php tests/Feature/Standalone/MigratedSiteSmokeTest.php
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Standalone backend files**

```bash
git add app/Services/Mcp/Content/ThemeService.php tests/Feature/Standalone/McpThemePolicyTest.php
git commit -m "feat: protect standalone default themes"
```

### Task 6: Release Core and update both MCP consumers

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/package.json`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/package-lock.json`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/toolContract.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/fixtures/saas-tool-contract.json`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/README.md`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone-MCP/package.json`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone-MCP/package-lock.json`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone-MCP/test/app.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-Standalone-MCP/README.md`

- [ ] **Step 1: Tag and publish Core**

After Core tests pass, push its commit and annotated tag:

```bash
git tag -a v0.1.6 -m "SlimWeb MCP Core v0.1.6"
git push origin main
git push origin v0.1.6
```

- [ ] **Step 2: Update SaaS MCP dependency and failing contract expectations**

Change the dependency to `github:ericchen1972/SlimWeb-MCP-Core#v0.1.6`, run `npm install`, then update tests to require `slimweb_themes_create_from_theme`, Default immutability wording, `confirmed_active_theme_edit`, and the active-Theme decision flow. Regenerate `test/fixtures/saas-tool-contract.json` from the actual `tools/list` response and update its count/hash constants only after manually inspecting the diff.

- [ ] **Step 3: Verify SaaS MCP**

```bash
cd /Users/eric/Documents/SlimWeb-MCP
npm test
docker build -t slimweb-mcp:theme-policy .
```

Expected: all tests pass and Docker build exits 0.

- [ ] **Step 4: Commit SaaS MCP consumer update**

```bash
git add package.json package-lock.json README.md test
git commit -m "feat: publish immutable theme workflow"
```

- [ ] **Step 5: Update and test Standalone MCP**

Update to Core `v0.1.6`, run `npm install`, assert the full-contract profile includes `slimweb_themes_create_from_theme` and the new schemas, then run:

```bash
cd /Users/eric/Documents/SlimWeb-Standalone-MCP
npm test
docker build -t slimweb-standalone-mcp:theme-policy .
```

Expected: all tests pass and Docker build exits 0.

- [ ] **Step 6: Commit Standalone MCP consumer update**

```bash
git add package.json package-lock.json README.md test
git commit -m "feat: publish standalone immutable themes"
```

### Task 7: Build the EasyDays one-time migration command with TDD

**Files:**
- Create: `/Users/eric/Documents/webless/app/Console/Commands/MigrateEasyDaysDefaultTheme.php`
- Create: `/Users/eric/Documents/webless/tests/Feature/MigrateEasyDaysDefaultThemeTest.php`

- [ ] **Step 1: Write failing safety tests**

Test these exact cases:

```php
$this->artisan('slimweb:migrate-easydays-default-theme', [
    'site_code' => 'swcb_wrong',
])->assertFailed();

$this->artisan('slimweb:migrate-easydays-default-theme', [
    'site_code' => 'swcb_bofnoha3vtoiehmq',
    '--target-theme-id' => $targetTheme->id,
    '--phase' => 'copy',
])->expectsOutputToContain('DRY RUN')->assertSuccessful();
```

Assert copy rejects a Default target ID and an already-active target. Assert cleanup fails when the expected target Theme is not active or when the backup manifest is absent.

- [ ] **Step 2: Test exact backup and cleanup scope**

Seed Default root elements, root CSS, a Default page body, and a style profile. Assert copy dry-run writes nothing. Assert copy apply writes the historical root objects into the target custom Theme, clones the style profile, backs up the sources to a timestamped `sites/{site}/template-backups/easydays-default-theme-*` prefix, and writes `manifest.json` with path/size/SHA-256. Then activate the target in the test and assert cleanup apply deletes the original Default root objects and style-profile row while preserving `templates/default/pages/index/content.blade.php` byte-for-byte.

- [ ] **Step 3: Run and confirm RED**

```bash
cd /Users/eric/Documents/webless
php artisan test tests/Feature/MigrateEasyDaysDefaultThemeTest.php
```

Expected: FAIL because the command does not exist.

- [ ] **Step 4: Implement the internal command**

Use this command contract:

```php
protected $signature = 'slimweb:migrate-easydays-default-theme
    {site_code}
    {--target-theme-id= : Required non-Default EasyDays Theme ID}
    {--phase=copy : copy or cleanup}
    {--apply : Apply the selected migration phase}';
```

Hard-code the allowed site code constant `swcb_bofnoha3vtoiehmq`. Resolve Default and the target non-Default Theme. Build the candidate object list only from:

```text
sites/{site_id}/templates/default/root-elements/
sites/{site_id}/templates/default/assets/root-elements/
```

In copy apply, back up each object through `GcsStorage::downloadIfExists()` and `upload()`, create and verify the JSON manifest, copy each source to the matching `schemes/{target_theme_id}` path, and clone the Default profile to the target. In cleanup apply, require that target Theme is active and the manifest hashes still match, then delete sources individually and delete only the Default Theme's style-profile row. Never call `deleteDirectory("sites/{site_id}/templates/default")`.

- [ ] **Step 5: Run GREEN tests and commit**

```bash
php artisan test tests/Feature/MigrateEasyDaysDefaultThemeTest.php tests/Feature/McpV1ThemeTest.php
git add app/Console/Commands/MigrateEasyDaysDefaultTheme.php tests/Feature/MigrateEasyDaysDefaultThemeTest.php
git commit -m "chore: add EasyDays default theme migration"
```

### Task 8: Deploy and verify contracts before touching EasyDays

**Files:**
- Verify only: deployment workflows and runtime endpoints

- [ ] **Step 1: Push SaaS and Standalone backend commits**

Push only after both PHP test suites are green. Deploy Webless using its documented Cloud Run procedure and publish the Standalone release using `/Users/eric/Documents/SlimWeb-Standalone/scripts/build-release-package.sh`; do not claim hosted Standalone parity until the target instance reports the new backend contract.

- [ ] **Step 2: Push both MCP consumers**

Push `SlimWeb-MCP` main to trigger production deployment. Push `SlimWeb-Standalone-MCP` main to create the no-traffic candidate.

- [ ] **Step 3: Verify deployed tool contracts**

For SaaS production and Standalone candidate, verify:

```text
tools/list contains slimweb_themes_create_from_theme
root/profile tools contain confirmed_active_theme_edit
tool descriptions state Default is immutable
literal theme_id=default writes fail before any backend mutation
```

Promote the Standalone candidate only after domain binding, OAuth, backend capability, and reversible non-Theme smoke checks pass.

### Task 9: Migrate EasyDays into its own Theme

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP/docs/acceptance/easydays-theme-migration-2026-08-22.md`

- [ ] **Step 1: Capture the live pre-migration state**

Call `slimweb_sites_list`, select `swcb_bofnoha3vtoiehmq`, and record active Default ID, shell context, root CSS hash, style-profile JSON, public URL, and screenshots at 320, 375, 430, 768, 1024, 1440, 1536, and 1800 CSS pixels.

- [ ] **Step 2: Create the new Theme before cleanup**

Call `slimweb_themes_create_from_default` with name `EasyDays`. Confirm the result is non-Default and inactive, has no stored custom shell/profile, and record the new Theme ID.

- [ ] **Step 3: Copy and verify the historical EasyDays shell**

Run `slimweb:migrate-easydays-default-theme` with the new Theme ID and `--phase=copy` first as a dry run, then with `--apply`. Read the new shell context and style profile. Confirm root CSS is byte-identical, the profile fields match, and preview behavior matches the current storefront. If any comparison fails, stop without activation or cleanup.

- [ ] **Step 4: Activate and verify the new Theme**

Activate the new `EasyDays` Theme, then re-read site selection/design context and verify `is_default: false`, `is_active: true`. Exercise navbar category states, recursive navigation, member modal, cart panel, scroll-to-top, AI assistant, footer links, and horizontal overflow at every required width.

- [ ] **Step 5: Run the maintenance command in dry-run mode**

Set the execution-environment variable `EASYDAYS_THEME_ID` to the exact positive numeric Theme ID recorded in Step 2, validate it with `test "$EASYDAYS_THEME_ID" -gt 0`, then run against the deployed Webless runtime or an equivalent one-off Cloud Run job with production database/GCS identity:

```bash
test "$EASYDAYS_THEME_ID" -gt 0
php artisan slimweb:migrate-easydays-default-theme \
  swcb_bofnoha3vtoiehmq \
  --target-theme-id="$EASYDAYS_THEME_ID" \
  --phase=cleanup
```

Save the exact object/profile deletion list to the acceptance report. Confirm no `templates/default/pages/` path appears.

- [ ] **Step 6: Apply the one-time repair**

After dry-run review:

```bash
php artisan slimweb:migrate-easydays-default-theme \
  swcb_bofnoha3vtoiehmq \
  --target-theme-id="$EASYDAYS_THEME_ID" \
  --phase=cleanup \
  --apply
```

Record the backup manifest path and hashes.

- [ ] **Step 7: Verify Default and active Theme independently**

Open the Default preview and confirm it uses the canonical system navbar/footer and contains no `.ed-shell-*` root CSS. Open the public active `EasyDays` Theme and repeat the full viewport/interaction checks. Confirm Default page body content and homepage remain unchanged.

### Task 10: Final cross-repository verification and handoff

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/docs/acceptance/easydays-theme-migration-2026-08-22.md`

- [ ] **Step 1: Run fresh local verification**

```bash
cd /Users/eric/Documents/SlimWeb-MCP-Core && npm test
cd /Users/eric/Documents/SlimWeb-MCP && npm test
cd /Users/eric/Documents/SlimWeb-Standalone-MCP && npm test
cd /Users/eric/Documents/webless && php artisan test tests/Feature/McpV1ThemeTest.php tests/Feature/MigrateEasyDaysDefaultThemeTest.php
cd /Users/eric/Documents/SlimWeb-Standalone && php artisan test tests/Feature/Standalone/McpThemePolicyTest.php tests/Feature/Standalone/InternalMcpFullContractTest.php
```

Expected: every command exits 0 with no failures.

- [ ] **Step 2: Check repository state and published revisions**

For all five repositories, record commit SHA, branch, `git status --short`, remote `main` SHA, and deployed revision/package identity. Preserve all unrelated pre-existing Webless changes.

- [ ] **Step 3: Complete the acceptance report**

Include test counts, Core tag, consumer tool count/hash, SaaS and Standalone deployment evidence, new EasyDays Theme ID, backup manifest, Default rejection responses for string and numeric IDs, and viewport results.

- [ ] **Step 4: Commit the acceptance report**

```bash
cd /Users/eric/Documents/SlimWeb-MCP
git add docs/acceptance/easydays-theme-migration-2026-08-22.md
git commit -m "docs: record EasyDays theme migration acceptance"
```
