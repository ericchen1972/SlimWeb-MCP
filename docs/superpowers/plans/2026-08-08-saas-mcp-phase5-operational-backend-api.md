# SaaS MCP Phase 5 Operational Backend API Implementation Plan

**Goal:** Move the final 34 SaaS database/storage-bound MCP paths behind the versioned Webless Backend API while preserving the frozen 125-tool public contract.

**Architecture:** SlimWeb-MCP keeps authentication, tool schemas, confirmation gates, and response presentation. `SlimWebBackend` exposes typed operations, `WeblessBackendClient` sends actor/site/request context, and Webless owns tenant resolution, permissions, validation, persistence, transactions, provider credentials, storage, and jobs. No Phase 5 repository method may use PostgreSQL, storage adapters, legacy internal HTTP helpers, or provider-specific helpers.

## Inventory

### Task 1: Site operations and integrations (11 tools)

- `slimweb_site_readiness_get`, `slimweb_site_launch_progress_get`
- `slimweb_seo_settings_get`, `slimweb_seo_settings_update`
- `slimweb_facebook_settings_get`, `slimweb_facebook_settings_update`
- `slimweb_notion_settings_get`, `slimweb_notion_settings_update`
- `slimweb_contact_settings_get`, `slimweb_contact_settings_update`
- `slimweb_dashboard_summary`

### Task 2: Mail, administrators, and newsletters (14 tools)

- `slimweb_mail_delivery_settings_get`, `slimweb_mail_delivery_settings_update`
- `slimweb_mail_templates_get`, `slimweb_mail_templates_update`
- `slimweb_mail_layout_get`, `slimweb_mail_layout_update`
- `slimweb_admins_list`, `slimweb_admins_upsert`, `slimweb_admins_delete`
- `slimweb_newsletters_create`, `slimweb_newsletters_list`, `slimweb_newsletters_get`, `slimweb_newsletters_update`, `slimweb_newsletters_delete`

### Task 3: Notion, posters, customer service, exports, and audit (9 tools)

- `slimweb_notion_pages_search`, `slimweb_notion_page_get_content`
- `slimweb_posters_create`
- `slimweb_customer_service_logs_list`, `slimweb_customer_service_logs_delete`
- `slimweb_customer_service_settings_get`, `slimweb_customer_service_settings_update`
- `slimweb_exports_create`, `slimweb_audit_list`

The authoritative migration total is 34 repository methods after excluding the already-delegated `listThemesForAccountSite` and `uploadAsset` aliases.

## Execution

- [x] Add failing Webless feature tests for every read/write family, tenant isolation, permissions, idempotency, validation, and rollback.
- [x] Add versioned Webless controllers/services and advertise Phase 5 capabilities from `/internal/mcp/v1/version`.
- [x] Add the 34 methods to `SlimWebBackend` and exact request mappings to `WeblessBackendClient`.
- [x] Add failing Node delegation/architecture tests, then replace all 34 repository implementations with `requireBackendClient(...)` calls.
- [x] Verify no Phase 5 public repository method reaches `.pool`, `.storage`, `postWeblessInternal`, `requestWeblessInternal`, `this.fetch`, poster/provider helpers, or export SQL helpers.
- [x] Run targeted and complete Webless/MCP suites, Pint for changed PHP files, and the frozen 125-tool contract hash test.
- [x] Confirm the migration inventory drops from 34 direct paths to zero, then remove now-unreachable direct helpers and credentials in Phase 6.
- [x] Deploy Webless first, then SlimWeb-MCP; verify health, unauthenticated denial, authenticated safe reads, and a non-destructive idempotent write.
- [x] Record revisions, test totals, contract hash, and live evidence in the approved design specification.

## Safety

- All writes require the existing public MCP confirmation gates and backend idempotency keys.
- Production smoke tests are read-only unless a same-value write is provably harmless.
- Poster and export operations remain bounded asynchronous or response-streaming operations owned by Webless.
- Notion, Facebook, mail, and storage credentials never leave Webless.
