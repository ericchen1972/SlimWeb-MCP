# Sweety Full SaaS MCP Acceptance — 2026-08-09

## Fixed Context

- Site: Sweety
- Site code: `swcb_g3fg1bpnjulrr75o`
- Domain: `shop.sweety.tw`
- Contract count: 125
- Contract SHA-256: `e5e4c662fd241829f532d1a567987698ad6a16e22759dfdea6eeea6c44c7e95b` (125 tools; revised after removing the stale `member_verification` write field)
- External policy: test data/test providers only; no real email, Facebook, Notion publishing, payment, or production shipment.

## Final Result

- `PASS_SUCCESS`: 121
- `PASS_EXPECTED_ERROR`: 4
- `NOT_RUN`: 0
- Total: 125 / 125 tools exercised
- QA cleanup verified: 0 QA orders, members, customer-service logs, newsletters, temporary products/categories/themes/pages/navigation items, and temporary promotion rules remain.
- Live storefront verified at 1440px desktop and 390px mobile with no horizontal overflow.
- Mobile stored-theme navigation opens and closes correctly on production revision `webless-00556-guw`.

## Baseline

- Launch stage: `setup_incomplete`
- Readiness score: 25
- Products: 0
- Categories: 0
- Navigation items: 0
- Articles: 0
- Administrators: 1
- Members: 0
- Coupon templates: 0
- Existing payment/logistics status: complete
- Resolved live defect: empty sites now recover the canonical active `Default` theme identity before returning design context.

## QA Fixture Inventory

| Fixture | Identifier | Purpose | Cleanup status |
|---|---|---|---|
| Theme | 28 `QA 刪除測試` | Exercise theme delete | Deleted |
| Category | 30 `QA 刪除分類` | Exercise category delete | Deleted |
| Product | 796 `QA 刪除商品` | Exercise product delete | Deleted |
| Import product/category | 797 / 31 | Exercise CSV inspect, validate, commit | Both deleted |

## Defect Log

| Tool | Reproduction | Root cause | Regression test | Commit | Revision | Live retest |
|---|---|---|---|---|---|---|
| slimweb_design_context_get | Empty Sweety site has no SitePage row | `ThemeService::resolve()` assumed an active `site_pages` identity instead of restoring the required Default identity for legacy empty sites | `McpV1ThemeTest::test_empty_site_design_context_recovers_canonical_default_theme` (RED 404, GREEN 7 assertions) | `0c675b5` | `webless-00549-bav` | PASS: live response returned theme id 26, active Default, light mode, Tailwind |
| slimweb_settings_update | Sending `member_verification: none` follows the advertised MCP schema but returns `VALIDATION_FAILED` | The field was intentionally removed from SaaS `sites`; MCP Core still advertised the obsolete write parameter | `toolProfile.test.js`: SaaS schema omits removed member verification writes (RED exposed schema, GREEN omitted) | Core `a18aabd`; SaaS `4f00b12` | `slimweb-mcp-00136-dvg` | PASS: public tools/list has 125 tools and omits the field; composite update and read-back succeeded |
| slimweb_orders_profit_statistics | A PostgreSQL date-filtered request failed while the unfiltered aggregate worked | `whereDate(DB::raw('coalesce(...)'))` passed an expression into PostgreSQL grammar's date wrapper | `test_profit_date_filters_use_placed_at_with_created_at_fallback` | `07d9aca` | `webless-00553-vem` | PASS: gross 8400, cost 3530, net 4870 on the five QA orders |
| Stored-theme mobile navigation | Sweety's mobile menu button rendered but did not open the panel | Mobile menu behavior lived only in the Default navbar inline script; stored custom navbars use the shared storefront bundle | `storefront-mobile-navigation.test.mjs` (open/close and idempotence) | `57ab008` | `webless-00556-guw` | PASS: 390px live browser click exposed six category links and seven content links; close button passed |

## Deployment Log

| Component | Commit | Candidate revision | Production revision | Verification |
|---|---|---|---|---|
| Webless | `0c675b5` | `webless-00549-bav` | `webless-00549-bav` | Default theme recovery live PASS |
| Webless | `07d9aca` | `webless-00553-vem` | `webless-00553-vem` | 755 tests PASS; filtered profit statistics live PASS |
| Webless | `57ab008` | `webless-00556-guw` | `webless-00556-guw` | 755 backend and 14 frontend tests PASS; `/up` candidate/production PASS; Sweety mobile menu live PASS |
| SlimWeb MCP | `4f00b12` | `slimweb-mcp-00136-dvg` | `slimweb-mcp-00136-dvg` | GitHub Actions 31269512090 PASS; `/readyz` PASS; 125-tool schema PASS |

