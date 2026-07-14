# Site Logo Basic Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, single-instance site logo replacement to existing basic-settings flows in SlimWeb-MCP and Webless.

**Architecture:** Webless provides one `SiteLogoManager` for raster/SVG normalization and storage. The manual admin controller and a private MCP bridge endpoint both call it; SlimWeb-MCP extends `slimweb_settings_get/update` and delegates logo replacement to that private endpoint without creating a new public tool.

**Tech Stack:** Node.js 20, MCP JSON schemas, PostgreSQL, PHP 8.2, Laravel, GD, PHPUnit, Node test runner

---

### Task 1: Add Webless logo normalization tests

**Files:**
- Modify: `/Users/eric/Documents/webless/tests/Unit/MediaImageTransformerTest.php`
- Create: `/Users/eric/Documents/webless/tests/Unit/SiteLogoManagerTest.php`

- [ ] **Step 1: Write failing raster transform tests**

Add a test that calls `MediaImageTransformer::containToWebp($binary, 96)` with a 400x200 PNG and asserts WebP output at 192x96, plus a 40x20 input that remains 40x20.

- [ ] **Step 2: Run the raster tests and verify RED**

Run: `php artisan test tests/Unit/MediaImageTransformerTest.php`

Expected: FAIL because `containToWebp` does not exist.

- [ ] **Step 3: Implement the reusable contain transform**

Add `public function containToWebp(string $binary, int $maxHeight): array` and route the existing `transform()` through a shared private method. Preserve alpha, reject empty/unsupported bytes, and never upscale.

- [ ] **Step 4: Run the raster tests and verify GREEN**

Run: `php artisan test tests/Unit/MediaImageTransformerTest.php`

Expected: PASS.

- [ ] **Step 5: Write failing SiteLogoManager tests**

Cover raster WebP storage at height 96, safe SVG storage, rejection of `<script>`/event/external references, deletion of the previous logo only after success, and deletion of an MCP committed staging path after success.

- [ ] **Step 6: Run manager tests and verify RED**

Run: `php artisan test tests/Unit/SiteLogoManagerTest.php`

Expected: FAIL because `App\Support\SiteLogoManager` does not exist.

### Task 2: Implement the shared Webless logo manager

**Files:**
- Create: `/Users/eric/Documents/webless/app/Support/SiteLogoManager.php`
- Modify: `/Users/eric/Documents/webless/app/Support/MediaImageTransformer.php`
- Test: `/Users/eric/Documents/webless/tests/Unit/SiteLogoManagerTest.php`

- [ ] **Step 1: Implement raster normalization**

`SiteLogoManager::replaceFromBytes(Site $site, string $bytes, string $mimeType, ?string $stagingPath = null)` must call `containToWebp(..., 96)`, store `sites/{id}/settings/logo-{sha256-prefix}.webp`, save `icon_path`, then delete the prior path and optional staging path.

- [ ] **Step 2: Implement SVG normalization**

Decode SVG text, enforce a 1 MB limit, remove XML/doctype, reject scripts, event attributes, `foreignObject`, external `href`/`xlink:href`, CSS `url(...)`, and malformed root/viewBox dimensions. Store sanitized SVG as `logo-{sha256-prefix}.svg` with height no greater than 96 and proportional width.

- [ ] **Step 3: Run manager tests and verify GREEN**

Run: `php artisan test tests/Unit/SiteLogoManagerTest.php tests/Unit/MediaImageTransformerTest.php`

Expected: PASS.

