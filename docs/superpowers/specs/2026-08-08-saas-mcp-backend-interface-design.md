# SaaS MCP Backend Interface Design

**Date:** 2026-08-08

## Summary

SlimWeb-MCP currently owns the public MCP tool contract and also performs part of the SaaS persistence work directly through PostgreSQL and storage adapters. This design separates those responsibilities without changing the public MCP behavior.

SlimWeb-MCP will keep MCP protocol handling, tool schemas, authorization requirements, confirmation flows, orchestration, and response normalization. All database, transaction, storage, job, and business-rule execution will move behind a versioned Webless Backend API implemented in Laravel.

This phase covers the SaaS edition only. The Standalone edition will be designed after the SaaS path passes local, automated, deployment, and live verification.

## Goals

- Preserve all 125 current public MCP tool names, input schemas, permission requirements, confirmation behavior, and output semantics.
- Remove direct database and storage access from SlimWeb-MCP.
- Make Webless Laravel the sole owner of SaaS persistence, transactions, tenant checks, storage, jobs, and business rules.
- Introduce a stable backend interface that can later be implemented independently by Standalone without combining the two products or deployments.
- Migrate incrementally with contract and parity tests so the live MCP service remains usable throughout the work.

## Non-goals

- Implementing or changing the Standalone edition.
- Renaming, removing, or redesigning public MCP tools.
- Adding capability-based tool filtering.
- Changing the admin UI or merchant-facing workflow.
- Exposing a generic SQL, table, filesystem, or arbitrary CRUD gateway.
- Permanently maintaining both the direct-database repository and the Backend API path.

## Responsibility Boundary

### SlimWeb-MCP owns

- MCP transport and protocol behavior.
- OAuth/session identity received from the AI client.
- Public tool definitions and JSON schemas.
- Tool-level permission declarations and confirmation requirements.
- Cross-operation orchestration that is part of the public MCP contract.
- Mapping backend responses and errors into stable MCP results.
- Request IDs, timeouts, retries that are safe for the operation, and observability at the MCP edge.

### Webless Backend owns

- Resolving a stable `site_code` to the correct tenant and site.
- Resolving and validating the authenticated Google identity.
- Rechecking membership and permissions for every operation.
- Input validation that depends on Webless domain rules.
- Database queries, writes, transactions, locking, and consistency.
- Storage paths, signed uploads, commits, image processing, and cleanup.
- Queues, background jobs, email, integrations, and other infrastructure work.
- Audit records and business-domain error details.

SlimWeb-MCP must not treat a caller-supplied numeric database ID as authority. It sends stable public identifiers and actor context; Webless performs the authoritative resolution and authorization.

## Node Backend Interface

SlimWeb-MCP will depend on a `SlimWebBackend` interface rather than a PostgreSQL/storage repository. The production SaaS implementation will be `WeblessBackendClient`, an HTTP client for Webless.

Interface methods are domain operations, not database primitives. Representative groups include:

- Sites and settings: resolve site, read settings, update settings, update site name.
- Catalog: products, variants, categories, navigation, inventory, and imports.
- Content: pages, articles, themes, template files, and assets.
- Commerce: members, promotions, coupons, orders, returns, and logistics.
- Operations: uploads, media cleanup, email, posters, Notion, exports, and audit reads.

Public tool handlers may orchestrate multiple backend methods when the current MCP contract requires it. An atomic business change must be represented by one backend operation so Webless can execute it in a single transaction.

## Webless Internal API

The API will be versioned under `/internal/mcp/v1`. Routes are grouped by domain and action. They will not expose table names or accept arbitrary columns, SQL, PHP, or filesystem paths.

Examples:

- `GET /internal/mcp/v1/sites/{site_code}/settings`
- `PATCH /internal/mcp/v1/sites/{site_code}/settings`
- `POST /internal/mcp/v1/sites/{site_code}/products/{product_code}/publish`
- `POST /internal/mcp/v1/sites/{site_code}/uploads`
- `POST /internal/mcp/v1/sites/{site_code}/uploads/{upload_id}/commit`

Existing protected Webless MCP endpoints should be moved or normalized into this contract rather than wrapped by a second permanent API layer.

### Request context

Every request carries:

- `X-SlimWeb-MCP-Secret` for service authentication during the SaaS phase.
- `X-Request-Id` for correlation and audit tracing.
- The MCP tool name and required permission.
- The authenticated actor's stable Google identity (`sub` and email where available).
- `site_code` in the route or request body.
- An idempotency key for retryable write operations.

The shared secret authenticates the MCP service, not the merchant. Webless must still validate the actor, site membership, and permission. Secret comparison remains constant-time and the secret never appears in logs or responses.

### Response envelope

Successful responses use:

