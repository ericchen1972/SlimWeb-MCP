# SaaS MCP Catalog Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 14 SaaS MCP catalog and storefront-navigation tools from direct PostgreSQL/storage execution into the versioned Webless Laravel Backend API without changing their public MCP contracts.

**Architecture:** Webless receives the authenticated Google actor, stable `site_code`, tool name, permission, request ID, and idempotency key, then performs tenant checks, validation, transactions, storage cleanup, and serialization. `WeblessBackendClient` gains domain methods and `WeblessAccountRepository` delegates only these migrated methods; the old JavaScript implementation remains only as a parity oracle until Phase 2 verification passes, then its catalog SQL/storage code is removed.

**Tech Stack:** Laravel 12, PHP 8.3, Eloquent, PostgreSQL, GCS storage, PHPUnit, Node.js 20, native Fetch/Undici, Node test runner.

---

## Scope and contract inventory

This plan migrates exactly these public tools and repository methods:

| Public tool | Repository method | Additional permission (any one; `system_admin` also passes) |
| --- | --- | --- |
| `slimweb_categories_list` | `listCategories` | `product_management` or `product_management_categories` |
| `slimweb_categories_upsert` | `upsertCategory` | `product_management` or `product_management_categories` |
| `slimweb_categories_delete` | `deleteCategory` | `product_management` or `product_management_categories` |
| `slimweb_nav_items_list` | `listNavItems` | `page_management` or `page_management_navbar` |
| `slimweb_nav_items_upsert` | `upsertNavItem` | `page_management` or `page_management_navbar` |
| `slimweb_nav_items_delete` | `deleteNavItem` | `page_management` or `page_management_navbar` |
| `slimweb_products_list` | `listProducts` | `product_management` or `product_management_products` |
| `slimweb_products_get` | `getProduct` | `product_management` or `product_management_products` |
| `slimweb_product_image_reference_prepare` | `prepareProductImageReference` | none beyond `backend_ai_assistant` |
| `slimweb_products_upsert` | `upsertProduct` | `product_management` or `product_management_products` |
| `slimweb_products_delete` | `deleteProduct` | `product_management` or `product_management_products` |
| `slimweb_products_import_inspect` | `inspectProductImport` | `product_management` or `product_management_import` |
| `slimweb_products_import_validate` | `validateProductImport` | `product_management` or `product_management_import` |
| `slimweb_products_import_commit` | `commitProductImport` | `product_management` or `product_management_import` |

Product variants, variant stock, product-level stock, quantity discounts, primary/content images, videos, category leaf rules, SKU uniqueness, and import-created inventory are part of these methods. Product add-ons remain in Phase 4 because they are promotion rules rather than product persistence.

## File map

### Webless

- Create `app/Services/Mcp/Catalog/CatalogReadService.php`: category, nav, and product read models plus stable MCP response shapes.
- Create `app/Services/Mcp/Catalog/CategoryService.php`: category validation, tree mutation, and category asset cleanup.
- Create `app/Services/Mcp/Catalog/NavigationService.php`: nav validation, cycle checks, tree mutation, and icon cleanup.
- Create `app/Services/Mcp/Catalog/ProductService.php`: product create/update/delete transaction, relations, inventory, and image cleanup.
- Create `app/Services/Mcp/Catalog/ProductImportService.php`: MCP source parsing, mapping validation, and atomic commit using the existing import rules.
- Create `app/Http/Controllers/Internal/McpV1/CatalogController.php`: thin versioned HTTP adapter.
- Modify `routes/web.php`: add catalog routes inside the existing protected MCP v1 group.
- Modify `app/Http/Controllers/Internal/McpV1/SiteContextController.php`: advertise additive catalog capabilities.
- Create `tests/Feature/McpV1CatalogReadTest.php`: actor, permission, tenant, filters, trees, product relation, and import inspect/validate tests.
- Create `tests/Feature/McpV1CatalogWriteTest.php`: category, nav, product, storage, transaction, idempotency, and import commit tests.
- Create `tests/Unit/McpCatalogResponseParityTest.php`: deterministic response fixture coverage.
- Modify `DB_SCHEMA.md` only if implementation reveals schema drift; no migration is planned.

### SlimWeb-MCP

