# Sweety Full SaaS MCP Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate all 125 public SaaS SlimWeb MCP tools against Sweety, repair and deploy every confirmed defect, and leave Sweety as a complete Modern Romantic women's fashion storefront with QA-only records removed.

**Architecture:** Use the live MCP as the system under test and its frozen tool fixture as the inventory. Execute one domain workflow at a time, verify every mutation through an authoritative read or preview, and record one outcome per tool. Confirmed defects follow a strict reproduce → regression test → minimal Webless or MCP repair → repository regression → candidate deployment → live MCP retest loop.

**Tech Stack:** Node.js 20 MCP service and tests, Laravel/PHPUnit Webless Backend API, PostgreSQL, GCS media, Cloud Run candidate deployments, SlimWeb MCP tools, browser desktop/mobile verification.

---

## File Map

### SlimWeb-MCP

- Create `scripts/sweetyAcceptanceLedger.mjs`: generate and validate the 125-row acceptance ledger from the frozen tool contract.
- Create `test/sweetyAcceptanceLedger.test.js`: prove the ledger contains each frozen tool exactly once and no invalid status.
- Create `docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`: durable live-call matrix, fixture inventory, defect evidence, revisions, cleanup, and browser results.
- Modify `src/backends/weblessBackendClient.js`, `src/weblessRepository.js`, or focused tests only when a reproduced defect is proven to be in MCP transport/delegation.

### Webless

- Modify the narrow controller/service under `app/Http/Controllers/Internal/McpV1/` or `app/Services/Mcp/` responsible for a reproduced defect.
- Add the regression to the matching `tests/Feature/McpV1*Test.php` file before production code.
- Modify `resources/js`, Blade, or storefront tests only when browser verification proves a storefront rendering defect rather than an MCP contract defect.
- Refresh committed Vite output only when frontend source changes.

No test-specific production endpoint, direct database mutation path, or broad fallback route will be added.

## Fixed Acceptance Inputs

- Site name: `Sweety`
- Site code: `swcb_g3fg1bpnjulrr75o`
- Domain: `shop.sweety.tw`
- Frozen tool count: `125`
- Frozen contract hash: `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`
- Visual direction: Modern Romantic
- Palette intent: cream white, dusty pink, wine red
- Brand promise: `穿上喜歡的自己`
- Permanent product count: `12`
- Permanent categories: `洋裝`, `上衣`, `針織`, `下身`, `外套`, `配件`
- External policy: test data and test providers only; no real email, Facebook, Notion publishing, payment, or production shipment.

## Defect Loop Used by Every Task

When a live MCP call is not the documented success or expected safe error:

1. Record the exact tool, arguments with secrets redacted, response, request ID, and current object state.
2. Repeat the same call once to prove reproducibility; do not mutate code.
3. Trace MCP orchestration → `weblessBackendClient` → Webless route/controller/service → persistence/storage → response normalization.
4. State one root-cause hypothesis in the verification document.
5. Add a focused failing test to the owning repository and run only that test to confirm RED.
6. Apply one minimal repair with `apply_patch`.
7. Run the focused test to confirm GREEN, then the relevant domain suite and full owning-repository suite.
8. Confirm the 125-tool fixture and hash are unchanged with `npm test` in SlimWeb-MCP.
9. Commit the repair to `main`, deploy a no-traffic candidate, verify health and the fixed request, then promote.
10. Repeat the original public MCP call and read-back; mark the matrix row only after live evidence.

Stop and discuss architecture after three failed hypotheses for the same defect.

### Task 1: Create the 125-tool acceptance ledger

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP/scripts/sweetyAcceptanceLedger.mjs`
- Create: `/Users/eric/Documents/SlimWeb-MCP/test/sweetyAcceptanceLedger.test.js`
- Create: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Read: `/Users/eric/Documents/SlimWeb-MCP/test/fixtures/saas-tool-contract.json`

- [ ] **Step 1: Write the failing ledger test**

Create a test that imports `buildRows` and asserts count, uniqueness, frozen hash, site code, allowed statuses, and domain classification:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildRows, classifyDomain, ACCEPTANCE } from '../scripts/sweetyAcceptanceLedger.mjs';

const contract = JSON.parse(readFileSync(new URL('./fixtures/saas-tool-contract.json', import.meta.url), 'utf8'));

test('Sweety acceptance ledger covers the frozen 125-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);
  assert.equal(contract.count, 125);
  assert.equal(contract.sha256, 'd6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871');
  assert.equal(rows.length, 125);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 125);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) =>
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  ));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/sweetyAcceptanceLedger.test.js
```

