# Web Admin and MCP Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add composable MCP tools that match Web admin's site-internal contact, deletion, Notion, category, order, waybill, newsletter, and media-library capabilities without exposing site deletion.

**Architecture:** Keep tool schemas and handlers in `src/app.js`, site-scoped data behavior in `src/weblessRepository.js`, and canonical Laravel-only behaviors behind authenticated Webless endpoints. Add small shared repository helpers for exact/partial Notion title matching, order-number batch validation, and media summaries; preserve independent tools rather than introducing an orchestration endpoint.

**Tech Stack:** Node.js ESM, MCP tool definitions, PostgreSQL repository queries, Webless Laravel JSON endpoints, Node test runner, Laravel feature tests where Webless behavior changes.

---

### Task 1: Verify baseline and lock the public tool inventory

**Files:**
- Modify: `test/app.test.js`
- Modify: `README.md`

- [ ] **Step 1: Run the current test suite**

Run: `lean-ctx -c "npm test"`
Expected: existing tests pass before feature changes.

- [ ] **Step 2: Add a failing discovery test for all approved tool names**

Extend the expected tool-name set in `test/app.test.js` with contact get/update; all missing delete tools; newsletter list/get/update/delete; Notion search/content; order status/recipient/delete; forward and return waybill URL tools; media stats and unused cleanup.

- [ ] **Step 3: Run the discovery test and verify RED**

Run: `node --test test/app.test.js`
Expected: FAIL because the new tools are not registered.

### Task 2: Contact settings parity

**Files:**
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`

- [ ] **Step 1: Add failing repository tests**

Cover all Web-editable contact fields, patch semantics, explicit-null clearing, site scope, and returned normalized settings.

- [ ] **Step 2: Verify repository RED**

Run: `node --test test/weblessRepository.test.js`
Expected: FAIL because contact get/update methods do not exist.

- [ ] **Step 3: Implement repository contact methods**

Add `getContactSettings(accountId, args)` and `updateContactSettings(accountId, args)` using the same site columns as Web admin, with omitted fields preserved and explicit null stored as null.

- [ ] **Step 4: Add failing app handler and permission tests**

Test schemas, calls, structured output, `settings` permission mapping, and audit fields.

- [ ] **Step 5: Implement independent contact tools**

Register `slimweb_contact_settings_get` and `slimweb_contact_settings_update` and wire handlers to the repository.

- [ ] **Step 6: Verify GREEN**

Run: `node --test test/weblessRepository.test.js test/app.test.js`
Expected: PASS.

### Task 3: Site-internal delete parity and newsletter management

**Files:**
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`

- [ ] **Step 1: Add failing repository delete tests**

Cover external assets, members, member coupon assignments, articles, newsletters, customer-service logs, discount codes, member tiers, threshold gifts, product add-ons, and orders. Assert site scoping, stable deleted IDs, and canonical relationship errors.

- [ ] **Step 2: Add failing newsletter read/update tests**

Cover pagination, get by stable ID, patch update, scheduling fields, audience data, and cross-site protection.

- [ ] **Step 3: Verify repository RED**

Run: `node --test test/weblessRepository.test.js`
Expected: FAIL for missing methods.

- [ ] **Step 4: Implement repository methods**

Reuse existing find helpers where present; add focused find/delete helpers where absent. Delete associated storage only where Web admin already does so. Do not add site deletion or coupon-template deletion.

- [ ] **Step 5: Add failing MCP tool tests**

Test independent schemas, permission maps, handlers, audit actions, stable IDs, and suggested tools.

- [ ] **Step 6: Implement delete and newsletter tools**

Register one narrow tool per operation and wire it to repository methods.

- [ ] **Step 7: Verify GREEN**

Run: `node --test test/weblessRepository.test.js test/app.test.js`
Expected: PASS.

### Task 4: Notion discovery and shared import/update resolution

**Files:**
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`
- Modify: `../webless/routes/web.php`
- Modify: `../webless/app/Http/Controllers/SiteAdminController.php`
- Modify: `../webless/tests/Feature/SiteAdminNotionArticleTest.php` or the existing Notion feature test

- [ ] **Step 1: Add failing Webless endpoint tests**

Cover authenticated MCP-secret access to title-filtered authorized Notion pages and safe converted page content, missing token, no match, and inaccessible page.

- [ ] **Step 2: Verify Laravel RED**

Run the targeted Laravel test from `../webless`.
Expected: FAIL because MCP-specific Notion endpoints do not exist.

- [ ] **Step 3: Implement narrow Webless Notion endpoints**

Reuse the existing Notion search request, `transformNotionPagesToTree`, and `NotionToHtml` converter. Return stable page IDs and converted safe HTML without importing an article.

- [ ] **Step 4: Add failing repository resolver tests**

Cover unique exact, multiple exact, partial-only, absent, imported, and unimported results. Import state must compare `articles.notion_page_id`.

- [ ] **Step 5: Implement repository Notion methods**

Add `searchNotionPages` and `getNotionPageContent`, call authenticated Webless endpoints, and return separate exact/partial arrays plus existing article IDs.

- [ ] **Step 6: Add failing app tool and guidance tests**

Test independent search/content tools and descriptions for import-versus-update behavior and image continuation guidance.

- [ ] **Step 7: Register Notion tools and shared model guidance**

Keep article create/update as the only final writes. Add no monolithic import tool.

- [ ] **Step 8: Verify GREEN**

Run targeted Laravel tests and `node --test test/weblessRepository.test.js test/app.test.js`.
Expected: PASS.

### Task 5: Require complete category assets and align image continuation rules

**Files:**
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`

- [ ] **Step 1: Add failing category creation tests**