- Modify `src/backends/slimWebBackend.js`: add the 14 domain interface methods.
- Modify `src/backends/weblessBackendClient.js`: map the 14 methods to Webless HTTP.
- Modify `src/weblessRepository.js`: delegate migrated catalog methods and remove their direct SQL/storage implementation after parity passes.
- Modify `test/weblessBackendClient.test.js`: request, actor, permission, idempotency, timeout, and envelope mapping.
- Modify `test/weblessRepository.test.js`: prove all 14 methods execute with a pool/storage object that throws on use.
- Modify `test/app.test.js`: exercise all 14 public tools through the backend client while preserving the frozen 125-tool hash.
- Add `test/fixtures/catalog-backend-parity.json`: approved normalized responses and stable errors.
- Modify `README.md`: mark Phase 2 domains as Webless Backend API paths.
- Modify `docs/superpowers/specs/2026-08-08-saas-mcp-backend-interface-design.md`: append Phase 2 acceptance evidence only after deployment verification.

## Task 1: Freeze Phase 2 behavior and parity fixtures

**Files:**
- Create: `/Users/eric/Documents/SlimWeb-MCP/test/fixtures/catalog-backend-parity.json`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/toolContract.test.js`

- [ ] **Step 1: Add a failing inventory assertion**

Add a test with this exact expected tool list:

```js
const PHASE_2_TOOLS = [
  'slimweb_categories_list',
  'slimweb_categories_upsert',
  'slimweb_categories_delete',
  'slimweb_nav_items_list',
  'slimweb_nav_items_upsert',
  'slimweb_nav_items_delete',
  'slimweb_products_list',
  'slimweb_products_get',
  'slimweb_product_image_reference_prepare',
  'slimweb_products_upsert',
  'slimweb_products_delete',
  'slimweb_products_import_inspect',
  'slimweb_products_import_validate',
  'slimweb_products_import_commit'
];

test('Phase 2 inventory is present in the frozen SaaS contract', () => {
  const names = new Set(contract.tools.map((tool) => tool.name));
  assert.deepEqual(PHASE_2_TOOLS.filter((name) => !names.has(name)), []);
});
```

- [ ] **Step 2: Run the focused contract test**

Run: `node --test test/toolContract.test.js`

Expected: PASS with exactly 125 frozen tools and all 14 Phase 2 names present.

- [ ] **Step 3: Capture normalized legacy fixtures**

Use the existing fake PostgreSQL/storage repository tests to serialize representative results for:

```json
{
  "success": [
    "categories.list", "categories.create", "categories.update", "categories.delete",
    "navigation.list", "navigation.create", "navigation.update", "navigation.delete",
    "products.list", "products.get", "products.image_reference",
    "products.create", "products.update", "products.delete",
    "imports.inspect", "imports.validate", "imports.commit"
  ],
  "errors": [
    "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "IDEMPOTENCY_CONFLICT"
  ]
}
```

Normalize timestamps, generated UUIDs, signed URLs, and auto-increment IDs before snapshotting. Do not omit response keys that are part of current `structuredContent`.

- [ ] **Step 4: Add a fixture comparison test**

The test must deep-compare legacy normalized results to `catalog-backend-parity.json`; it must fail on renamed keys, changed null semantics, tree ordering, pagination, variant fields, image fields, or error codes.

- [ ] **Step 5: Run the legacy parity test**

Run: `node --test --test-name-pattern='catalog parity' test/weblessRepository.test.js`

Expected: PASS and create no database or storage side effects outside test doubles.

- [ ] **Step 6: Commit the frozen Phase 2 oracle**

```bash
git add test/fixtures/catalog-backend-parity.json test/weblessRepository.test.js test/toolContract.test.js
git commit -m "test: freeze SaaS catalog backend parity"
```

## Task 2: Add Webless catalog read services

**Files:**
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Catalog/CatalogReadService.php`
- Create: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogReadTest.php`

- [ ] **Step 1: Write failing read-model tests**

Cover these exact cases:

```php
public function test_categories_include_tree_flat_counts_and_leaf_state(): void;
public function test_navigation_includes_tree_and_flat_rows_in_sort_order(): void;
public function test_products_list_filters_site_category_keyword_status_and_low_stock(): void;
public function test_products_list_clamps_page_and_per_page_to_public_contract(): void;
public function test_product_get_includes_images_videos_variants_and_quantity_discounts(): void;
public function test_product_and_category_reads_never_cross_site_boundary(): void;
public function test_image_reference_accepts_committed_media_path_or_public_http_url_only(): void;
```

Assert the legacy MCP field names: `site`, `categories`, `flat_categories`, `guidance`, `nav_items`, `flat_nav_items`, `products`, `pagination`, `product`, `reference_image`, `downloadable_reference`, and both guidance strings.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `php artisan test tests/Feature/McpV1CatalogReadTest.php`

Expected: FAIL because `CatalogReadService` and catalog routes do not exist.

- [ ] **Step 3: Implement the read service interface**

Create these public methods:

```php
final class CatalogReadService
{
    public function categories(Site $site): array;
    public function navigation(Site $site): array;
    public function products(Site $site, array $filters): array;
    public function product(Site $site, int $productId): array;
    public function productImageReference(Site $site, array $input): array;
}
```

Use Eloquent site-scoped queries and eager loading. Build trees from rows already ordered by `sort_order`, then `id`. Product pagination defaults to page `1`, per-page `8`, caps per-page at `50`, and returns `last_page >= 1`. Low-stock matching checks both product and variant stock. Use `route('media.image', ['path' => $path])` for stored media URLs.

- [ ] **Step 4: Run read-model tests**

Run: `php artisan test tests/Feature/McpV1CatalogReadTest.php`

Expected: read-service tests PASS; route tests remain pending until Task 6.

- [ ] **Step 5: Commit catalog reads**

```bash
git add app/Services/Mcp/Catalog/CatalogReadService.php tests/Feature/McpV1CatalogReadTest.php
git commit -m "feat: add Webless MCP catalog reads"
```

## Task 3: Add authoritative category and navigation mutations

**Files:**
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Catalog/CategoryService.php`
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Catalog/NavigationService.php`
- Create: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogWriteTest.php`