### Task 3: Apply shared behavior to Webless admin and MCP bridge

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/SiteAdminController.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/webless/resources/js/pages/SiteAdminDashboardPage.vue`
- Modify: `/Users/eric/Documents/webless/tests/Feature/SiteBasicSettingsTest.php`

- [ ] **Step 1: Write failing manual-upload tests**

Upload a 400x200 PNG to `sites.basic-settings.update`, assert the stored object is WebP at 192x96, assert `sites.icon_path` points at it, then replace it and assert the first object is gone. Upload a safe SVG and assert it remains SVG.

- [ ] **Step 2: Write failing MCP bridge tests**

POST an authenticated internal request to `/sites/{site}/mcp-basic-settings/logo` using `media_path`, then `svg_base64`; assert the same manager behavior and returned `logo` metadata.

- [ ] **Step 3: Run feature tests and verify RED**

Run: `php artisan test tests/Feature/SiteBasicSettingsTest.php`

Expected: FAIL because the controller still writes PNG and the bridge route does not exist.

- [ ] **Step 4: Wire the controller and route**

Replace `storeSiteIcon` with `SiteLogoManager`, allow JPEG/PNG/WebP/SVG up to 5 MB in manual basic settings, add the internal-secret-protected logo endpoint, and set the file input accept list to `image/jpeg,image/png,image/webp,image/svg+xml`.

- [ ] **Step 5: Run Webless focused tests and verify GREEN**

Run: `php artisan test tests/Unit/MediaImageTransformerTest.php tests/Unit/SiteLogoManagerTest.php tests/Feature/SiteBasicSettingsTest.php tests/Feature/McpUploadTest.php`

Expected: PASS.

### Task 4: Extend the SlimWeb-MCP basic-settings contract

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/app.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/README.md`

- [ ] **Step 1: Write failing MCP schema and dispatch tests**

Assert `slimweb_settings_update.inputSchema.properties.logo` accepts either `media_path` or `svg_base64`, `slimweb_settings_get` returns logo metadata, and dispatch passes the logo request to `updateBasicSettings`.

- [ ] **Step 2: Write failing repository tests**

Assert settings readback exposes `icon_path` as logo metadata and logo updates POST to `mcp-basic-settings/logo` while ordinary settings updates retain current database behavior.

- [ ] **Step 3: Run SlimWeb-MCP focused tests and verify RED**

Run: `npm test -- --test-name-pattern='basic settings|logo'`

Expected: FAIL because the logo schema and bridge call are absent.

- [ ] **Step 4: Implement the MCP extension**

Add the `logo` schema, include `icon_path` in schema-tolerant settings reads, format public logo metadata, validate exactly one logo source, call the Webless private endpoint for logo replacement, and update MCP guidelines/descriptions.

- [ ] **Step 5: Update README documentation**

Document the raster signed-upload flow, `svg_base64` flow, WebP/96px rules, single-instance cleanup, and settings readback fields.

- [ ] **Step 6: Run SlimWeb-MCP focused tests and verify GREEN**

Run: `npm test -- --test-name-pattern='basic settings|logo'`

Expected: PASS.

### Task 5: Full verification, commit, deploy, and live checks

**Files:**
- Verify all modified files in both repositories.

- [ ] **Step 1: Run full local verification**

Run in Webless: `php artisan test && npm run build`

Run in SlimWeb-MCP: `npm test`

Expected: all tests and the frontend build pass.

- [ ] **Step 2: Commit Webless**

Run: `git add app/Support/MediaImageTransformer.php app/Support/SiteLogoManager.php app/Http/Controllers/SiteAdminController.php routes/web.php resources/js/pages/SiteAdminDashboardPage.vue tests/Unit/MediaImageTransformerTest.php tests/Unit/SiteLogoManagerTest.php tests/Feature/SiteBasicSettingsTest.php && git commit -m "feat: normalize site logo uploads"`

- [ ] **Step 3: Deploy and verify Webless**

Run: `scripts/deploy-cloud-run.sh --promote`

Expected: candidate verification succeeds and production traffic is promoted.

- [ ] **Step 4: Commit and push SlimWeb-MCP**

Run: `git add src/app.js src/weblessRepository.js test/app.test.js test/weblessRepository.test.js README.md docs/superpowers/specs/2026-07-14-site-logo-basic-settings-design.md docs/superpowers/plans/2026-07-14-site-logo-basic-settings.md && git commit -m "feat: manage site logo in basic settings" && git push origin main`

- [ ] **Step 5: Verify both live services**

Wait for the SlimWeb-MCP GitHub Actions deploy to succeed, then check the Webless public ready/health URL used by its deployment script and `https://slimweb-mcp-aakwcbp2ca-de.a.run.app/readyz`.

Expected: both return successful readiness responses from the new revisions.
