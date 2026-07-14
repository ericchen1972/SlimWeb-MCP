# Remove Product Category Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete fixed product-category depth setting from every active MCP and Webless contract while preserving the recursive category tree.

**Architecture:** SlimWeb-MCP basic settings stop selecting, normalizing, returning, and updating `product_category_depth`. Webless removes the stale admin data path and makes product import derive assignments solely from leaf categories. The legacy database column remains unused for compatibility.

**Tech Stack:** Node.js MCP server and `node:test`; Laravel/PHP, Vue, PHPUnit; PostgreSQL.

---

### Task 1: Lock the SlimWeb-MCP contract with failing tests

**Files:**
- Modify: `test/app.test.js`
- Modify: `test/weblessRepository.test.js`

- [ ] Assert `slimweb_settings_update.inputSchema.properties.product_category_depth` is absent and the settings description does not mention category depth.
- [ ] Assert basic-settings readback omits `product_category_depth` and update SQL does not contain the column.
- [ ] Run the focused Node tests and verify they fail because the field is still exposed and returned.

### Task 2: Remove the SlimWeb-MCP setting

**Files:**
- Modify: `src/app.js`
- Modify: `src/weblessRepository.js`
- Modify: `README.md`
- Modify: `test/app.test.js`
- Modify: `test/weblessRepository.test.js`

- [ ] Remove the schema property and description text.
- [ ] Remove the column from `BASIC_SETTINGS_COLUMNS`, update SQL parameters, normalization, validation, and response formatting.
- [ ] Remove documentation and stale fixtures.
- [ ] Run focused tests and verify they pass.

### Task 3: Lock Webless behavior with failing tests

**Files:**
- Modify: `/Users/eric/Documents/webless/tests/Feature/SiteBasicSettingsTest.php`
- Create: `/Users/eric/Documents/webless/tests/Feature/ProductImportCategoryTreeTest.php`

- [ ] Assert the basic-settings response omits `productCategoryDepth`.
- [ ] Import a product whose name contains a leaf category while the legacy site value is `1`; assert the product is assigned to that leaf.
- [ ] Run the focused PHPUnit tests and verify they fail for the stale response and import guard.

### Task 4: Remove Webless active usage

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/SiteAdminController.php`
- Modify: `/Users/eric/Documents/webless/app/Support/ProductImportService.php`
- Modify: `/Users/eric/Documents/webless/resources/js/pages/SiteAdminDashboardPage.vue`
- Modify: `/Users/eric/Documents/webless/resources/views/site-admin-dashboard.blade.php`
- Modify: `/Users/eric/Documents/webless/app/Support/UiText.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/SiteBasicSettingsTest.php`

- [ ] Remove validation, assignments, props/state, response fields, and unused copy for fixed depths.
- [ ] Remove the legacy-depth early return from product import so leaf matching always runs.
- [ ] Run focused tests and verify they pass.

### Task 5: Full verification

- [ ] Run `npm test` in SlimWeb-MCP.
- [ ] Run `php artisan test` and `npm run build` in Webless.
- [ ] Run `rg` over active source, tests, and docs; only the legacy model and migration may still contain `product_category_depth`.
- [ ] Run `git diff --check` in both repositories and review the complete diff.