- [ ] **Step 1: Write failing category mutation tests**

Test create/update by `category_id`, update by `current_name`, exact-name match behavior, global site-name uniqueness, parent preservation, cycle rejection, leaf rules, required create icon/image, committed-site media-path validation, recursive delete blocking when descendants contain products, recursive asset cleanup, and stable `changed_fields`/`matched_by` output.

- [ ] **Step 2: Write failing navigation mutation tests**

Test create/update, parent preservation, duplicate sibling-name rejection, dropdown-only parents, self/descendant cycle rejection, dropdown-to-link rejection when children exist, default/explicit sort order, recursive delete, icon cleanup, and stable `nav_item`/`deleted_nav_item_ids` output.

- [ ] **Step 3: Run tests and verify failure**

Run: `php artisan test tests/Feature/McpV1CatalogWriteTest.php --filter='category|navigation'`

Expected: FAIL because both services are absent.

- [ ] **Step 4: Implement category operations**

```php
final class CategoryService
{
    public function upsert(Site $site, array $input): array;
    public function delete(Site $site, int $categoryId): array;
}
```

Wrap each write in `DB::transaction`. Accept only committed media paths beginning with `sites/{site_id}/mcp-uploads/committed/`. Decode and validate SVG using the same limits as basic-settings logo handling. Delete replaced/removed GCS objects only after the database mutation is known to succeed; if storage deletion fails, surface `UPSTREAM_FAILED` with request correlation and retain a cleanup log entry.

- [ ] **Step 5: Implement navigation operations**

```php
final class NavigationService
{
    public function upsert(Site $site, array $input): array;
    public function delete(Site $site, int $navItemId): array;
}
```

Keep all site selectors in every query. Use a recursive in-memory descendant check or recursive CTE under the transaction. Preserve the existing MCP null/omitted-parent semantics and response keys.

- [ ] **Step 6: Run focused write tests**

Run: `php artisan test tests/Feature/McpV1CatalogWriteTest.php --filter='category|navigation'`

Expected: all category/navigation tests PASS.

- [ ] **Step 7: Commit category/navigation mutations**

```bash
git add app/Services/Mcp/Catalog/CategoryService.php app/Services/Mcp/Catalog/NavigationService.php tests/Feature/McpV1CatalogWriteTest.php
git commit -m "feat: add Webless MCP catalog tree mutations"
```

## Task 4: Add transactional product mutations

