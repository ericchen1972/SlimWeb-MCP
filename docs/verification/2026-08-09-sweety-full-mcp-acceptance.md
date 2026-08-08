# Sweety Full SaaS MCP Acceptance — 2026-08-09

## Fixed Context

- Site: Sweety
- Site code: `swcb_g3fg1bpnjulrr75o`
- Domain: `shop.sweety.tw`
- Contract count: 125
- Contract SHA-256: `e5e4c662fd241829f532d1a567987698ad6a16e22759dfdea6eeea6c44c7e95b` (125 tools; revised after removing the stale `member_verification` write field)
- External policy: test data/test providers only; no real email, Facebook, Notion publishing, payment, or production shipment.

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
| None | — | Baseline before writes | Clean |

## Defect Log

| Tool | Reproduction | Root cause | Regression test | Commit | Revision | Live retest |
|---|---|---|---|---|---|---|
| slimweb_design_context_get | Empty Sweety site has no SitePage row | `ThemeService::resolve()` assumed an active `site_pages` identity instead of restoring the required Default identity for legacy empty sites | `McpV1ThemeTest::test_empty_site_design_context_recovers_canonical_default_theme` (RED 404, GREEN 7 assertions) | `0c675b5` | `webless-00549-bav` | PASS: live response returned theme id 26, active Default, light mode, Tailwind |
| slimweb_settings_update | Sending `member_verification: none` follows the advertised MCP schema but returns `VALIDATION_FAILED` | The field was intentionally removed from SaaS `sites`; MCP Core still advertised the obsolete write parameter | `toolProfile.test.js`: SaaS schema omits removed member verification writes (RED exposed schema, GREEN omitted) | Core `a18aabd`; SaaS `4f00b12` | `slimweb-mcp-00136-dvg` | PASS: public tools/list has 125 tools and omits the field; composite update and read-back succeeded |

## Deployment Log

| Component | Commit | Candidate revision | Production revision | Verification |
|---|---|---|---|---|
| Webless | `0c675b5` | `webless-00549-bav` | `webless-00549-bav` | Default theme recovery live PASS |
| SlimWeb MCP | `4f00b12` | `slimweb-mcp-00136-dvg` | `slimweb-mcp-00136-dvg` | GitHub Actions 31269512090 PASS; `/readyz` PASS; 125-tool schema PASS |

## Tool Matrix