Expected: FAIL because `scripts/sweetyAcceptanceLedger.mjs` does not exist.

- [ ] **Step 3: Implement the ledger generator**

Implement the generator with an explicit frozen-contract guard and deterministic domain classification:

```js
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCEPTANCE = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  PASS_SUCCESS: 'PASS_SUCCESS',
  PASS_EXPECTED_ERROR: 'PASS_EXPECTED_ERROR',
  FAIL_DEFECT: 'FAIL_DEFECT',
});

const SITE_CODE = 'swcb_g3fg1bpnjulrr75o';
const EXPECTED_COUNT = 125;
const EXPECTED_HASH = 'd6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871';

const DOMAIN_RULES = [
  ['identity', /_(auth_status|sites_list|site_select)$/],
  ['orders', /_(orders_|returns_|refunds_)/],
  ['promotions_members', /_(coupon_|discount_|threshold_|member)/],
  ['catalog', /_(categories_|products_|product_)/],
  ['content_navigation', /_(pages_|articles_|content_seo|nav_items_)/],
  ['theme_media', /_(theme|design_context|assets_|uploads_|images_|external_assets_|media_library|preview_)/],
  ['communications_integrations', /_(mail_|newsletters_|customer_service_|facebook_|notion_|posters_)/],
  ['settings_operations', /_(settings_|site_|dashboard_|payment_|admins_|audit_|exports_|debug_)/],
];

export function classifyDomain(tool) {
  return DOMAIN_RULES.find(([, pattern]) => pattern.test(tool))?.[0] ?? 'settings_operations';
}

export function buildRows(tools) {
  return tools.map(({ name }) => ({
    tool: name,
    siteCode: SITE_CODE,
    domain: classifyDomain(name),
    prerequisite: '',
    expected: '',
    actual: '',
    status: ACCEPTANCE.NOT_RUN,
    cleanup: '',
    evidence: '',
  }));
}

export function assertFrozen(contract) {
  if (contract.count !== EXPECTED_COUNT || contract.sha256 !== EXPECTED_HASH) {
    throw new Error(`Unexpected MCP contract: ${contract.count}/${contract.sha256}`);
  }
}

export function renderMarkdown(rows) {
  const header = '| Tool | Domain | Prerequisite | Expected | Actual | Status | Cleanup | Evidence |\n|---|---|---|---|---|---|---|---|';
  return [header, ...rows.map((row) =>
    `| ${row.tool} | ${row.domain} |  |  |  | ${row.status} |  |  |`
  )].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtureUrl = new URL('../test/fixtures/saas-tool-contract.json', import.meta.url);
  const contract = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
  assertFrozen(contract);
  process.stdout.write(`${renderMarkdown(buildRows(contract.tools))}\n`);
}
```

- [ ] **Step 4: Run focused and full MCP tests**

Run:

```bash
node --test test/sweetyAcceptanceLedger.test.js
npm test
```

Expected: focused PASS; full suite PASS; frozen tool test reports 125 and the fixed SHA-256.

- [ ] **Step 5: Generate and seed the verification document**

Run:

```bash
node scripts/sweetyAcceptanceLedger.mjs > docs/verification/2026-08-09-sweety-full-mcp-acceptance.md
```

Prepend the fixed acceptance inputs, baseline launch/readiness evidence, current empty counts, QA fixture inventory, defect log, deployment log, cleanup checklist, and browser checklist. Preserve all 125 generated rows.

- [ ] **Step 6: Commit the ledger foundation**

```bash
git add scripts/sweetyAcceptanceLedger.mjs test/sweetyAcceptanceLedger.test.js docs/verification/2026-08-09-sweety-full-mcp-acceptance.md
git commit -m "test: add Sweety MCP acceptance ledger"
```

### Task 2: Repair and retest empty-site design context

**Files:**
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1ThemeTest.php`
- Modify: `/Users/eric/Documents/webless/app/Services/Mcp/Content/ThemeService.php`
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`

- [ ] **Step 1: Preserve the live reproduction**

Call `slimweb_design_context_get` with `site_code=swcb_g3fg1bpnjulrr75o` and record the existing `No query results for model [App\Models\SitePage]` failure as `FAIL_DEFECT` without changing data.