**Files:**
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Catalog/ProductService.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogWriteTest.php`

- [ ] **Step 1: Write failing product tests**

Cover create/update/delete, automatic SKU when omitted on create, site-scoped SKU uniqueness, leaf-category enforcement, required primary image, append/replace image modes, committed-site media validation, variants, variant stock, `variant_mode`, quantity discounts, videos, gift coupon ownership, slug uniqueness, rollback on child-record failure, deletion of only non-HTTP stored images, and exact response parity.

- [ ] **Step 2: Run the focused product tests**

Run: `php artisan test tests/Feature/McpV1CatalogWriteTest.php --filter='product'`

Expected: FAIL because `ProductService` is absent.

- [ ] **Step 3: Implement the transaction boundary**

```php
final class ProductService
{
    public function upsert(Site $site, array $input): array;
    public function delete(Site $site, int $productId): array;
}
```

Perform the product row and all variants, quantity discounts, images, and videos inside one `DB::transaction`. Normalize inputs to the current MCP semantics before persistence. Verify every referenced category, coupon template, product image, and committed media path belongs to the selected site. Queue or perform post-commit storage cleanup without deleting a still-referenced asset during rollback.

- [ ] **Step 4: Reuse domain behavior from the Web admin path**

Extract shared private logic from `SiteAdminController` only where necessary so the browser admin and MCP service call the same product validators/serializers. Do not call controller methods from the service and do not maintain two different rules for leaf categories, variants, stock, image modes, or quantity discounts.

- [ ] **Step 5: Run product and existing admin regression tests**

Run: `php artisan test tests/Feature/McpV1CatalogWriteTest.php --filter='product'`

Run: `php artisan test --filter='Product|Category|NavItem'`

Expected: all focused MCP and existing Web admin product tests PASS.

- [ ] **Step 6: Commit product mutations**

```bash
git add app/Services/Mcp/Catalog/ProductService.php app/Http/Controllers/SiteAdminController.php tests/Feature/McpV1CatalogWriteTest.php
git commit -m "feat: add Webless MCP product transactions"
```

## Task 5: Add MCP product-import operations

**Files:**
- Create: `/Users/eric/Documents/webless/app/Services/Mcp/Catalog/ProductImportService.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogReadTest.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogWriteTest.php`

- [ ] **Step 1: Write failing inspect/validate tests**

Use CSV, XLSX, and SQL fixtures. Verify columns, sample rows, total rows, target schema, available categories, mapping prompt, guidance, normalized mapping, convertible flag, and failure reasons. Reject unsupported types, invalid base64, oversized input, private/unreachable file URLs, and malformed workbook/SQL data with `VALIDATION_FAILED`.

- [ ] **Step 2: Write failing commit tests**

Verify invalid mappings make no writes; valid mappings create products in chunks of 100; exact leaf-category assignments are preserved; unmatched rows use the import category; SKUs/slugs are unique; variants/images follow the current mapping contract; the whole commit rolls back on any failed chunk; replay with the same idempotency key returns the original result; reuse with a changed payload returns `IDEMPOTENCY_CONFLICT`.

- [ ] **Step 3: Run import tests and verify failure**

Run: `php artisan test tests/Feature/McpV1CatalogReadTest.php tests/Feature/McpV1CatalogWriteTest.php --filter='import'`

Expected: FAIL because the MCP import service is absent.

- [ ] **Step 4: Implement import operations**

```php
final class ProductImportService
{
    public function inspect(Site $site, array $source): array;
    public function validate(Site $site, array $source, array $mapping): array;
    public function commit(Site $site, array $source, array $mapping): array;
}
```

Reuse parsing/conversion primitives from `App\Support\ProductImportService` where their semantics match. Add an MCP adapter for `data_base64`, `file_url`, and file-like `image_url`; downloading must use bounded timeouts, a byte limit, and SSRF protection. Keep OpenAI entirely out of this path.

- [ ] **Step 5: Run all import tests**

Run: `php artisan test tests/Feature/McpV1CatalogReadTest.php tests/Feature/McpV1CatalogWriteTest.php --filter='import'`

Expected: PASS for CSV/XLSX/SQL, validation failures, atomic commit, and idempotent replay.

- [ ] **Step 6: Commit product import**

```bash
git add app/Services/Mcp/Catalog/ProductImportService.php app/Support/ProductImportService.php tests/Feature/McpV1CatalogReadTest.php tests/Feature/McpV1CatalogWriteTest.php
git commit -m "feat: add Webless MCP product import API"
```

## Task 6: Expose the protected Webless catalog API

**Files:**
- Create: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/CatalogController.php`
- Modify: `/Users/eric/Documents/webless/routes/web.php`
- Modify: `/Users/eric/Documents/webless/app/Http/Controllers/Internal/McpV1/SiteContextController.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogReadTest.php`
- Modify: `/Users/eric/Documents/webless/tests/Feature/McpV1CatalogWriteTest.php`

