# SaaS MCP Phase 4 Commerce Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all 37 SaaS commerce tools behind the versioned Webless Backend API while preserving the frozen 125-tool public contract.

**Architecture:** Webless resolves the actor and selected site, enforces the existing admin permission, validates commerce rules, and owns Eloquent transactions and side effects. `WeblessBackendClient` maps the unchanged MCP repository calls to versioned HTTP operations; `WeblessAccountRepository` retains only argument normalization that belongs to the public MCP contract and delegates authoritative work through `SlimWebBackend`.

**Tech Stack:** Laravel 12, Eloquent/PostgreSQL, PHPUnit, Node.js 20+, native `fetch`, Node test runner, Cloud Run.

---

## File Structure

- `app/Http/Controllers/Internal/McpV1/CommerceSettingsController.php`: versioned payment/logistics settings endpoints.
- `app/Http/Controllers/Internal/McpV1/MemberPromotionController.php`: members, coupons, discount codes, and member tier endpoints.
- `app/Http/Controllers/Internal/McpV1/MerchandisingPromotionController.php`: threshold gift and product add-on endpoints.
- `app/Http/Controllers/Internal/McpV1/OrderController.php`: order, return, refund, logistics, and waybill endpoints.
- `app/Services/Mcp/Commerce/CommerceSettingsService.php`: payment/logistics normalization and transactional provider persistence.
- `app/Services/Mcp/Commerce/MemberPromotionService.php`: member and member-promotion reads/writes.
- `app/Services/Mcp/Commerce/MerchandisingPromotionService.php`: threshold gift and add-on rules.
- `app/Services/Mcp/Commerce/OrderService.php`: order queries, actions, transactions, and public response formatting.
- `routes/web.php`: versioned Phase 4 routes.
- `tests/Feature/McpV1CommerceSettingsTest.php`: settings permission, parity, exclusivity, and idempotency.
- `tests/Feature/McpV1MemberPromotionTest.php`: member/promotion scope, validation, and mutations.
- `tests/Feature/McpV1MerchandisingPromotionTest.php`: gift/add-on tenant and product constraints.
- `tests/Feature/McpV1OrderTest.php`: order/return/refund/logistics behavior and transactions.
- `src/backends/slimWebBackend.js`: Phase 4 Backend interface methods.
- `src/backends/weblessBackendClient.js`: versioned HTTP mapping for all 37 tools.
- `src/weblessRepository.js`: replace Phase 4 SQL and legacy internal HTTP with Backend delegation.
- `test/weblessBackendClient.test.js`: exact method/path/header/body mapping.
- `test/weblessRepository.test.js`: delegation and no-direct-persistence architecture checks.

### Task 1: Payment and logistics settings (2 tools)

- [x] Write failing PHP tests for `GET` and idempotent `PUT /commerce/settings/providers`, actor/site permission checks, online-card exclusivity, callback URLs, and transaction rollback.
- [x] Run `php artisan test --filter=McpV1CommerceSettingsTest` and verify the missing routes fail.
- [x] Implement `CommerceSettingsController` and `CommerceSettingsService`; support `slimweb_payment_logistics_get` and `slimweb_payment_logistics_update` without changing their response fields.
- [x] Add `getPaymentLogisticsSettings()` and `updatePaymentLogisticsSettings()` to `SlimWebBackend` and `WeblessBackendClient`.
- [x] Write and run failing Node mapping/delegation tests, replace both repository bodies with Backend calls, and verify focused PHP/Node tests pass.

### Task 2: Members and member promotions (13 tools)

- [x] Write failing PHP tests for member list/get/delete, coupon template list/upsert, member coupon issue/revoke, discount code CRUD, and member tier CRUD.
- [x] Verify tests fail because the versioned routes and services do not exist.
- [x] Implement `MemberPromotionController` and `MemberPromotionService` with tenant-scoped Eloquent queries, current coupon rules, member-tier counts, and idempotent writes.
- [x] Add Backend/Client methods for the 13 public operations and exact query/body mapping.
- [x] Write failing repository delegation tests and replace all 13 direct SQL bodies with Backend calls.
- [x] Run focused PHP/Node tests and confirm response parity, permission denial, cross-site rejection, and replay behavior.

### Task 3: Merchandising promotions (6 tools)

- [x] Write failing PHP tests for threshold gift and product add-on list/upsert/delete, including cross-site product rejection and uniqueness rules.
- [x] Verify the routes fail before implementation.
- [x] Implement `MerchandisingPromotionController` and `MerchandisingPromotionService` with Eloquent transactions and idempotency.
- [x] Add six Backend/Client methods, exact route mapping, and repository delegation.
- [x] Run focused tests and confirm no Phase 4 promotion repository method contains `.pool` or legacy internal HTTP.

### Task 4: Orders, returns, refunds, and logistics (16 tools)

- [x] Write failing PHP tests for order list/get/profit, bulk status/recipient/delete, forward and return waybill URLs, logistics creation/manual shipment, pending returns, return cancel/complete/logistics, and refund create/complete.
- [x] Cover the existing action prerequisites, 20-order list guard, member total-spent transitions, tenant isolation, idempotent writes, and transaction rollback.
- [x] Implement `OrderController` and `OrderService`; keep write transitions inside backend transactions and preserve `available_actions` and response shapes.
- [x] Add 16 Backend/Client methods and map safe reads without idempotency keys and all writes with idempotency keys.
- [x] Replace direct SQL and legacy unversioned internal HTTP in the 16 repository paths with Backend delegation.
- [x] Run focused PHP/Node tests and verify every order mutation requires the existing confirmation/workflow contract at the public tool layer.

### Task 5: Architecture, regression, deployment, and acceptance

- [x] Extend the architecture audit to extract all 37 Phase 4 repository methods and reject `.pool`, `.storage`, `postWeblessInternal`, `requestWeblessInternal`, and direct provider/order helpers.
- [x] Update `/internal/mcp/v1/version` capabilities for commerce settings, members/promotions, merchandising promotions, and orders/returns/refunds.
- [x] Run Laravel Pint on the Phase 4 files, the complete Webless suite, the complete MCP suite, and the frozen 125-tool contract hash test.
- [x] Confirm the repository audit reports Phase 4 direct count zero and reduces remaining direct paths from 71 to 34.
- [x] Commit and push Webless `main`, deploy it first, verify candidate and production `/up`, then commit and push MCP `main` and wait for GitHub Actions.
- [x] Verify production `/readyz`, unauthenticated 403, and an authenticated safe read on `swcb_zog0l7zlyp3lwmlc`; skip provider writes because they can affect checkout behavior.
- [x] Record production revisions, test totals, contract hash, and live smoke evidence in the approved design specification.