- [ ] **Step 2: Write the failing Laravel regression**

Add a test that creates an authorized site with no `site_pages` row, requests `/internal/mcp/v1/sites/{siteCode}/design-context` with the `slimweb_design_context_get` actor headers, and expects HTTP 200, Tailwind framework, light mode, and a usable Default theme context.

- [ ] **Step 3: Run the regression and verify RED**

Run:

```bash
php artisan test tests/Feature/McpV1ThemeTest.php --filter=empty_site_design_context
```

Expected: FAIL with model not found.

- [ ] **Step 4: Trace the Default-theme invariant and implement the minimal repair**

Confirm whether the missing row comes from legacy site creation or an invalid `ThemeService::resolve()` assumption. Implement one focused helper in `ThemeService` that returns or creates the canonical Default identity for a site without creating a parallel content authority. Reuse that helper wherever read-only design context requires Default. Do not add an MCP fallback response detached from Webless storage rules.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```bash
php artisan test tests/Feature/McpV1ThemeTest.php
php artisan test tests/Feature/McpV1PageTest.php tests/Feature/McpV1SiteContextTest.php
php artisan test
```

Expected: all PASS with no warning or exception.

- [ ] **Step 6: Commit, deploy candidate, promote, and live-retest**

```bash
git add app/Services/Mcp/Content/ThemeService.php tests/Feature/McpV1ThemeTest.php
git commit -m "fix: support MCP design context on empty sites"
scripts/deploy-cloud-run.sh --promote
```

Verify `/up` returns 200, repeat `slimweb_design_context_get`, and update the ledger row with the commit, Cloud Run revision, request ID, and returned design context.

### Task 3: Validate identity, settings, readiness, audit, and exports

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional MCP fixes: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`, `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`, and matching tests.
- Conditional Webless fixes: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/BasicSettingsController.php`, `SiteContextController.php`, `OperationalSettingsController.php`, and matching feature tests.

- [ ] **Step 1: Reconfirm site scoping**

Call in order: `slimweb_sites_list`, `slimweb_site_select`, `slimweb_auth_status`, and record Sweety's stable site code and administrator permissions. Use `swcb_g3fg1bpnjulrr75o` in every later call.

- [ ] **Step 2: Exercise settings and site-mode tools**

Read basic settings, site theme mode, SEO, contact, Facebook, Notion, payment/logistics, mail delivery, customer-service settings, launch progress, readiness, and dashboard summary. Update only reversible site fields needed by the approved Sweety baseline, then read each surface again.

- [ ] **Step 3: Exercise operational reads and safe writes**

Call audit list, export create, debug attachment references, media stats, admin list, and integration settings reads. Export output must be generated without leaking credentials. Unconfigured Facebook/Notion operations receive `PASS_EXPECTED_ERROR` only when the error is stable and side-effect free.

- [ ] **Step 4: Run the defect loop for every unexpected result**

Use the exact owning controller/service and its matching `McpV1*Test.php`. Do not combine independent failures into one patch or commit.

- [ ] **Step 5: Update the ledger and checkpoint**

Every tool in this domain must have actual result, evidence, status, and cleanup. Re-run `npm test` in SlimWeb-MCP and `php artisan test` in Webless before moving forward.

### Task 4: Build and validate Sweety media, theme, and homepage

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional Webless fixes: `app/Services/Mcp/Content/MediaAssetService.php`, `ThemeService.php`, `PageService.php`, controllers, and matching tests.

- [ ] **Step 1: Inspect before writes**

Call `slimweb_design_context_get`, `slimweb_themes_list`, `slimweb_site_theme_mode_get`, `slimweb_pages_list`, `slimweb_pages_get_content` for `index`, `slimweb_media_library_stats`, `slimweb_external_assets_list`, and `slimweb_theme_style_profile_get` when a custom theme exists.

- [ ] **Step 2: Generate and upload permanent image assets**

Create coherent Modern Romantic hero, category, editorial, and product assets. Exercise `slimweb_uploads_create` → byte upload → `slimweb_uploads_commit`, `slimweb_assets_upload`, `slimweb_images_import_chatgpt_attachment`, `slimweb_product_image_reference_prepare`, and external-asset reads/deletes using permanent and disposable assets. Reference only committed `media_path` values in permanent content.