- [ ] **Step 1: Add failing route and authorization tests**

Every endpoint must reject a missing/wrong service secret, missing actor identity, actor without site membership, actor without its exact endpoint permission, and a foreign `site_code`. Assert `X-Request-Id` echo and the standard success/error envelopes.

- [ ] **Step 2: Register these exact routes**

```php
Route::get('/sites/{siteCode}/catalog/categories', [McpV1CatalogController::class, 'categories']);
Route::put('/sites/{siteCode}/catalog/categories', [McpV1CatalogController::class, 'upsertCategory']);
Route::delete('/sites/{siteCode}/catalog/categories/{categoryId}', [McpV1CatalogController::class, 'deleteCategory']);
Route::get('/sites/{siteCode}/navigation/items', [McpV1CatalogController::class, 'navigation']);
Route::put('/sites/{siteCode}/navigation/items', [McpV1CatalogController::class, 'upsertNavItem']);
Route::delete('/sites/{siteCode}/navigation/items/{navItemId}', [McpV1CatalogController::class, 'deleteNavItem']);
Route::get('/sites/{siteCode}/catalog/products', [McpV1CatalogController::class, 'products']);
Route::get('/sites/{siteCode}/catalog/products/{productId}', [McpV1CatalogController::class, 'product']);
Route::post('/sites/{siteCode}/catalog/product-image-reference', [McpV1CatalogController::class, 'productImageReference']);
Route::put('/sites/{siteCode}/catalog/products', [McpV1CatalogController::class, 'upsertProduct']);
Route::delete('/sites/{siteCode}/catalog/products/{productId}', [McpV1CatalogController::class, 'deleteProduct']);
Route::post('/sites/{siteCode}/catalog/imports/inspect', [McpV1CatalogController::class, 'inspectImport']);
Route::post('/sites/{siteCode}/catalog/imports/validate', [McpV1CatalogController::class, 'validateImport']);
Route::post('/sites/{siteCode}/catalog/imports/commit', [McpV1CatalogController::class, 'commitImport']);
```

- [ ] **Step 3: Implement the thin controller**