```json
{
  "ok": true,
  "data": {},
  "warnings": [],
  "audit_id": "optional-stable-id"
}
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "stable_machine_code",
    "message": "safe user-facing message",
    "details": {}
  },
  "request_id": "correlation-id"
}
```

HTTP status codes distinguish authentication, authorization, validation, conflict, missing resources, rate limits, and backend failures. SlimWeb-MCP maps stable error codes to its existing public result semantics.

### Contract version

Webless exposes a lightweight version/capability endpoint for deployment diagnostics. The SaaS MCP client requires major version `v1`. Minor additive changes are allowed; breaking changes require a new major version and an explicit migration.

## Migration Strategy

The migration is incremental, but the target is one effective implementation. A temporary direct-repository path may exist only as a test oracle or controlled migration seam. It is removed domain by domain after parity passes and is not a production fallback in the completed design.

### Phase 0: Inventory and freeze

- Generate an inventory mapping all 125 tools to current repository methods, storage use, external integrations, permissions, and confirmations.
- Snapshot `tools/list` and create a deterministic schema hash.
- Capture representative success and error fixtures for current read/write behavior.
- Add architecture checks that detect newly introduced SQL or storage access in MCP code.

### Phase 1: Foundation and settings vertical slice

- Add `SlimWebBackend` and `WeblessBackendClient`.
- Add Webless API middleware, request context, response envelope, audit correlation, and idempotency support.
- Migrate site resolution and site settings first, including website-name updates.
- Verify the full path from `slimweb_settings_update` through Webless to the database without MCP database access.

### Phase 2: Catalog and navigation

- Migrate products, variants, inventory, categories, navigation, and catalog settings.
- Preserve current tool schemas and domain validations.

### Phase 3: Content, templates, and media

- Migrate pages, articles, themes, template files, uploads, signed URLs, commit flows, image handling, and cleanup.
- Webless becomes the only component that knows storage providers and paths.

### Phase 4: Commerce operations

- Migrate members, coupons, promotions, orders, returns, logistics, and transactional operations.
- Use backend transactions and idempotency for multi-record writes.

### Phase 5: Integrations and operational tools

- Migrate email, posters, Notion, imports, exports, analytics, and audit operations.
- Keep asynchronous work behind job creation/status operations where needed.

### Phase 6: Removal and hardening

- Remove `pg`, database environment variables, SQL, GCS credentials, storage adapters, and local-storage implementation from SlimWeb-MCP.
- Remove temporary dual-path and parity-only code.
- Update README, deployment configuration, and operational documentation.
- Run the complete acceptance and live deployment verification.

Each phase may ship only when its contract, Webless feature, MCP regression, and parity tests pass. The previous deployed revisions remain the rollback mechanism; there is no permanent runtime fallback after migration.

## Testing and Verification

### MCP contract tests

- Preserve existing permission and 403 coverage.
- Assert the exact `tools/list` names and schemas against the frozen snapshot.
- Test backend request mapping and public response/error normalization.
- Test timeout, retry, idempotency, malformed response, and backend-unavailable behavior.

### Webless feature tests

- Reject missing or incorrect service credentials.
- Reject actors without site membership or the required permission.
- Prevent cross-tenant and cross-site access.
- Validate inputs and stable error codes.
- Verify transactions, conflicts, idempotent replay, storage behavior, and jobs.
- Verify audit correlation without logging secrets or sensitive tokens.

### Temporary parity tests

During each migration phase, run the old repository behavior and the new API behavior against controlled fixtures and compare normalized results. Differences must be intentional and documented. The old implementation is removed after the phase passes.

### Deployment and live verification

- Run the full SlimWeb-MCP and Webless test suites.
- Deploy Webless API support before the MCP revision that requires it.
- Confirm Webless and MCP health/version endpoints.
- Confirm the live `tools/list` schema hash remains unchanged except for separately approved contract changes.
- Run authenticated safe-read smoke tests against a designated test site.
- Run a reversible website-name update on the designated test site and verify both the MCP result and Webless-admin/runtime result.
- Verify logs by request ID and confirm no direct database or storage credentials remain in the MCP deployment.

Production-destructive smoke tests require an explicitly designated test site and data. They are not run against arbitrary merchant sites.

## Reliability and Security

- Use HTTP keep-alive and bounded connection pools to limit added latency.
- Apply explicit connect and request timeouts; retries are limited to safe reads or idempotent writes.
- Use idempotency keys for writes that may be retried after an uncertain response.
- Let Webless own transaction boundaries and rollback behavior.
- Keep large binary transfers on signed upload/download flows issued and committed by Webless rather than proxying bytes through MCP where unnecessary.
- Return safe error messages while retaining detailed internal diagnostics under the request ID.
- Rate-limit the internal API by service identity, actor, site, and operation where appropriate.

## Acceptance Criteria

