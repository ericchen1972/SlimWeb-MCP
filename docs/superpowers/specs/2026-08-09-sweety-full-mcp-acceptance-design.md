# Sweety SaaS MCP Full Acceptance Design

**Date:** 2026-08-09  
**Target site:** `Sweety` (`swcb_g3fg1bpnjulrr75o`)  
**Public contract:** 125 SlimWeb SaaS MCP tools

## 1. Objective

Exercise every public SaaS SlimWeb MCP tool against the currently empty Sweety site, repair any contract or runtime defects found, deploy each repair, and retest the failed path. The same work will turn Sweety into a coherent, launch-ready women's fashion storefront.

The final site keeps merchant-facing catalog, content, theme, promotion, SEO, customer-service, and email-template data. Records created only to test destructive or operational workflows are removed at the end.

## 2. Confirmed Product Direction

Sweety serves women aged approximately 23–38 with wearable, polished everyday fashion. The brand promise is `穿上喜歡的自己`.

The selected visual direction is **Modern Romantic**:

- cream white, dusty pink, and wine red;
- generous whitespace and restrained decorative detail;
- soft editorial photography without a childish or overly sweet tone;
- responsive storefront behavior for desktop, tablet, and mobile.

The permanent content baseline includes:

- six product categories: dresses, tops, knitwear, bottoms, outerwear, and accessories;
- exactly twelve active products with meaningful descriptions, prices, stock, and color or size variants;
- a homepage with a seasonal hero, category paths, featured products, styling content, brand story, member offer, and the site's consumer MCP entry point;
- About Sweety, size guide, shipping and returns, and contact pages;
- three permanent articles covering seasonal styling, dress selection, and knitwear care;
- ordinary navigation for Home, All Products, Journal, About, and Shopping Guide, while category navigation remains an independent taxonomy surface;
- a first-purchase 10% offer, free shipping over NT$2,000, and an appropriate threshold gift;
- complete customer-service and email copy without sending real external messages.

Existing payment and logistics configuration is preserved. The acceptance run does not invent or replace production merchant credentials.

## 3. Chosen Execution Approach

Use domain-by-domain, workflow-based validation rather than a blind tool sweep or a site-first build.

For each functional domain:

1. inspect the current state and tool schema;
2. create the minimum required permanent or disposable fixture through supported interfaces;
3. call each relevant MCP tool;
4. verify writes with the matching read tool, preview URL, or storefront behavior;
5. classify and investigate failures before attempting a repair;
6. add a failing automated regression test for confirmed defects;
7. implement the smallest root-cause repair, deploy it, and repeat the original MCP call;
8. clean disposable fixtures before moving on when later domains do not need them.

This approach validates both individual tool contracts and the multi-tool workflows merchants actually use.

## 4. Acceptance Matrix

Maintain one row per tool in `docs/verification/2026-08-09-sweety-full-mcp-acceptance.md` with at least these fields:

- tool name;
- functional domain;
- prerequisite or fixture;
- exact test intent;
- expected outcome;
- actual outcome;
- result classification;
- created object identifiers;
- cleanup action;
- defect reference, regression test, deployment revision, and retest evidence when applicable.

Every row receives one final classification:

- `PASS_SUCCESS`: the call succeeds and its authoritative read-back or preview is correct;
- `PASS_EXPECTED_ERROR`: an intentionally unconfigured external integration, unavailable fixture state, or forbidden action returns the documented stable error without an unsafe side effect;
- `FAIL_DEFECT`: the tool, Webless Backend API, permission boundary, data conversion, persistence behavior, or returned contract is incorrect.

A called tool is not considered accepted merely because it returns HTTP success. Mutations require authoritative verification.

## 5. Functional Test Order

### 5.1 Identity, site context, and operational summaries

Validate authentication status, site listing and selection, backend readiness, launch progress, dashboard summary, basic settings, design context, site mode, and audit/export foundations.

The discovery pass already reproduced one defect: `slimweb_design_context_get` fails on the empty Sweety site because no active `SitePage` row exists. This remains an unmodified reproduction until a failing automated test is written.

### 5.2 Brand settings, theme, pages, and media

Apply the Modern Romantic style profile, create a custom theme from Default, update the three allowed root fragments, activate it, and verify the shell context and preview. Theme navbar markup must contain exactly the primary navigation, member-auth, and cart runtime slots; it must not serialize live navigation or category data.

Create and commit durable media before referencing it from pages or products. Exercise upload, attachment import, external-asset, media-statistics, media-cleanup, image-reference, theme, page, preview, and content SEO tools. Page JavaScript remains page-scoped and uses only enabled libraries.

### 5.3 Catalog and merchandising