- [ ] **Step 3: Create and configure the Sweety theme**

Call `slimweb_themes_create_from_default`, `slimweb_theme_style_profile_upsert`, `slimweb_theme_style_profile_append_request`, `slimweb_themes_update_root_elements`, `slimweb_themes_activate`, and `slimweb_site_theme_mode_update`. The navbar must contain exactly the three required runtime slots; Theme fragments contain no JavaScript or live category/navigation records.

- [ ] **Step 4: Build the permanent homepage**

Update `index` with hero, category paths, featured products, styling story, brand promise, first-purchase offer, and the `client_mcp_url` discovered from settings. Use page-scoped scripts only when necessary and only declared enabled libraries.

- [ ] **Step 5: Verify reads and previews**

Call theme shell context, style profile get, themes list, pages get content, preview URL, design context, and site mode get. Open the preview at desktop and mobile widths and record image, slot, navigation, layout, and overflow results.

- [ ] **Step 6: Exercise disposable delete paths**

Create a QA theme and unused assets, then call themes delete, external assets delete, and media library delete unused. Verify the active Sweety theme and referenced permanent media remain.

- [ ] **Step 7: Run all discovered defect loops and update the ledger**

Run relevant Webless theme/page/media/upload suites plus the full suite after each repair; deploy and live-retest before marking rows.

### Task 5: Build and validate catalog, products, import, and merchandising

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional Webless fixes: `app/Services/Mcp/Catalog/*`, `app/Services/Mcp/Commerce/MerchandisingService.php`, matching controllers and tests.

- [ ] **Step 1: Inspect catalog state**

Call category list, product list with all statuses, add-on list, and threshold-gift list.

- [ ] **Step 2: Create six permanent leaf categories**

Use category upsert for 洋裝、上衣、針織、下身、外套、配件, then re-read the tree and retain their stable IDs. Create one `MCP QA 分類`, verify it, delete it, and verify absence.

- [ ] **Step 3: Create exactly twelve permanent products**

Use product upsert with one of the six leaf categories, active status, meaningful price, stock, description, variants, and committed image references. Create this fixed catalog and re-read every product:

1. 花語方領洋裝 — 洋裝 — NT$1,680
2. 微光緞面長洋裝 — 洋裝 — NT$2,180
3. 雲朵褶袖襯衫 — 上衣 — NT$1,280
4. 柔霧羅紋上衣 — 上衣 — NT$980
5. 奶油麻花針織 — 針織 — NT$1,480
6. 輕柔短版開襟衫 — 針織 — NT$1,380
7. 垂墜西裝寬褲 — 下身 — NT$1,580
8. 高腰 A 字長裙 — 下身 — NT$1,480
9. 晨霧短版風衣 — 外套 — NT$2,380
10. 柔粉針織外套 — 外套 — NT$1,880
11. 酒紅迷你肩背包 — 配件 — NT$1,280
12. 珍珠蝴蝶結髮夾 — 配件 — NT$480

Apparel products receive appropriate color and size variants; accessories receive color or one-size variants. Verify filtered product lists after all twelve reads pass.

- [ ] **Step 4: Exercise image, add-on, and gift workflows**

Call product image reference prepare, create/update/list/delete a QA add-on, and create/update/list/delete a QA threshold gift. Keep only the approved permanent threshold gift.

- [ ] **Step 5: Exercise import inspect, validate, and commit**

Use the public product-detail URL of the first permanent Sweety product created in Step 3 as the single-product source. Inspect it, validate the mapped category and media, commit one renamed product `MCP QA Import`, read it, and delete it. Re-read products to prove no duplicate remains.

- [ ] **Step 6: Exercise product deletion safely**

Create a disposable `MCP QA Product`, read/update it, delete it, and verify the permanent twelve are unchanged.

- [ ] **Step 7: Run defect loops, regression suites, deployment, and ledger updates**

Use `McpV1CatalogReadTest.php`, `McpV1CatalogWriteTest.php`, `McpV1MerchandisingTest.php`, and focused legacy product tests as appropriate.

### Task 6: Build and validate pages, articles, navigation, SEO, and contact

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional Webless fixes: content services/controllers and matching `McpV1ArticleTest.php`, `McpV1PageTest.php`, `McpV1ContentSeoTest.php`, and catalog navigation tests.

- [ ] **Step 1: Inspect inventories and title availability**