## Tool Matrix

| Tool | Domain | Prerequisite | Expected | Actual | Status | Cleanup | Evidence |
|---|---|---|---|---|---|---|---|
| slimweb_media_library_stats | theme_media | Authorized Sweety | Empty library totals and unused details | total 0 B, unused 0 B, empty assets | PASS_SUCCESS | Keep empty baseline | Live MCP |
| slimweb_media_library_delete_unused | theme_media | All formal assets referenced | Recheck and delete only unused | deleted 0, skipped 0, failed 0 | PASS_SUCCESS | Formal assets preserved | Live MCP |
| slimweb_orders_get_waybill_url | orders | QA order with HCT test logistics | Build printable forward waybill URL | URL returned for QA-SWEETY-REFUND-001 | PASS_SUCCESS | QA order pending cleanup | Live MCP |
| slimweb_returns_get_waybill_url | orders | QA return with HCT test logistics | Build printable return waybill URL | URL returned for QA-SWEETY-RETURN-001 | PASS_SUCCESS | QA order pending cleanup | Live MCP |
| slimweb_orders_update_status | orders | Explicit QA-SWEETY-ORDER-001 | Move pending order to confirmed | status changed and order returned | PASS_SUCCESS | QA order pending cleanup | Live MCP |
| slimweb_orders_update_recipient | orders | Explicit QA-SWEETY-ORDER-001 | Change recipient to QA updated name | recipient changed | PASS_SUCCESS | QA order pending cleanup | Live MCP |
| slimweb_orders_delete | orders | Five explicitly named QA orders | Delete all acceptance fixtures | all five complete order numbers deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_notion_pages_search | content_navigation | Notion token intentionally unset | Search authorized pages | missing-token error returned without leaking credentials | PASS_EXPECTED_ERROR | No write | Live MCP |
| slimweb_notion_page_get_content | communications_integrations | Notion token intentionally unset and fake page id | Read authorized page | missing-token error returned | PASS_EXPECTED_ERROR | No write | Live MCP |
| slimweb_external_assets_list | theme_media | Sweety selected | Empty CSS/JS external asset baseline | empty assets returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_external_assets_delete | theme_media | No external assets exist | Reject unknown scoped asset | NOT_FOUND for asset 999999 | PASS_EXPECTED_ERROR | No data changed | Live MCP |
| slimweb_articles_delete | content_navigation | QA article id 7 | Delete QA article | deleted article id 7 | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_members_delete | promotions_members | QA member id 25 after order cleanup | Delete disposable member | member id 25 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_members_coupons_revoke | promotions_members | QA member coupon id 2 | Revoke issued manual coupon | status revoked and history preserved | PASS_SUCCESS | QA coupon revoked | Live MCP |
| slimweb_newsletters_list | communications_integrations | Empty baseline | List newsletters | stable empty list returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_newsletters_get | communications_integrations | QA newsletter id 1 | Read newsletter and recipients | content and one invalid-domain QA recipient returned | PASS_SUCCESS | QA deleted | Live MCP |
| slimweb_newsletters_update | communications_integrations | QA newsletter id 1 | Update title and content | updated record returned | PASS_SUCCESS | QA deleted | Live MCP |
| slimweb_newsletters_delete | communications_integrations | QA newsletter id 1 | Delete unsent newsletter | id 1 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_discount_codes_delete | promotions_members | QA discount code id 2 | Delete QA code | id 2 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_member_tiers_delete | promotions_members | QA tier id 3 | Delete QA member tier | id 3 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_threshold_gifts_delete | promotions_members | QA gift rule id 3 | Delete inactive QA rule | id 3 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_product_add_ons_delete | catalog | QA add-on id 3 | Delete inactive QA rule | id 3 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_customer_service_logs_delete | communications_integrations | QA log id 3 | Delete disposable conversation | log id 3 deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_auth_status | identity | OAuth session | Authenticated account identity | Eric Chen Google identity returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_sites_list | identity | OAuth session | Authorized site choices | SlimWeb and Sweety returned; selection required | PASS_SUCCESS | Keep | Live MCP |
| slimweb_site_select | identity | Sweety selected | Stable site context and permissions | Sweety, system_admin, Default theme id 26 | PASS_SUCCESS | Keep | Live MCP |
| slimweb_themes_list | theme_media | Sweety selected | Custom themes only | active `現代浪漫` id 27 returned; Default omitted | PASS_SUCCESS | Keep theme 27 | Live MCP |
| slimweb_site_theme_mode_get | theme_media | Sweety selected | Site-level light mode | light; applies to Default and custom schemes | PASS_SUCCESS | Keep | Live MCP |
| slimweb_design_context_get | theme_media | Authorized empty site | Tailwind design context with canonical active Default theme | Tailwind context returned with active Default theme id 26 and light mode | PASS_SUCCESS | Keep restored Default identity | Regression 1/1, related 15/15, Webless 754/754; live `webless-00549-bav` |
| slimweb_site_theme_mode_update | theme_media | Sweety selected | Idempotent light-mode update | ok; light stored at site scope | PASS_SUCCESS | Keep light | Live MCP |
| slimweb_themes_create_from_default | theme_media | Canonical Default exists | Copy shell into custom theme | `現代浪漫` 27 and QA 28 created with default fallback | PASS_SUCCESS | Keep 27; delete 28 | Live MCP |
| slimweb_themes_activate | theme_media | User approved direction A | Make 27 live | 27 active; Default inactive | PASS_SUCCESS | Keep active | Live MCP |
| slimweb_themes_delete | theme_media | Inactive QA theme 28 | Delete non-Default theme and storage | 28 deleted; 27 preserved | PASS_SUCCESS | QA cleaned | Live MCP |
| slimweb_theme_shell_get_context | theme_media | Default then theme 27 | Return slots, runtime hooks and current CSS | all three required slots and both category modes returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_themes_update_root_elements | theme_media | Shell context read | Store valid navbar/footer and full CSS | navbar, footer and CSS written; SVG-in-button attempt rejected, static text-button version accepted | PASS_SUCCESS | Keep permanent shell | Live MCP |
| slimweb_theme_style_profile_get | theme_media | Profile saved | Read current style contract and history | version 2 profile returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_theme_style_profile_upsert | theme_media | Approved modern-romance direction | Save palette, typography, layout and avoid notes | full profile id 2 saved | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_theme_style_profile_append_request | theme_media | Existing profile | Append brand promise/CTA note | history appended; version 2 | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_site_readiness_get | settings_operations | SEO baseline saved | Read readiness with optional gaps | score 38; six gaps correctly listed | PASS_SUCCESS | Keep | Live MCP |
| slimweb_site_launch_progress_get | settings_operations | SEO baseline saved | Required/recommended launch plan | setup_incomplete; catalog and homepage blocking | PASS_SUCCESS | Keep | Live MCP |
| slimweb_seo_settings_get | settings_operations | Sweety selected | Read blank SEO baseline | null baseline returned before write | PASS_SUCCESS | Superseded by permanent settings | Live MCP |
| slimweb_seo_settings_update | settings_operations | Approved brand direction | Store durable SEO/AEO/GEO baseline | Sweety titles, canonical, llms.txt and answer-engine fields saved | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_facebook_settings_get | communications_integrations | Sweety selected | Read integration baseline | no IDs; comments disabled | PASS_SUCCESS | Keep | Live MCP |
| slimweb_facebook_settings_update | communications_integrations | Safe no-publish policy | Clear IDs and keep comments disabled | ok; null IDs and false toggles | PASS_SUCCESS | Keep disabled | Live MCP |
| slimweb_notion_settings_get | communications_integrations | Sweety selected | Read token state without leaking secret | null token returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_notion_settings_update | communications_integrations | Safe no-publish policy | Clear empty token without publishing | ok; token remains null | PASS_SUCCESS | Keep disabled | Live MCP |
| slimweb_contact_settings_get | settings_operations | Sweety selected | Read every contact field | all fields null | PASS_SUCCESS | Await verified merchant contacts | Live MCP |
| slimweb_contact_settings_update | settings_operations | Do not invent public contacts | Safe null patch | ok; all fields remain null | PASS_SUCCESS | Keep until verified | Live MCP |
| slimweb_mail_delivery_settings_get | communications_integrations | Sweety selected | Read SMTP/notification settings | no SMTP; notifications disabled | PASS_SUCCESS | Keep | Live MCP |
| slimweb_mail_delivery_settings_update | communications_integrations | No real email/SMS policy | Save copy while keeping delivery disabled | reminder copy saved; SMS automation false; no SMTP | PASS_SUCCESS | Keep disabled | Live MCP |
| slimweb_mail_templates_get | communications_integrations | Empty baseline | Read event templates | stable empty list and shared-layout rule returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_mail_templates_update | communications_integrations | Sweety copy for order created, shipped and registration | Save three active event templates | template ids 8-10 persisted | PASS_SUCCESS | Keep permanent templates | Live MCP |
| slimweb_mail_layout_get | communications_integrations | No custom layout | Read current and default wrapper | default HTML and required placeholders returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_mail_layout_update | communications_integrations | Current default wrapper preserved | Apply cream, dusty-pink and wine-red brand styling | active custom wrapper id 1 saved with all placeholders | PASS_SUCCESS | Keep permanent layout | Live MCP |
| slimweb_payment_logistics_get | settings_operations | Sweety selected | Read supported/current providers | ECPay, NewebPay, LINE Pay and logistics returned; existing providers in test mode | PASS_SUCCESS | Keep test mode | Live MCP |
| slimweb_payment_logistics_update | settings_operations | Existing test ECPay | Idempotent safe provider update | ECPay remains enabled in test mode; credentials preserved | PASS_SUCCESS | Keep test mode | Live MCP |
| slimweb_orders_list | orders | Five QA fixtures | Search QA order numbers | three normal orders returned; returns excluded by scope | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_orders_profit_statistics | orders | Five paid QA orders and 2026-08-08 to 2026-08-09 filter | Calculate net profit using effective order date | live result gross 8400, cost 3530, net 4870 after PostgreSQL fix | PASS_SUCCESS | QA orders deleted after verification | Live MCP revision webless-00553-vem |
| slimweb_orders_get | orders | QA-SWEETY-ORDER-001 | Read detail and actions | full order and item snapshot returned | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_orders_create_logistics | orders | QA COD order and enabled HCT test provider | Create local test logistics | synthetic HCT tracking and local payload stored | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_orders_mark_shipped | orders | QA order without logistics | Manually mark shipped | confirmed status and manual logistics completion stored | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_returns_pending_list | orders | Two active QA returns | List pending return actions | both returns and HCT actions returned | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_returns_create_logistics | orders | QA return and enabled HCT test provider | Create reverse test logistics | synthetic HCT return tracking stored | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_returns_cancel | orders | QA-SWEETY-RETURN-001 | Cancel active return | order returned to confirmed and cancel timestamp set | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_returns_complete | orders | QA-SWEETY-RETURN-002 without reverse logistics | Manually complete return | returned status and completion timestamp set | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_refunds_complete | orders | QA COD refund fixture | Mark manual refund complete | manual refund amount 1680 stored | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_refunds_create | orders | QA online order and ECPay test provider | Create local refund request | ECPay refund status created; no provider call made | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_dashboard_summary | settings_operations | Empty baseline | Zero-state KPI response | all commerce/content counts zero; one main page | PASS_SUCCESS | Keep baseline evidence | Live MCP |
| slimweb_settings_get | settings_operations | Sweety selected | Read basic settings and client MCP URL | ecommerce, active, TW, dynamic, 7-day returns, navbar categories | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_settings_update | settings_operations | Current SaaS schema | Composite durable settings patch | composite update and immediate read-back succeeded | PASS_SUCCESS | Keep permanent | Live MCP `slimweb-mcp-00136-dvg` |
| slimweb_admins_list | settings_operations | System admin | List protected admin and permissions | one Eric Chen system_admin; cannot delete | PASS_SUCCESS | Keep | Live MCP |
| slimweb_admins_upsert | settings_operations | Invalid-domain QA Google email | Create product-management admin | admin id 3 created | PASS_SUCCESS | QA deleted | Live MCP |
| slimweb_admins_delete | settings_operations | QA admin id 3 | Delete non-system admin | id 3 deleted; system owner preserved | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_images_import_chatgpt_attachment | theme_media | Codex runtime, no ChatGPT fileParams | Reject unsupported fake file reference | VALIDATION_FAILED as documented for ChatGPT-only path | PASS_EXPECTED_ERROR | No data written | Live MCP |
| slimweb_debug_attachment_refs | settings_operations | Empty attachment arrays | Redacted shape only, no secrets | keys and empty arrays returned redacted | PASS_SUCCESS | No data written | Live MCP |
| slimweb_uploads_create | theme_media | Codex byte access and exact sizes | Issue signed upload URLs | hero, 12 products and 6 category banners received upload IDs | PASS_SUCCESS | Keep committed formal assets | Live MCP |
| slimweb_uploads_commit | theme_media | HTTPS PUT completed | Commit uploaded bytes as WebP | all 19 generated images committed with media_path/public_url | PASS_SUCCESS | Keep formal assets | Live MCP |
| slimweb_articles_list | content_navigation | Three permanent articles plus QA | List current articles | four articles returned before QA cleanup | PASS_SUCCESS | Keep three permanent articles | Live MCP |
| slimweb_articles_check_title | content_navigation | Four unique article titles | Check title collisions before create | all unique titles accepted | PASS_SUCCESS | No write | Live MCP |
| slimweb_articles_get_content | content_navigation | Article id 4 | Read before update | full article body and cover metadata returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_articles_create | content_navigation | Approved article copy and committed covers | Create three permanent articles and one QA article | article ids 4 through 7 created | PASS_SUCCESS | Keep ids 4-6; QA id 7 deleted | Live MCP |
| slimweb_articles_update | content_navigation | Article id 4 current body | Add permanent Sweety CTA | updated article returned | PASS_SUCCESS | Keep update | Live MCP |
| slimweb_content_seo_update | content_navigation | About page create and article 4 update workflows | Save page/article SEO, AEO and GEO metadata | metadata persisted for both content types | PASS_SUCCESS | Keep metadata | Live MCP |
| slimweb_categories_list | catalog | Baseline then completed catalog | Return tree and leaf guidance | empty baseline then six root leaf categories | PASS_SUCCESS | Keep six categories | Live MCP |
| slimweb_categories_upsert | catalog | Six 16:9 committed images and SVG icon | Create durable categories | ids 24-29: 洋裝、上衣、針織、下身、外套、配件 | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_categories_delete | catalog | Empty QA category 30 | Delete category safely | deleted 30; six formal categories retained | PASS_SUCCESS | QA cleaned | Live MCP |
| slimweb_nav_items_list | content_navigation | Empty baseline then populated menu | Read navigation tree | seven permanent root links returned after cleanup | PASS_SUCCESS | Keep | Live MCP |
| slimweb_nav_items_upsert | content_navigation | Semantic SVG icons and storefront URLs | Create seven permanent links plus one QA link | ids 7-14 created with icons | PASS_SUCCESS | Keep ids 7-13 | Live MCP |
| slimweb_nav_items_delete | content_navigation | QA nav id 14 | Delete QA navigation item | id 14 removed and seven permanent links remain | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_products_list | catalog | 12 formal products created | Filter/list all products | total 12, all active, two per category | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_products_get | catalog | Product 784 | Read full product, images and commerce data | 花語方領洋裝 with primary image, stock and cart action | PASS_SUCCESS | Keep | Live MCP |
| slimweb_product_image_reference_prepare | catalog | Product 784 media_path | Return experimental visual reference | downloadable WebP reference returned with trace context | PASS_SUCCESS | No write | Live MCP |
| slimweb_products_upsert | catalog | Approved 12-item catalog and committed images | Create sellable products with required fields | ids 784-795 created, active, unique SKUs and primary images | PASS_SUCCESS | Keep 12 formal products | Live MCP |
| slimweb_products_delete | catalog | Hidden QA product 796 | Delete product and product image row | 796 deleted; formal catalog retained | PASS_SUCCESS | QA cleaned | Live MCP |
| slimweb_products_import_inspect | catalog | One-row QA CSV | Parse without writes or AI backend | 1 row, four columns, six available categories | PASS_SUCCESS | No write | Live MCP |
| slimweb_products_import_validate | catalog | Name/price/stock/SKU mapping | Validate convertible mapping | 1 passed, 0 failed, convertible true | PASS_SUCCESS | No write | Live MCP |
| slimweb_products_import_commit | catalog | User-confirmed QA import | Import one mapped product | product 797 and temporary category 31 created | PASS_SUCCESS | Product and category deleted | Live MCP |
| slimweb_coupon_templates_list | promotions_members | Empty baseline | List coupon templates and rules | stable empty list and guidance returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_coupon_templates_upsert | promotions_members | Confirmed campaign details | Create permanent all-members coupon plus QA manual coupon | templates ids 3 and 4 created and QA date corrected | PASS_SUCCESS | Keep id 3; QA id 4 pending DB cleanup | Live MCP |
| slimweb_members_coupons_issue | promotions_members | QA member 25 and active manual template 4 | Issue confirmed manual coupon | member coupon id 2 issued | PASS_SUCCESS | Revoked then pending DB cleanup | Live MCP |
| slimweb_members_list | promotions_members | QA member fixture | Search active member | member id 25 returned | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_members_get | promotions_members | QA member id 25 | Read profile, orders and coupons | full profile and five recent orders returned | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_newsletters_create | communications_integrations | QA invalid-domain recipient and 2099 schedule | Store unsent newsletter | id 1 created; sends_immediately false | PASS_SUCCESS | QA deleted | Live MCP |
| slimweb_posters_create | communications_integrations | Two uniquely named Sweety products | Generate 1:1 modern-romance poster | committed media asset 680a23c5...webp returned | PASS_SUCCESS | Keep permanent poster | Live MCP |
| slimweb_discount_codes_list | promotions_members | Empty baseline | List codes | stable empty list returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_discount_codes_upsert | promotions_members | Confirmed permanent and QA codes | Create SWEETY95 and QADELETE | ids 1 and 2 created | PASS_SUCCESS | Keep SWEETY95; QA deleted | Live MCP |
| slimweb_member_tiers_list | promotions_members | Empty baseline | List tiers | stable empty list returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_member_tiers_upsert | promotions_members | Confirmed permanent and QA tiers | Create 玫瑰會員 and QA tier | ids 2 and 3 created after valid nonzero QA discount | PASS_SUCCESS | Keep id 2; QA deleted | Live MCP |
| slimweb_threshold_gifts_list | promotions_members | Empty baseline | List gift rules | stable empty list returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_threshold_gifts_upsert | promotions_members | Hidden service gift product 798 | Create permanent 3000 threshold and QA inactive rule | ids 2 and 3 created | PASS_SUCCESS | Keep id 2; QA deleted | Live MCP |
| slimweb_product_add_ons_list | catalog | Empty baseline | List add-on rules | stable empty list returned | PASS_SUCCESS | No write | Live MCP |
| slimweb_product_add_ons_upsert | catalog | Dress 784 and accessory 795 | Create permanent 299 add-on and QA inactive rule | ids 2 and 3 created | PASS_SUCCESS | Keep id 2; QA deleted | Live MCP |
| slimweb_customer_service_logs_list | communications_integrations | QA member conversation fixture | List logs by member | log id 3 and messages returned | PASS_SUCCESS | QA pending cleanup | Live MCP |
| slimweb_customer_service_settings_get | communications_integrations | Sweety selected | Read AI support settings | disabled, 500 questions, 30 days, default prompt | PASS_SUCCESS | Keep disabled pending public contacts | Live MCP |
| slimweb_customer_service_settings_update | communications_integrations | Approved brand voice | Save safe Sweety support prompt and limits | prompt, 500 questions and 30 days saved; service remains disabled | PASS_SUCCESS | Keep prompt; enable later only with confirmation | Live MCP |
| slimweb_exports_create | settings_operations | Empty datasets | Immediate JSON/CSV exports for all supported types | members JSON, orders CSV, returns JSON all succeeded with 0 rows | PASS_SUCCESS | Export response only | Live MCP |
| slimweb_audit_list | settings_operations | Sweety selected | Stable response when audit table absent | empty logs, audit_available false, explanatory note | PASS_SUCCESS | No data written | Live MCP |
| slimweb_assets_upload | theme_media | Committed hero media_path | Register reusable homepage asset | hero registered under active theme/page scope | PASS_SUCCESS | Keep referenced hero | Live MCP |
| slimweb_pages_list | content_navigation | Theme 27 selected | Site-wide page inventory | fixed pages plus editable index returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_pages_check_title | content_navigation | About, size, shipping and FAQ titles plus QA | Check collisions before create | unique titles accepted | PASS_SUCCESS | No write | Live MCP |
| slimweb_pages_get_content | content_navigation | Editable index | Read before update | empty homepage baseline and storage path returned | PASS_SUCCESS | Superseded by homepage | Live MCP |
| slimweb_pages_create | content_navigation | Four approved service pages plus QA page | Create custom pages with no external libraries | about, size-guide, shipping-returns, faq and QA page created | PASS_SUCCESS | Keep four permanent pages | Live MCP |
| slimweb_pages_update | content_navigation | Hero committed; current page read | Save Tailwind homepage with no external libraries | 5612 bytes written to Default index content | PASS_SUCCESS | Keep permanent homepage | Live MCP |
| slimweb_pages_delete | content_navigation | QA custom page | Delete disposable page across themes | QA page deleted | PASS_SUCCESS | QA removed | Live MCP |
| slimweb_preview_get_page_url | theme_media | Active theme 27 and homepage | Return explicit preview URL | preview URL returned with theme and page parameters | PASS_SUCCESS | No write | Live MCP |
