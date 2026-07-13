# Web Admin and MCP Parity Design

## Goal

Bring the public SlimWeb MCP surface into practical parity with Web admin for site-internal data, while keeping every tool narrow, independently callable, composable, permission-scoped, and auditable. Site deletion and subscription management remain outside MCP.

## Guiding Principles

- Expose independent read, write, and delete tools instead of a generic task or delete tool.
- Let the AI client compose tools into progressive conversations or plan-driven website builds.
- Reuse Webless validation, authorization, relationship checks, side effects, and storage-reference checks.
- Require stable IDs for ordinary writes and deletes whenever the target is not uniquely resolved.
- Apply stricter user-supplied order-number rules to order mutations and deletion.
- Detect image workflow capability, not a hard-coded client brand.
- Never insert placeholder images or pretend a generated image is available to Remote MCP.

## Scope

### Included

- Complete contact settings control.
- Every site-internal delete operation available in Web admin but missing from MCP.
- Notion page discovery, content reading, import, refresh, and generated-cover workflow.
- Category creation with required SVG icon and required 16:9 illustration.
- Full Web-admin order status control, recipient updates, and order deletion.
- Printable waybill URLs for explicit orders or query-selected order sets.
- Media-library statistics and deletion of unused media.
- Documentation, model guidance, permission maps, audit coverage, and tests.

### Excluded

- Deleting a site.
- Subscription or billing operations.
- Direct control of a local printer from MCP.
- A generic `delete_anything` tool.
- A monolithic Notion import or category creation task tool.

## Architecture

The MCP server continues to expose narrow tools from `src/app.js`. Repository methods in `src/weblessRepository.js` implement site-scoped reads and writes or call authenticated Webless endpoints when behavior must be shared with Laravel. Webless owns the canonical Notion conversion, order transition, waybill rendering, media-reference detection, and storage deletion behavior.

Shared pure helpers normalize titles, classify exact and partial matches, validate explicit order numbers, and format resumable workflow guidance. These helpers do not execute multi-step tasks. The AI client remains the orchestrator.

## Contact Settings

Add:

- `slimweb_contact_settings_get`
- `slimweb_contact_settings_update`

The tools cover every field currently editable in Web admin, including email, LINE, WeChat, Telegram, X/Twitter, Instagram, Facebook Page, store address, and phone. Update uses patch semantics: omitted fields remain unchanged and explicit `null` clears a field. The theme shell may consume contact data for layout decisions but is not a settings-write substitute.

## Site-Internal Delete Parity

Inventory Web admin routes and add an independent MCP delete tool for every missing site-internal delete operation. The known set includes:

- External page/theme assets.
- Members.
- Issued member coupon assignments.
- Articles.
- Newsletters.
- Customer-service logs.
- Discount codes.
- Member tiers.
- Threshold gifts.
- Product add-ons.
- Orders.

Existing delete tools for admins, themes, pages, nav items, categories, and products remain unchanged. Coupon templates are not added unless Web admin has a corresponding delete operation at implementation time.

Each tool uses the same module permission as its Web admin operation, scopes the target to the selected site, returns the deleted stable ID and useful summary, and writes an audit record. Existing Webless protection and relationship rules remain authoritative.

Because Web admin can manage existing newsletters while MCP currently only creates them, add narrow newsletter list, get, and update tools alongside newsletter deletion.

## Notion Article Workflow

### Independent tools

Add:

- `slimweb_notion_pages_search`
- `slimweb_notion_page_get_content`
- `slimweb_articles_delete`

Continue using:

- `slimweb_articles_create`
- `slimweb_articles_update`
- `slimweb_articles_get_content`
- `slimweb_content_seo_update`

The configured Notion integration token can only access pages granted to that integration and their accessible descendants. Users identify a page by title; MCP uses `notion_page_id` as the stable identity.

### Shared title resolution

Import and update use the same resolver:

1. Search authorized Notion pages by the user-supplied title.
2. Return `exact_matches` and `partial_matches` with `notion_page_id`, title, and import state.
3. A single exact match may proceed.
4. Multiple exact matches require user selection.
5. Partial matches such as `KAI說明` and `KAI應用` for query `KAI` require user selection.
6. No match returns a not-found response that asks the user to check the title and Notion authorization.
7. Determine import state by `notion_page_id`, not title alone.

### Import and update behavior

- If an import request resolves to an already imported page, ask whether to update the existing article.
- If an explicit update request resolves to an imported page, read Notion content and update it.
- If an explicit update request resolves to a page that has never been imported, explain that it is not imported and ask whether to create it.
- The content tool returns converted title and safe HTML for the AI to pass to article create or update.
- The resulting article stores `notion_page_id` to prevent duplicate imports.

## Image Workflow

Image workflow guidance first checks whether the user already supplied a usable image.

### User-provided image

If the image is available as readable bytes, a downloadable URL, a committed `media_path`, or an importable conversation attachment, normalize or import it and continue. Do not generate a replacement and do not ask the user to reattach an already usable image.

### Continuous runtime

When the AI runtime can read generated or local image bytes and make an outbound HTTPS PUT:

1. Generate the requested 16:9 image.
2. Call `slimweb_uploads_create`.
3. PUT raw bytes to the signed URL.
4. Call `slimweb_uploads_commit`.
5. Pass the returned `media_path` to the article or category tool.
6. Complete the task in the same flow.

Codex and Hermes with code or local-file access are common examples.

### Reattachment runtime

When the AI can generate an image but cannot transfer generated bytes to Remote MCP:

1. Generate the image.
2. Stop before writing the article or category.
3. Ask the user to paste the approved image back into the conversation.
4. After reattachment, call `slimweb_images_import_chatgpt_attachment`.
5. Continue using the returned `media_path`.

ChatGPT Remote MCP and some Claude environments are examples, but capability detection is authoritative.

### Resumable guidance

Tools return a compact continuation summary when an image is missing: workflow type, site, resolved source identity, completed steps, missing asset, suggested next tool, and required arguments. MCP does not keep a hidden long-running workflow session.

## Category Creation and Update

Category matching follows the same exact/partial/absent principles as Notion page matching:

- A unique exact match can be updated.
- Partial or multiple matches require user selection.
- A category is created only when no matching category exists.

New category creation requires all of:

- Unique category name.
- Valid generated SVG icon normalized to the existing 24px contract.
- Committed 16:9 category illustration.

SVG generation does not require the bitmap upload flow. The 16:9 illustration follows the shared image workflow. Updates preserve existing icon and illustration unless the user explicitly requests replacement.

## Order Mutations and Deletion

Add:

- `slimweb_orders_update_status`
- `slimweb_orders_update_recipient`
- `slimweb_orders_delete`

### Explicit-target rule

For status changes, recipient changes, and deletion, the user must include every complete order number in the current mutation instruction. References such as `these orders`, `the orders above`, or `all of today's orders` are invalid even if the AI listed those orders immediately beforehand.

The public mutation tools accept order numbers rather than internal IDs. Batch operations validate that every order number is non-duplicated, exists, and belongs to the selected site before any mutation occurs. Validation failure prevents partial execution.

### Status parity

Expose the same top-level status values as Web admin:

- `pending`
- `confirmed`
- `returning`
- `returned`

Use the canonical Webless transition behavior so member spending, timestamps, return state, and status logs remain consistent. Payment, forward logistics, return logistics, and refunds stay in their existing independent tools.

## Waybill URLs and Printing

Add independent URL tools for:

- One forward-logistics waybill.
- A batch of forward-logistics waybills.
- A provider-specific batch when required by Webless.
- Return-logistics waybills.

Successful logistics creation also returns a single-order `waybill_url` when printable.

Waybill selection is intentionally looser than order mutations because generating a printable URL does not modify order business state. The user may:

- Provide complete order numbers; or
- Describe a supported query such as `orders not yet shipped`.

For a query-selected print request, the AI first calls `slimweb_orders_list` with the appropriate filters, then passes the returned stable order set to the batch waybill URL tool. The tool validates that the selected orders are printable and returns the URL plus included and excluded order summaries.

MCP never controls a printer. An AI client with browser or local-computer control may ask the user whether to open and print the returned URL. It may operate the print interface only after the user agrees. Other clients return the URL to the user.

## Media Library

Add:

- `slimweb_media_library_stats`
- `slimweb_media_library_delete_unused`

The statistics tool returns:

- Total asset count.
- Total size in bytes and a human-readable size.
- Unused asset count.
- Unused size in bytes and a human-readable size.
- Optional unused asset details.

Unused status reuses the Webless reference detector across articles, newsletters, product images, category images, site settings, and page/theme template files.

The cleanup tool needs no second confirmation. It accepts no arbitrary used-asset deletion mode. It enumerates unused committed assets, rechecks each asset immediately before deletion, deletes only assets still unused, and returns deleted, skipped, and failed counts, byte totals, and item details. A newly referenced asset is skipped.

## Permissions and Audit

- Contact tools use settings read/write permissions.
- Notion discovery and content reads use integration/content read permissions.
- Article deletion uses content write permission.
- Promotion deletions use promotion write permission.
- Member and coupon-assignment deletions use member write and promotion write as appropriate.
- Newsletter management uses member write permission.
- Order mutations and deletion use order write permission.
- Waybill URL tools use order read permission unless logistics creation is also performed.
- Media stats use asset read permission; unused cleanup uses asset write permission.
- Every write and delete is audited with site, actor, stable target identifiers, changed fields or deleted identifiers, result, and request ID.

## Error Handling

Use existing coded MCP errors consistently:

- `VALIDATION_FAILED` for malformed or incomplete inputs.
- `NOT_FOUND` when a stable site-scoped target does not exist.
- `CONFLICT` for ambiguous title matches, duplicate imports, relationship constraints, or non-printable waybills.
- `FORBIDDEN` for missing module permission.
- Backend errors are sanitized while preserving actionable next steps.

No tool silently guesses a target, partially executes an atomic order batch, deletes an in-use asset, or inserts a placeholder image.

## Testing and Acceptance

All behavior is implemented test-first. Automated coverage must prove:

- Every new tool appears in MCP discovery with narrow descriptions and schemas.
- Permission maps and suggested-tool mappings include every new tool.
- Every read and write is site-scoped.
- Contact get/update covers every Web-editable contact field and patch/null semantics.
- The delete inventory matches current Web admin site-internal delete routes except site deletion.
- Each delete tool enforces cross-site and relationship protection.
- Newsletter list/get/update/delete manage existing newsletters.
- Notion exact, partial, multiple, absent, authorized, imported, and unimported cases behave as specified.
- Import and update use the same title resolver and stable `notion_page_id`.
- A usable user-provided image bypasses generation guidance.
- New categories fail when either SVG icon or 16:9 illustration is missing.
- Category updates preserve unspecified assets.
- Order mutations reject contextual references and require complete order numbers supplied by the user.
- Invalid batch order input causes zero mutations.
- All four Web-admin order status transitions preserve canonical side effects.
- Logistics creation and waybill tools return usable URLs.
- Query-selected batch waybill generation works without user-supplied order numbers.
- Media counts and byte totals are correct.
- Used assets cannot be cleaned, and assets referenced during cleanup are skipped.
- README tool tables, detailed contracts, model guidance, and tests stay aligned.

## Delivery Phases

1. Contact settings, delete parity, and newsletter management.
2. Notion search/read workflow and category image requirements.
3. Order mutations, deletion, and waybill URLs.
4. Media statistics and unused-media cleanup.

Each phase is independently testable and deployable. No phase changes the independent-tool architecture.