- All 125 existing public MCP tools retain their approved contract and behavior.
- `slimweb_settings_update` can update the website name through the Webless API.
- SlimWeb-MCP contains no SQL, PostgreSQL driver, database connection environment variables, GCS credentials, storage provider adapter, or direct filesystem persistence for site data.
- Webless performs all authoritative tenant resolution, permission checks, validation, persistence, transactions, storage, and jobs.
- Automated MCP contract/regression tests and Webless feature tests pass.
- The live SaaS deployment passes health, contract-hash, authenticated read, and reversible write verification.
- No permanent direct-database or storage fallback remains in SlimWeb-MCP.
- Standalone work has not begun; its implementation will be evaluated only after these SaaS criteria pass.

## Phase 1 Acceptance Evidence — 2026-08-08

The SaaS basic-settings migration slice passed its automated, deployment, contract, and reversible production checks.

- Webless production revision: `webless-00516-ney` (100% traffic).
- SlimWeb-MCP production revision: `slimweb-mcp-00120-j72` (100% traffic).
- SlimWeb-MCP deployment workflow: GitHub Actions run `31239743807`, conclusion `success`.
- Webless test suite: 697 tests passed with 3,930 assertions.
- SlimWeb-MCP test suite: 410 tests passed.
- Frozen public tool contract: 125 tools; SHA-256 `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`.
- Reversible production test site: `swcb_zog0l7zlyp3lwmlc`.
- `slimweb_settings_get` read the original name `SlimWeb`.
- `slimweb_settings_update` changed the name to a temporary verification value; both the public MCP read and the Webless internal API read returned that temporary value.
- A second `slimweb_settings_update` restored `SlimWeb`; both read paths confirmed restoration.
- The immutable `site_code`, slug, and domain values were identical before and after the test.
- Webless persisted separate successful idempotency records for the temporary update and restoration.

This evidence completes Phase 1 only. The remaining SaaS tool domains continue under the migration sequence described above; Standalone remains out of scope until the SaaS migration is accepted.

## Phase 2 Acceptance Evidence — 2026-08-08

The SaaS catalog and navigation migration passed automated regression, production deployment, authenticated public MCP reads, and a non-destructive idempotent write check.

- Migrated public tools: 14 category, navigation, product, product-image-reference, and product-import tools.
- Webless production revision: `webless-00526-lih` (100% traffic).
- SlimWeb-MCP production revision: `slimweb-mcp-00123-ds4` (100% traffic).
- SlimWeb-MCP deployment workflow: GitHub Actions run `31249852065`, conclusion `success`.
- Webless test suite: 716 tests passed with 0 failures.
- SlimWeb-MCP test suite: 398 tests passed with 0 failures.
- Frozen public tool contract remains 125 tools with SHA-256 `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`.
- Authenticated public `slimweb_sites_list`, `slimweb_categories_list`, `slimweb_nav_items_list`, and `slimweb_products_list` calls succeeded for `swcb_zog0l7zlyp3lwmlc`.
- A public `slimweb_categories_upsert` same-value update returned `ok: true`, `action: updated`, and an empty `changed_fields` array, proving the write and idempotency path without changing merchant content.
- The 14 migrated repository methods now require `WeblessBackendClient`; their prior direct PostgreSQL and storage implementations were removed.

This evidence completes Phase 2 only. Phase 3 content, template, and media migration is next; Standalone remains out of scope until all SaaS phases pass.

## Phase 3 Acceptance Evidence — 2026-08-08

The remaining SaaS content, template, and media slice passed automated regression, production deployment, authenticated public MCP reads, and a non-destructive write check.

- Migrated the remaining 16 public theme, design-context, style-profile, media-library, and asset-registration tools to `WeblessBackendClient`.
- Webless production revision: `webless-00538-pih` (100% traffic).
- SlimWeb-MCP production revision: `slimweb-mcp-00128-z2f` (100% traffic).
- SlimWeb-MCP deployment workflow: GitHub Actions run `31256662109`, conclusion `success`.
- Webless test suite: 727 tests passed with 0 failures.
- SlimWeb-MCP test suite: 358 tests passed with 0 failures.
- Frozen public tool contract remains 125 tools with SHA-256 `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`.
- Production health checks returned HTTP 200 for Webless `/up` and SlimWeb-MCP `/readyz`; the internal API rejected a request without the service credential with HTTP 403.
- Authenticated public `slimweb_themes_list`, `slimweb_site_theme_mode_get`, `slimweb_design_context_get`, and `slimweb_media_library_stats` calls succeeded for `swcb_zog0l7zlyp3lwmlc`.
- A public `slimweb_site_theme_mode_update` same-value `light` update returned `ok: true`, proving the production write path without changing storefront appearance.
- The migrated repository methods now delegate database and storage work to the Webless Backend API; the prior direct theme and media persistence blocks were removed.

This evidence completes Phase 3 only. Phase 4 commerce operations is next; Standalone remains out of scope until the SaaS migration is accepted.
