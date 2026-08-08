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
| slimweb_settings_update | Sending `member_verification: none` follows the advertised MCP schema but returns `VALIDATION_FAILED` | The field was intentionally removed from SaaS `sites`; MCP Core still advertised the obsolete write parameter | `toolProfile.test.js`: SaaS schema omits removed member verification writes (RED exposed schema, GREEN omitted) | `a18aabd` | Pending MCP deploy | Pending |

## Deployment Log

| Component | Commit | Candidate revision | Production revision | Verification |
|---|---|---|---|---|
| None | — | — | — | Baseline only |

## Tool Matrix

| Tool | Domain | Prerequisite | Expected | Actual | Status | Cleanup | Evidence |
|---|---|---|---|---|---|---|---|
| slimweb_media_library_stats | theme_media |  |  |  | NOT_RUN |  |  |
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
| slimweb_auth_status | identity |  |  |  | NOT_RUN |  |  |
| slimweb_sites_list | identity |  |  |  | NOT_RUN |  |  |
| slimweb_site_select | identity |  |  |  | NOT_RUN |  |  |
| slimweb_themes_list | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_site_theme_mode_get | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_design_context_get | theme_media | Authorized empty site | Tailwind design context with canonical active Default theme | Tailwind context returned with active Default theme id 26 and light mode | PASS_SUCCESS | Keep restored Default identity | Regression 1/1, related 15/15, Webless 754/754; live `webless-00549-bav` |
| slimweb_site_theme_mode_update | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_create_from_default | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_activate | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_delete | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_shell_get_context | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_themes_update_root_elements | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_style_profile_get | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_style_profile_upsert | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_theme_style_profile_append_request | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_site_readiness_get | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_site_launch_progress_get | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_seo_settings_get | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_seo_settings_update | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_facebook_settings_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_facebook_settings_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_notion_settings_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_notion_settings_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_contact_settings_get | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_contact_settings_update | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_delivery_settings_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_delivery_settings_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_templates_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_templates_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_layout_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_mail_layout_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_payment_logistics_get | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_payment_logistics_update | settings_operations |  |  |  | NOT_RUN |  |  |
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
| slimweb_dashboard_summary | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_settings_get | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_settings_update | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_admins_list | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_admins_upsert | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_admins_delete | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_images_import_chatgpt_attachment | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_debug_attachment_refs | settings_operations |  |  |  | NOT_RUN |  |  |
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
| slimweb_customer_service_settings_get | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_customer_service_settings_update | communications_integrations |  |  |  | NOT_RUN |  |  |
| slimweb_exports_create | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_audit_list | settings_operations |  |  |  | NOT_RUN |  |  |
| slimweb_assets_upload | theme_media |  |  |  | NOT_RUN |  |  |
| slimweb_pages_list | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_check_title | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_get_content | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_create | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_update | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_pages_delete | content_navigation |  |  |  | NOT_RUN |  |  |
| slimweb_preview_get_page_url | theme_media |  |  |  | NOT_RUN |  |  |