Call page list, article list, navigation list, page title check, and article title check.

- [ ] **Step 2: Create permanent content**

Create or update About Sweety, size guide, shipping and returns, and contact pages. Create three articles: seasonal styling, dress selection, and knitwear care. Read each content body after the write.

- [ ] **Step 3: Apply content SEO**

Call content SEO update for the homepage, permanent pages, articles, and representative product content. Re-read content or preview URLs to confirm stored metadata.

- [ ] **Step 4: Create ordinary navigation independently**

Create Home, All Products, Journal, About, and Shopping Guide links only. Do not mirror the six product categories into ordinary navigation. Re-read and verify the recursive tree.

- [ ] **Step 5: Exercise update and delete tools**

Create `MCP QA Page`, `MCP QA Article`, and `MCP QA Nav`; read/update each, delete each, and verify absence. Permanent content remains.

- [ ] **Step 6: Complete site SEO and contact settings**

Write a complete baseline from the known brand, domain, content, and Taiwan market. Do not invent a legal entity, tax number, phone, address, or business email; omit or preserve unknown merchant facts.

- [ ] **Step 7: Run defect loops and update the ledger**

Verify all permanent public and preview URLs and record results.

### Task 7: Validate promotions, tiers, members, coupons, newsletters, and administrators

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional Webless fixes: member/promotion and communication/admin services/controllers/tests.

- [ ] **Step 1: Inspect current promotion and people state**

Call coupon-template list, discount-code list, threshold-gift list, member-tier list, member list, newsletter list, and admin list.

- [ ] **Step 2: Create permanent promotions**

Create the first-purchase 10% coupon template and `WELCOME10` discount code. Configure free shipping at NT$2,000 through the supported shipping-fee settings, not through an invented discount-code type. Create the approved threshold gift as a reusable Sweety accessory. Read each surface and confirm dates, scope, limits, and active state.

- [ ] **Step 3: Exercise disposable promotion CRUD**

Create/update/list/delete one `MCP QA` coupon template, discount code, threshold gift, and member tier.

- [ ] **Step 4: Create a disposable member through supported storefront flow**

Use the customer-facing authentication or checkout path rather than direct database insertion. Call member list/get, issue a QA coupon, verify it, revoke it, verify revocation, and delete the disposable member after order tests no longer need it.

- [ ] **Step 5: Exercise newsletter CRUD without sending**

Create/read/update/list/delete a `MCP QA Newsletter` draft. Keep any permanent welcome draft only if it is clearly non-sending.

- [ ] **Step 6: Exercise administrator CRUD safely**

Create/list/update/delete the separate administrator email `eric.chen1972+slimweb-mcp-qa@gmail.com` with the minimum permissions required by the schema. Confirm the current system administrator remains present and unchanged.

- [ ] **Step 7: Run defect loops and update the ledger**

Use `McpV1MemberPromotionTest.php`, `McpV1CommunicationAdminTest.php`, and `McpMemberEmailTest.php` for regressions.

### Task 8: Validate mail, customer service, Facebook, Notion, posters, and operational tools

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional Webless fixes: operational/integration services, controllers, and matching feature tests.

- [ ] **Step 1: Validate email configuration surfaces**

Call mail delivery get/update with a no-secret reversible validation case, mail templates get/update, and mail layout get/update. Restore sensitive existing delivery settings exactly; keep approved Sweety template and layout copy. Do not send mail.

- [ ] **Step 2: Validate customer-service settings and logs**

Read/update customer-service settings, generate a disposable log through the supported storefront customer-service flow when available, list it, delete it, and confirm deletion. If safe log creation is unavailable, call delete with a nonexistent QA identifier and require the documented `NOT_FOUND` error while using the automated success-path test for deletion coverage.

- [ ] **Step 3: Validate Facebook and Notion safely**

Call settings get/update only with reversible non-secret fields. Call Notion search/content and require either correct read-only results or stable unconfigured authorization errors. Do not publish externally.

- [ ] **Step 4: Validate poster and export tools**

Create one Sweety campaign poster, verify its result and media reference, and keep it only if visually coherent. Create an export and verify the artifact can be accessed without leaking credentials.

- [ ] **Step 5: Validate audit and attachment diagnostics**

Call audit list and debug attachment references after representative mutations, confirm site isolation and redaction.

- [ ] **Step 6: Run defect loops and update the ledger**

