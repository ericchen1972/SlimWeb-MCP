# Invoice lifecycle MCP contract

Nine tools extend the catalog from 128 to 137. Settings require `payments_shipping`; invoice records and operations require `invoices_management` plus the existing backend AI permission. The site selector is the resolved `site_code`; Standalone transport keeps the signed Domain binding.

- `slimweb_invoice_settings_get/update`: GET/PUT `/commerce/settings/invoice`. Blank secret writes preserve saved credentials. Read responses contain no secret values. Explicit user intent is required before enabling automatic issue or switching to production.
- `slimweb_invoices_list`: GET `/commerce/invoices` with exact order_id, status, provider, mode, keyword, date_from/date_to, limit/offset.
- `slimweb_invoices_get`: GET `/commerce/invoices/{invoiceId}`.
- `slimweb_invoices_create`: POST `/commerce/invoices`. Creates a draft with stable `idempotency_key`, optional `order_id`, or standalone `transaction_date`, `buyer`, `items`.
- `slimweb_invoices_issue/sync/void/allowance`: POST `/commerce/invoices/{invoiceId}/{action}`. Issue/void/allowance require `confirmed: true` and a stable `idempotency_key`. Void/allowance require reason; allowance also integer NTD amount and buyer_agreed=true confirming prior buyer consent with evidence retained.

All paths above are within `/internal/mcp/v1/sites/{siteCode}`. Request idempotency_key must match Idempotency-Key header. Core preserves user-supplied retry keys. Unknown provider outcomes are reconciled through sync before retry; an HTTP timeout is not authorization to create a new operation key. Financial service operations own their durable ledger and must not be wrapped in the generic MCP transaction retry closure.

Prices are tax-inclusive, NTD, ordinary taxable 5%. There is no tax-settings surface. Draft creation has no order/stock side effects. Issue, void, and allowance change financial records and require explicit user intent. No live production invoices were created for contract tests.

## Release order

1. Verify and deploy the two Laravel backends, including invoice migrations, controllers, routes, services, permissions. Standalone advertises `invoice_lifecycle_v1` only when this contract is installed.
2. Release the verified Core commit as `v0.1.8` (package version and lockfile version together). Do not move the existing v0.1.7 tag.
3. In each MCP consumer run `npm install --save-exact github:ericchen1972/SlimWeb-MCP-Core#v0.1.8` and commit both package.json and package-lock.json. Never publish local file dependencies or manually fabricate a lockfile SHA.
4. Run Core and both consumer Node suites against that exact installed tag. Candidate contract: 137 tools, SHA256 `cbb4589ff4ec9a5e92f66515a760dff5af2110112777b9c99b715727ee9f88e5`.
5. Deploy MCP candidates and verify settings redaction, site/Domain isolation, permissions, draft creation and explicit intent checks. Provider test-environment verification is separate from these contract tests. Do not call production issue/void/allowance as a smoke test.

Local consumer verification temporarily copies candidate Core source into the installed package, then restores the original v0.1.7 installation. Release manifests now pin v0.1.8 and the lockfile resolves its immutable Git commit. Standalone hides the nine invoice tools for older full-contract installations lacking `invoice_lifecycle_v1`.