| Tool | Domain | Prerequisite | Expected | Actual | Status | Cleanup | Evidence |
|---|---|---|---|---|---|---|---|
| slimweb_media_library_stats | theme_media | Authorized Sweety | Empty library totals and unused details | total 0 B, unused 0 B, empty assets | PASS_SUCCESS | Keep empty baseline | Live MCP |
| slimweb_media_library_delete_unused | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_orders_get_waybill_url | orders |  |  |  | NOT_RUN |  |  |
| slimweb_returns_get_waybill_url | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_update_status | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_update_recipient | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_delete | orders |  |  |  | NOT_RUN |  |  |
| slimweb_notion_pages_search | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_notion_page_get_content | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_external_assets_list | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_external_assets_delete | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_articles_delete | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_members_delete | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_members_coupons_revoke | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_newsletters_list | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_newsletters_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_newsletters_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_newsletters_delete | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_discount_codes_delete | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_member_tiers_delete | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_threshold_gifts_delete | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_product_add_ons_delete | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_customer_service_logs_delete | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_auth_status | identity | OAuth session | Authenticated account identity | Eric Chen Google identity returned | PASS_SUCCESS | Keep | Live MCP |
| slimweb_sites_list | identity | OAuth session | Authorized site choices | SlimWeb and Sweety returned; selection required | PASS_SUCCESS | Keep | Live MCP |
| slimweb_site_select | identity | Sweety selected | Stable site context and permissions | Sweety, system_admin, Default theme id 26 | PASS_SUCCESS | Keep | Live MCP |
| slimweb_themes_list | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_site_theme_mode_get | theme_media | Sweety selected | Site-level light mode | light; applies to Default and custom schemes | PASS_SUCCESS | Keep | Live MCP |
| slimweb_design_context_get | theme_media | Authorized empty site | Tailwind design context with canonical active Default theme | Tailwind context returned with active Default theme id 26 and light mode | PASS_SUCCESS | Keep restored Default identity | Regression 1/1, related 15/15, Webless 754/754; live `webless-00549-bav` |
| slimweb_site_theme_mode_update | theme_media | Sweety selected | Idempotent light-mode update | ok; light stored at site scope | PASS_SUCCESS | Keep light | Live MCP |
| slimweb_themes_create_from_default | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_activate | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_delete | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_shell_get_context | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_update_root_elements | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_style_profile_get | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_style_profile_upsert | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_style_profile_append_request | theme_media |  |  |  | NOT_RUN |  |  |
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
| slimweb_mail_templates_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_templates_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_layout_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_layout_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_payment_logistics_get | settings_operations | Sweety selected | Read supported/current providers | ECPay, NewebPay, LINE Pay and logistics returned; existing providers in test mode | PASS_SUCCESS | Keep test mode | Live MCP |
| slimweb_payment_logistics_update | settings_operations | Existing test ECPay | Idempotent safe provider update | ECPay remains enabled in test mode; credentials preserved | PASS_SUCCESS | Keep test mode | Live MCP |
| slimweb_orders_list | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_profit_statistics | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_get | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_create_logistics | orders |  |  |  | NOT_RUN |  |  |
| slimweb_orders_mark_shipped | orders |  |  |  | NOT_RUN |  |  |
| slimweb_returns_pending_list | orders |  |  |  | NOT_RUN |  |  |
| slimweb_returns_create_logistics | orders |  |  |  | NOT_RUN |  |  |
| slimweb_returns_cancel | orders |  |  |  | NOT_RUN |  |  |
| slimweb_returns_complete | orders |  |  |  | NOT_RUN |  |  |
| slimweb_refunds_complete | orders |  |  |  | NOT_RUN |  |  |
| slimweb_refunds_create | orders |  |  |  | NOT_RUN |  |  |
| slimweb_dashboard_summary | settings_operations | Empty baseline | Zero-state KPI response | all commerce/content counts zero; one main page | PASS_SUCCESS | Keep baseline evidence | Live MCP |
| slimweb_settings_get | settings_operations | Sweety selected | Read basic settings and client MCP URL | ecommerce, active, TW, dynamic, 7-day returns, navbar categories | PASS_SUCCESS | Keep permanent | Live MCP |
| slimweb_settings_update | settings_operations | Current SaaS schema | Composite durable settings patch | composite update and immediate read-back succeeded | PASS_SUCCESS | Keep permanent | Live MCP `slimweb-mcp-00136-dvg` |
| slimweb_admins_list | settings_operations | System admin | List protected admin and permissions | one Eric Chen system_admin; cannot delete | PASS_SUCCESS | Keep | Live MCP |
| slimweb_admins_upsert | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_admins_delete | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_images_import_chatgpt_attachment | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_debug_attachment_refs | settings_operations | Empty attachment arrays | Redacted shape only, no secrets | keys and empty arrays returned redacted | PASS_SUCCESS | No data written | Live MCP |
| slimweb_uploads_create | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_uploads_commit | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_articles_list | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_articles_check_title | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_articles_get_content | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_articles_create | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_articles_update | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_content_seo_update | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_categories_list | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_categories_upsert | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_categories_delete | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_nav_items_list | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_nav_items_upsert | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_nav_items_delete | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_products_list | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_products_get | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_product_image_reference_prepare | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_products_upsert | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_products_delete | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_products_import_inspect | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_products_import_validate | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_products_import_commit | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_coupon_templates_list | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_coupon_templates_upsert | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_members_coupons_issue | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_members_list | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_members_get | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_newsletters_create | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_posters_create | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_discount_codes_list | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_discount_codes_upsert | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_member_tiers_list | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_member_tiers_upsert | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_threshold_gifts_list | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_threshold_gifts_upsert | promotions_members |  |  |  | NOT_RUN |  |  |
| slimweb_product_add_ons_list | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_product_add_ons_upsert | catalog |  |  |  | NOT_RUN |  |  |
| slimweb_customer_service_logs_list | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_customer_service_settings_get | communications_integrations | Sweety selected | Read AI support settings | disabled, 500 questions, 30 days, default prompt | PASS_SUCCESS | Keep disabled pending public contacts | Live MCP |
| slimweb_customer_service_settings_update | communications_integrations | Approved brand voice | Save safe Sweety support prompt and limits | prompt, 500 questions and 30 days saved; service remains disabled | PASS_SUCCESS | Keep prompt; enable later only with confirmation | Live MCP |
| slimweb_exports_create | settings_operations | Empty datasets | Immediate JSON/CSV exports for all supported types | members JSON, orders CSV, returns JSON all succeeded with 0 rows | PASS_SUCCESS | Export response only | Live MCP |
| slimweb_audit_list | settings_operations | Sweety selected | Stable response when audit table absent | empty logs, audit_available false, explanatory note | PASS_SUCCESS | No data written | Live MCP |
| slimweb_assets_upload | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_pages_list | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_check_title | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_get_content | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_create | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_update | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_delete | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_preview_get_page_url | theme_media |  |  |  | NOT_RUN |  |  |