Create the six-category taxonomy independently from ordinary navigation. Build exactly twelve permanent products and verify leaf-category assignment, variants, inventory, listing filters, product reads, updates, image handling, import inspect/validate/commit, temporary import cleanup, add-ons, and product deletion with disposable records.

### 5.4 Content, SEO, contact, and navigation

Create permanent pages and articles, including title checks, reads, updates, SEO metadata, and temporary delete coverage. Create only the agreed ordinary navigation entries, verify the recursive tree, and test deletion through disposable navigation data. Complete site SEO and contact settings from known brand context without asking for every metadata field.

### 5.5 Promotions and membership

Exercise coupon templates, discount codes, threshold gifts, member tiers, member listing and detail, coupon issue and revoke, and destructive member operations against clearly marked QA fixtures. Permanent customer-facing promotions remain; QA-only templates, codes, tiers, coupons, and members are removed.

### 5.6 Orders, logistics, returns, and refunds

Create a disposable customer and order through supported storefront or customer-facing flows. Test order list/detail, recipient and status changes, profit statistics, logistics creation, waybill access, shipping, returns, return logistics, cancellation/completion, refund creation/completion, and order deletion.

Only configured test-provider paths may reach a logistics provider. If no safe test provider is available, the tool must still be called and must return the expected configuration or state error. No production shipment or payment is authorized.

### 5.7 Communications, customer service, integrations, and administration

Exercise mail delivery reads and safe configuration validation, mail templates, shared mail layout, newsletter CRUD, customer-service settings and logs, Facebook settings, Notion settings and read operations, poster creation, exports, administrator CRUD, and audit reads.

No real newsletter is sent and no Facebook or Notion content is published. Unconfigured integrations are accepted only when they return the documented safe error and do not expose credentials. Administrator CRUD uses a separate QA administrator and never mutates or deletes the current system administrator.

## 6. External Side-Effect Policy

The run uses safe test data and test-provider configuration only.

Allowed:

- persistent Sweety storefront content;
- disposable database records clearly identified as MCP QA;
- local or platform-managed media uploads;
- test logistics calls when the provider is demonstrably in test mode;
- draft newsletter and configuration records;
- read-only external integration checks.

Not allowed:

- sending real email;
- publishing to Facebook or Notion;
- creating a production shipment or payment;
- replacing real merchant credentials with invented values;
- deleting the current administrator or unrelated merchant data.

## 7. Defect Handling

For every unexpected result:

1. capture the exact MCP request, response, request ID, and affected site state;
2. reproduce consistently;
3. trace the request through MCP orchestration, Backend client, Webless route, controller, service, model/storage, and response normalization;
4. compare with a working tool pattern in the same domain;
5. state one root-cause hypothesis and test it minimally;
6. write and run a failing regression test for the confirmed defect;
7. implement one minimal repair;
8. run the targeted test, relevant repository suite, build checks, and frozen tool-contract check;
9. deploy the affected SaaS component;
10. repeat the original live MCP call and authoritative verification.

After three unsuccessful repair hypotheses for the same failure, stop and review the architecture with the user rather than layering a fourth speculative fix.

## 8. Cleanup and Preservation

Keep:

- the approved Sweety theme and style profile;
- permanent homepage, pages, articles, SEO, contact, navigation, products, categories, customer-service copy, email templates, and approved promotions;
- media referenced by permanent content.

Remove:

- records prefixed or tagged as MCP QA;
- temporary import duplicates;
- disposable products, categories, navigation items, pages, articles, promotions, tiers, members, administrators, newsletters, orders, returns, refunds, and unused media;
- test coupons issued to disposable members.

Cleanup must use public MCP tools where available so delete behavior is covered by the same acceptance matrix. Database cleanup is a last resort only for fixtures that no public tool can safely remove, and must be documented.

## 9. Final Verification

The acceptance run is complete only when:

- the authenticated MCP still advertises exactly 125 tools with the frozen ordered contract hash;
- every tool has one recorded final classification and no `FAIL_DEFECT` remains;
- all confirmed defects have a regression test, deployed repair, and successful live retest;
- Sweety launch progress and readiness are re-read and permanent launch blockers are resolved except for real merchant credentials or business facts that cannot be invented;
- the QA fixture inventory is empty;
- permanent Sweety content is present and internally linked;
- desktop and mobile browser checks cover the homepage, product list, product detail, cart, member entry, and checkout path;
- there is no horizontal overflow, broken navigation, missing image, console-breaking page code, or unintended external action;
- a final report lists each tool result, repairs and revisions, permanent content, cleanup evidence, and any merchant-only follow-up.

## 10. Out of Scope

- Standalone MCP implementation;
- real production payment, shipment, email, Facebook, or Notion execution;
- inventing legal business identity, tax, banking, sender, or customer-service facts;
- changing the frozen public tool catalog unless a separately approved contract change is required to fix an irreconcilable defect.