Assert new categories reject missing SVG icon and reject missing 16:9 committed category image. Assert updates preserve unspecified existing assets and user-provided images bypass generation guidance.

- [ ] **Step 2: Verify RED**

Run: `node --test test/weblessRepository.test.js test/app.test.js`
Expected: FAIL because category image is currently optional.

- [ ] **Step 3: Implement minimal validation and guidance**

Require both assets only on create, retain patch behavior on update, and align tool descriptions with the shared continuous/reattachment/user-provided image priority.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/weblessRepository.test.js test/app.test.js`
Expected: PASS.

### Task 6: Explicit order mutations and atomic deletion

**Files:**
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`
- Modify: `../webless/routes/web.php`
- Modify: `../webless/app/Http/Controllers/SiteAdminController.php`
- Modify: existing Webless order feature tests

- [ ] **Step 1: Add failing Webless batch endpoint tests**

Cover status update, recipient update, and deletion by complete order numbers; invalid, duplicate, or cross-site input must produce zero writes. Cover `pending`, `confirmed`, `returning`, and `returned` canonical side effects.

- [ ] **Step 2: Verify Laravel RED**

Run targeted order feature tests.
Expected: FAIL because MCP-secret batch endpoints do not exist.

- [ ] **Step 3: Implement atomic Webless endpoints**

Resolve and lock all order numbers before mutation, then reuse canonical status and deletion logic inside transactions.

- [ ] **Step 4: Add failing repository and app tests**

Assert public schemas accept `order_numbers`, reject internal IDs, reject empty/duplicate values, and describe the current-user-instruction explicit-target rule.

- [ ] **Step 5: Implement repository methods and tools**

Add independent update-status, update-recipient, and delete tools. Do not infer order numbers from earlier list results.

- [ ] **Step 6: Verify GREEN**

Run targeted Laravel tests and Node tests.
Expected: PASS.

### Task 7: Waybill URL tools and query-selected batches

**Files:**
- Modify: Webless order/logistics feature tests
- Modify: `../webless/routes/web.php`
- Modify: `../webless/app/Http/Controllers/SiteAdminController.php`
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`

- [ ] **Step 1: Add failing Webless URL endpoint tests**

Cover single forward, batch forward, provider batch, and return waybill URLs with printable and non-printable orders.

- [ ] **Step 2: Implement URL-producing endpoints**

Return browser-accessible authenticated URLs and included/excluded order summaries without invoking a printer.

- [ ] **Step 3: Add failing repository and tool tests**

Cover explicit order numbers and stable IDs returned by `slimweb_orders_list` for query-selected batches. Verify the model guidance allows `not yet shipped` selection for printing but not mutation.

- [ ] **Step 4: Implement waybill tools**

Add single/batch forward and return URL tools. Extend successful logistics creation with `waybill_url` when available.

- [ ] **Step 5: Verify GREEN**

Run targeted Laravel and Node tests.
Expected: PASS.

### Task 8: Media-library statistics and unused cleanup

**Files:**
- Modify: `../webless/tests/Feature/MediaLibraryUploadTest.php`
- Modify: `../webless/routes/web.php`
- Modify: `../webless/app/Http/Controllers/SiteAdminController.php`
- Modify: `test/weblessRepository.test.js`
- Modify: `test/app.test.js`
- Modify: `src/weblessRepository.js`
- Modify: `src/app.js`

- [ ] **Step 1: Add failing Webless stats tests**

Create used and unused objects with known byte sizes. Assert total count/bytes and unused count/bytes.

- [ ] **Step 2: Add failing cleanup tests**

Assert only unused committed assets are deleted, used assets remain, an asset referenced between enumeration and deletion is skipped, and results include deleted/skipped/failed counts and bytes.

- [ ] **Step 3: Verify Laravel RED**

Run: targeted `MediaLibraryUploadTest`.
Expected: FAIL because stats and cleanup endpoints do not exist.

- [ ] **Step 4: Extract and implement shared media inventory behavior**

Reuse `mediaAssetUsage`; add stats and cleanup endpoints. Recheck usage immediately before each deletion and never accept a force flag.

- [ ] **Step 5: Add failing repository and app tests**

Test response normalization, permissions, schemas, handler calls, and audit behavior.

- [ ] **Step 6: Implement MCP media tools**

Add `slimweb_media_library_stats` and `slimweb_media_library_delete_unused`.

- [ ] **Step 7: Verify GREEN**

Run targeted Laravel and Node tests.
Expected: PASS.

### Task 9: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `src/app.js`
- Modify: relevant tests

- [ ] **Step 1: Update the tool table and detailed contracts**

Document inputs, outputs, side effects, confirmations, image continuation, explicit order targets, query-selected printing, and unused-media safety.

- [ ] **Step 2: Check contract alignment**

Run searches comparing registered tool names, README names, permission maps, and expected discovery names. Resolve omissions.

- [ ] **Step 3: Run JavaScript syntax and full tests**

Run: `node --check src/app.js && node --check src/weblessRepository.js && lean-ctx -c "npm test"`
Expected: syntax checks exit 0 and all Node tests pass.

- [ ] **Step 4: Run targeted and full Webless tests affected by new endpoints**

Run the relevant Notion, order/logistics, and media feature tests, followed by the practical full Webless test command if runtime permits.
Expected: all affected tests pass.

- [ ] **Step 5: Review the approved design requirement by requirement**

Confirm all eight user-requested areas are implemented and no site-delete tool was introduced.

- [ ] **Step 6: Inspect final diff**

Run: `lean-ctx -c "git diff --check && git status --short && git diff --stat"`
Expected: no whitespace errors; only scoped files changed.
