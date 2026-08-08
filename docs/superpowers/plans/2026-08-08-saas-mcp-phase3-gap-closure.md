# SaaS MCP Phase 3 Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the five remaining pre-Phase-4 SaaS MCP paths through the versioned Webless Backend API without changing the 125-tool public contract.

**Architecture:** Webless owns tenant authorization, external-asset persistence, page/article SEO metadata storage, and external image download/storage. SlimWeb-MCP retains public schemas, OpenAI file-parameter normalization, orchestration, and response normalization, but delegates every authoritative read/write to `WeblessBackendClient`.

**Tech Stack:** Laravel 12, Eloquent, GCS storage abstraction, Node.js 20, native Node test runner, Cloud Run.

---

### Task 1: Close `slimweb_site_select`

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/ThemeController.php`
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/ThemeService.php`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/slimWebBackend.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Test: `/Users/eric/Documents/webless/tests/Feature/McpV1ThemeTest.php`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessBackendClient.test.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`

- [ ] Add a failing Webless test proving `GET /themes?include_default=1` returns Default while the ordinary list still omits it.
- [ ] Add failing Node tests proving site selection resolves the actor and requests the internal theme list with `include_default=1`.
- [ ] Extend `ThemeService::listing(Site $site, bool $includeDefault = false)` and map `selectSiteForAdminIdentity()` entirely through `WeblessBackendClient`.
- [ ] Run the focused PHP and Node tests and confirm they pass.

### Task 2: Move external assets behind Webless

**Files:**
- Create: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/ExternalAssetController.php`
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Content/ExternalAssetService.php`
- Create: `/Users/eric/Documents/webless/tests/Feature/McpV1ExternalAssetTest.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/slimWebBackend.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessBackendClient.test.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`

- [ ] Write failing site-scope, permission, list, and delete tests for `GET/DELETE /external-assets`.
- [ ] Implement `ExternalAssetService` using `SiteExternalAsset` and stable payload formatting.
- [ ] Add `listExternalAssets()` and `deleteExternalAsset()` Backend Client methods and replace both direct SQL repository bodies.
- [ ] Run focused PHP and Node tests and confirm they pass.

### Task 3: Move content SEO persistence behind Webless

**Files:**
- Create: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/ContentSeoController.php`
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Content/ContentSeoService.php`
- Create: `/Users/eric/Documents/webless/tests/Feature/McpV1ContentSeoTest.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/slimWebBackend.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessBackendClient.test.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`

- [ ] Write failing page/article workflow tests covering required workflow context, tenant scope, validation, and storage output.
- [ ] Implement one idempotent `PUT /content/seo` operation that writes the existing page/article metadata paths through `GcsStorage`.
- [ ] Add `updateContentSeo()` to the Backend Client and replace the direct storage/SQL repository body.
- [ ] Run focused PHP and Node tests and confirm they pass.

### Task 4: Move ChatGPT attachment image handling behind Webless

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/MediaController.php`
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/MediaAssetService.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1MediaTest.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/slimWebBackend.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessBackendClient.test.js`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`

- [ ] Write failing tests proving Webless downloads a public PNG/JPEG/WebP URL, rejects private/invalid targets, stores it under the selected site, and returns the existing `asset` and `upload` shape.
- [ ] Add idempotent `POST /media/imports/chatgpt-attachment` and service logic that owns download and storage.
- [ ] Keep pure OpenAI file-parameter normalization in MCP, then delegate the normalized URL/filename/mime/target usage to Webless.
- [ ] Run focused PHP and Node tests and confirm they pass.

### Task 5: Harden, verify, deploy, and correct acceptance evidence

**Files:**
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/SiteContextController.php`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/docs/superpowers/specs/2026-08-08-saas-mcp-backend-interface-design.md`
- Test: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`

- [ ] Add an architecture test that extracts the five repository methods and rejects direct `.pool`, `.storage`, signed-upload orchestration, and direct theme-list helpers.
- [ ] Update the Webless v1 capability list for external assets, content SEO, and external image import.
- [ ] Run PHP formatting, the full Webless suite, the full MCP suite, and the frozen 125-tool hash test.
- [ ] Deploy Webless first, then SlimWeb-MCP; verify `/up`, `/readyz`, authorization failure, authenticated safe reads, and a same-value/reversible write.
- [ ] Correct Phase 3 acceptance evidence with final test counts and production revisions, then commit and push `main`.