Each action resolves `Site` by `callback_code`, calls `McpActorResolver::resolve()` with the permission array from the inventory table (the resolver preserves the MCP Core's any-of semantics), validates only transport-level shape, calls one domain service, and returns `McpApiResponse::success()`. Every mutation requires a valid `Idempotency-Key` and runs through `McpIdempotencyStore` with operation names such as `catalog.product.upsert`.

- [ ] **Step 4: Advertise additive capabilities**

Append these strings without changing major version `1`:

```php
'catalog_read',
'catalog_write',
'catalog_import',
'navigation_read',
'navigation_write',
```

- [ ] **Step 5: Run all Webless MCP catalog tests**

Run: `php artisan test tests/Unit/McpActorResolverTest.php tests/Feature/McpV1SiteContextTest.php tests/Feature/McpV1CatalogReadTest.php tests/Feature/McpV1CatalogWriteTest.php`

Expected: PASS for service authentication, actor/site permission, envelopes, request IDs, reads, writes, imports, idempotency, and tenant isolation.

- [ ] **Step 6: Commit the Webless API surface**

```bash
git add app/Http/Controllers/Internal/McpV1/CatalogController.php app/Http/Controllers/Internal/McpV1/SiteContextController.php routes/web.php tests/Feature/McpV1CatalogReadTest.php tests/Feature/McpV1CatalogWriteTest.php
git commit -m "feat: expose Webless MCP catalog API"
```

## Task 7: Extend the Node backend interface and HTTP client

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/slimWebBackend.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/backends/weblessBackendClient.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/weblessBackendClient.test.js`

- [ ] **Step 1: Add failing interface/client tests**

Assert all 14 method names, exact URL/method mapping, removal of `site_id`/`site_code` from JSON bodies, query-string mapping for product filters, route IDs for deletes/gets, exact `X-SlimWeb-Permission`, per-call `X-SlimWeb-Tool`, idempotency keys only on mutations, stable errors, malformed envelopes, and timeouts.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/weblessBackendClient.test.js`

Expected: FAIL because the Phase 2 interface methods are missing.

- [ ] **Step 3: Extend the interface list**

Append these exact methods to `SLIMWEB_BACKEND_METHODS`:

```js
'listCategories', 'upsertCategory', 'deleteCategory',
'listNavItems', 'upsertNavItem', 'deleteNavItem',
'listProducts', 'getProduct', 'prepareProductImageReference',
'upsertProduct', 'deleteProduct',
'inspectProductImport', 'validateProductImport', 'commitProductImport'
```

- [ ] **Step 4: Implement client methods**

Use `sitePath(actor, suffix)` to require and URL-encode `actor.site.site_code`. Use a shared `withoutSiteSelector(args)` helper. Reads call `request()` without an idempotency key; create/update/delete/import commit pass a newly generated key. Preserve raw backend `data` objects without client-side renaming.

- [ ] **Step 5: Run client tests**

Run: `node --test test/weblessBackendClient.test.js`

Expected: all interface, mapping, error, timeout, and idempotency tests PASS.

- [ ] **Step 6: Commit the Node interface**

```bash
git add src/backends/slimWebBackend.js src/backends/weblessBackendClient.js test/weblessBackendClient.test.js
git commit -m "feat: add SaaS catalog backend client"
```

## Task 8: Switch all 14 MCP tools to the Backend API

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/src/weblessRepository.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/weblessRepository.test.js`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/test/app.test.js`

- [ ] **Step 1: Add a failing no-direct-access test**

Construct `WeblessAccountRepository` with a backend client, a pool whose `query()` throws `unexpected SQL`, and storage methods that throw `unexpected storage`. Call every migrated method and assert the backend client receives the resolved actor and original arguments.

- [ ] **Step 2: Run and verify the direct path fails**

Run: `node --test --test-name-pattern='Phase 2 methods do not use PostgreSQL or storage' test/weblessRepository.test.js`

Expected: FAIL on the first current direct SQL/storage call.

- [ ] **Step 3: Add temporary delegations**

At the beginning of each of the 14 repository methods, delegate to the same-named backend method when `this.backendClient` is configured. Do not add a catch/fallback; backend failure must remain a failure.

- [ ] **Step 4: Run repository and public tool tests**

Run: `node --test test/weblessRepository.test.js test/app.test.js`

Expected: all tests PASS; `tools/list` remains 125 tools with hash `d6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871`.

- [ ] **Step 5: Compare Backend API responses to the legacy oracle**

Run the parity harness against controlled Webless fixtures for all success/error entries in `catalog-backend-parity.json`. Any difference must be fixed in Webless or explicitly approved and reflected in the public contract; do not normalize away a real behavior difference in Node.

- [ ] **Step 6: Remove migrated direct implementations**

After parity passes, replace the 14 methods with required backend delegation rather than keeping their SQL/storage bodies. Remove helper functions/imports used only by those methods. Keep helpers shared with unmigrated domains until their phase moves.

- [ ] **Step 7: Add an architecture guard**

Add a test that extracts the 14 method bodies and rejects `.pool.query`, `BEGIN`, raw catalog table names, `.storage`, `GcsStorageAdapter`, and `LocalStorageAdapter`. This guard is domain-scoped until Phase 6 removes all direct repository infrastructure.

- [ ] **Step 8: Run complete MCP tests**

Run: `npm test`

Expected: all tests PASS, 125 tools, frozen hash unchanged, and the Phase 2 architecture guard PASS.

- [ ] **Step 9: Commit the cutover**

```bash
git add src/weblessRepository.js test/weblessRepository.test.js test/app.test.js test/fixtures/catalog-backend-parity.json
git commit -m "refactor: route SaaS catalog through Webless API"
```

## Task 9: Full regression, documentation, and local runtime verification

**Files:**
- Modify: `/Users/eric/Documents/SlimWeb-MCP/README.md`
- Modify: `/Users/eric/Documents/SlimWeb-MCP/docs/superpowers/specs/2026-08-08-saas-mcp-backend-interface-design.md`
- Modify: `/Users/eric/Documents/webless/DB_SCHEMA.md` only if schema corrections were required.

- [ ] **Step 1: Run format/static checks available in both repositories**

Run in Webless: `./vendor/bin/pint --test`

Run in SlimWeb-MCP: `npm test`

Expected: no formatting failures; complete Node suite PASS.

- [ ] **Step 2: Run the complete Webless suite**

Run: `php artisan test`

Expected: all tests PASS with no new skipped or risky tests.

- [ ] **Step 3: Verify local services**

Check Laravel and Vite ports. If either is down, start it using the project runtime rule, then verify `/internal/mcp/v1/version` rejects an unauthenticated request and accepts the configured internal test credential.

- [ ] **Step 4: Update documentation accurately**

Change the README execution-path table to mark site context, basic settings, catalog, imports, and navigation as Webless Backend API. Keep all remaining domains labeled temporary direct repository. Document the 14 migrated tools and the fact that DB/storage credentials remain until Phases 3–6 finish.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/superpowers/specs/2026-08-08-saas-mcp-backend-interface-design.md
git commit -m "docs: record SaaS catalog backend migration"
```

## Task 10: Deploy Webless first, then MCP, and verify production

**Files:**
- Verify: `/Users/eric/Documents/webless/CLOUD_RUN_DEPLOYMENT_LOCAL.md`
- Verify: `/Users/eric/Documents/SlimWeb-MCP/.github/workflows/deploy.yml`

- [ ] **Step 1: Read the local Cloud Run deployment reference**

Confirm the current Webless service name, project, region, build process, database migration policy, and health checks from `CLOUD_RUN_DEPLOYMENT_LOCAL.md`. Do not infer them from old commands.

- [ ] **Step 2: Deploy Webless API support**

Deploy Webless while MCP still uses the old catalog implementation. Confirm 100% traffic on the new healthy Webless revision and verify `/internal/mcp/v1/version` advertises the Phase 2 capabilities.

- [ ] **Step 3: Run authenticated Webless API smoke tests**

Against designated test site `swcb_zog0l7zlyp3lwmlc`, run categories/nav/products safe reads, product import inspect/validate with a tiny in-memory CSV, and permission/foreign-site rejection tests. Record request IDs and verify correlated logs contain no secret or Google subject.

- [ ] **Step 4: Deploy SlimWeb-MCP**

Push the approved `main` commit, wait for the GitHub Actions deployment to succeed, confirm 100% traffic on the new MCP revision, and confirm health plus the frozen 125-tool hash.

- [ ] **Step 5: Run reversible public MCP writes**

On the designated test site only:

1. Create and delete a temporary nav dropdown with a generated SVG icon.
2. Create a temporary category using a committed test image, create a temporary product with one primary image, variants, stock, and quantity discount, read it back, update it, delete it, then delete the category.
3. Commit a tiny import with a unique prefix, verify results, then remove the imported temporary products/category through approved cleanup operations.
4. Replay one idempotent write and confirm no duplicate row is created.

Capture original counts and verify they are restored after cleanup. If cleanup fails, stop and report the exact remaining test records; do not continue to later phases.

- [ ] **Step 6: Verify production architecture and logs**

Confirm Phase 2 requests appear in Webless under their request IDs, MCP logs show Backend API calls rather than SQL, cross-site and missing-permission attempts return stable errors, and the MCP production revision still retains DB/storage credentials only for unmigrated domains.

- [ ] **Step 7: Append acceptance evidence**

Record Webless revision, MCP revision, workflow run, test counts, contract hash, designated site, read/write/import smoke results, cleanup confirmation, and idempotency confirmation in the approved design document. Mark only Phase 2 complete.

## Completion gate

Phase 2 is complete only when all of the following are true:

- All 14 public tool names, schemas, permissions, confirmations, response shapes, and stable errors match the frozen contract/parity fixtures.
- Webless revalidates actor, site, and exact permission for every endpoint.
- All category, navigation, product, variant, stock, image, discount, and import persistence runs inside Webless.
- The 14 Node repository methods contain no SQL or storage execution and have no runtime fallback.
- Full Webless and MCP test suites pass.
- Webless is deployed before MCP, both healthy, and the live contract hash remains unchanged.
- Reversible production reads/writes/imports pass on the designated test site and cleanup restores the original state.
- Standalone code and deployment remain untouched.