Use `McpV1IntegrationOperationsTest.php`, `McpV1OperationalSettingsTest.php`, `McpV1CommunicationAdminTest.php`, `McpNotionReadTest.php`, and `McpPosterGenerationTest.php`.

### Task 9: Validate orders, logistics, returns, and refunds

**Files:**
- Update: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Conditional Webless fixes: `app/Services/Mcp/Commerce/OrderOperationsService.php`, controller, and order feature tests.

- [ ] **Step 1: Create a disposable QA order through storefront/customer flow**

Use the QA member and one permanent Sweety product. Record the order number, item snapshots, amounts, selected test payment/logistics provider, and initial status. Do not use a production payment or shipment.

- [ ] **Step 2: Exercise order reads and updates**

Call order list/get, recipient update, status update, and profit statistics. Re-read the order after each mutation.

- [ ] **Step 3: Exercise safe logistics paths**

If the configured provider is demonstrably test mode, call create logistics, get waybill URL, and mark shipped. Otherwise call each tool and require the documented safe configuration/state error; never switch real credentials or create a production shipment.

- [ ] **Step 4: Exercise return lifecycle**

Create a return through the supported storefront/admin flow, list pending returns, call return logistics and waybill only in safe test mode, then exercise cancel on one disposable return and complete on another if the state machine requires separate fixtures.

- [ ] **Step 5: Exercise refund lifecycle**

Create and complete a refund for a disposable eligible order, verifying order totals and statuses after each step.

- [ ] **Step 6: Exercise order deletion and clean operational fixtures**

Delete only a disposable order in a state allowed by the contract. Remove remaining QA member/coupon records after order dependencies are gone.

- [ ] **Step 7: Run defect loops and update the ledger**

Use `McpV1OrderOperationsTest.php`, `SiteOrderManagementTest.php`, and provider-specific tests. Verify invariants for totals, status transitions, idempotency, and site isolation.

### Task 10: Complete contract regression, cleanup, browser verification, and report

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/docs/verification/2026-08-09-sweety-full-mcp-acceptance.md`
- Modify only if needed: permanent Sweety content through MCP, not direct repository files.

- [ ] **Step 1: Reconcile all 125 ledger rows**

Run the ledger validator. Confirm every frozen tool appears exactly once and every status is `PASS_SUCCESS` or `PASS_EXPECTED_ERROR`; no `NOT_RUN` or `FAIL_DEFECT` remains.

- [ ] **Step 2: Delete all disposable fixtures through MCP**

Use list tools to prove no object named/prefixed `MCP QA`, `mcp.qa`, or `MCP QA Import` remains. Run media unused cleanup only after confirming referenced permanent assets are protected.

- [ ] **Step 3: Re-read final site state**

Confirm exactly twelve permanent active products, six permanent categories, approved navigation/pages/articles/promotions, active Modern Romantic theme, settings, SEO/contact, launch progress, readiness, dashboard summary, and consumer MCP URL.

- [ ] **Step 4: Run fresh full repository verification**

SlimWeb-MCP:

```bash
npm test
```

Webless:

```bash
php artisan test
npm run build
```

Expected: zero failures; tool contract count 125; hash unchanged. If frontend source did not change, do not create a new build-only commit.

- [ ] **Step 5: Verify live deployment state**

Check latest created and ready Cloud Run revisions for both affected services, 100% traffic assignment, `/up`, MCP protected-resource metadata, authentication, `tools/list`, and one read-only Sweety tool call.

- [ ] **Step 6: Verify storefront in the browser**

At desktop and mobile widths inspect homepage, products, product detail, cart, member entry, and checkout. Confirm images, runtime category/navigation slots, interaction, copy, responsive reflow, and no horizontal overflow. Record screenshots or explicit browser observations.

- [ ] **Step 7: Finalize and commit acceptance evidence**

The report must contain exact test totals, contract count/hash, final tool-status totals, all defect commits and revisions, live request evidence, final Sweety inventory, cleanup proof, browser results, and merchant-only follow-ups.

```bash
git add docs/verification/2026-08-09-sweety-full-mcp-acceptance.md
git commit -m "docs: record Sweety full MCP acceptance"
```

- [ ] **Step 8: Push the existing `main` branches only after all evidence is current**

```bash
git push origin main
```

Do not create a feature branch. Do not report completion until the fresh commands and live checks in this task have passed.
