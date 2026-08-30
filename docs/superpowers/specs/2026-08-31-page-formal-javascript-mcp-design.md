# MCP Page Formal JavaScript Design

**Date:** 2026-08-31

## Goal

Allow SlimWeb MCP page creation and updates to deliver interactive page behavior such as Swiper carousels without placing executable inline `<script>` elements in page HTML or weakening the storefront CSP and HTML safety boundary.

The change must work consistently for the homepage `index` and editable custom pages across all SlimWeb sites.

## Confirmed Problem

The public `slimweb_pages_create` and `slimweb_pages_update` contracts currently tell AI clients that page-scoped inline JavaScript is allowed. Webless rejects every executable `<script>` element in `content.html`, returning `VALIDATION_FAILED`.

EasyDays succeeded with inline carousel JavaScript before the 2026-08-22 security hardening. Sweety failed after that change. The storefront already supports same-origin formal JavaScript stored under `pages/{page_key}/assets/js/*.js`; the MCP page-write path does not expose that capability.

## Scope

This work covers:

- `slimweb_pages_get_content`
- `slimweb_pages_create`
- `slimweb_pages_update`
- Webless storage and storefront delivery for MCP-managed page JavaScript
- SlimWeb-MCP-Core tool schemas, workflow instructions, and repository forwarding
- SlimWeb-MCP documentation, generated contract fixture, dependency version, and tests
- focused cross-repository verification and live Sweety carousel completion after deployment

This work does not add Theme-level JavaScript, accept arbitrary external script URLs, weaken HTML sanitization, or change the external-library allowlist.

## Public Contract

### Page content shape

The three page tools use the following content shape:

```json
{
  "content": {
    "html": "<main>...</main>",
    "javascript": "(() => { ... })();"
  }
}
```

`content.html` remains required for create and update writes. It may contain page HTML and scoped CSS, but it must not contain executable `<script>` elements, external `<link>` elements, inline event handlers, or other content already rejected by Webless.

`content.javascript` is optional and contains JavaScript source only. It must not include surrounding `<script>` tags.

### Create semantics

- Omitted `content.javascript`: create no MCP-managed page JavaScript asset.
- Nonblank `content.javascript`: validate and store the source as the page's MCP-managed formal JavaScript asset.
- Blank `content.javascript`: treat as omitted and create no asset.

### Update semantics

- Omitted `content.javascript`: preserve the existing MCP-managed page JavaScript asset.
- Nonblank `content.javascript`: replace the complete MCP-managed page JavaScript asset.
- Explicit blank `content.javascript`: delete the MCP-managed page JavaScript asset.

These patch semantics prevent an HTML-only page edit from silently disabling existing interactions.

### Read semantics

`slimweb_pages_get_content` returns:

```json
{
  "content": {
    "html": "<main>...</main>",
    "javascript": "(() => { ... })();"
  }
}
```

When the MCP-managed asset does not exist, `content.javascript` is an empty string. The read surface returns only the MCP-managed page script, not unrelated manually managed or migrated formal JavaScript files.

## Storage Contract

Webless stores the MCP-managed page script at:

```text
sites/{site_id}/templates/default/pages/{page_key}/assets/js/90-mcp-page.js
```

The homepage and custom-page body remain under the Default page-content layer even when a custom Theme is active. This matches the storefront rule that page content and page behavior are independent from Theme shell behavior.

Writes use the existing `GcsStorage` abstraction. After uploading JavaScript, Webless reads the object back and verifies its SHA-256 digest. A failed verification aborts the operation and returns an error rather than reporting a successful partial write.

When both HTML and JavaScript change, Webless validates both inputs before writing either object and snapshots the previous HTML and MCP-managed JavaScript states. If any upload, deletion, or read-back verification fails, it restores and verifies both previous states before returning an error. This compensation boundary prevents a reported failure from leaving new JavaScript paired with old HTML, or new HTML paired with old JavaScript. The existing idempotency wrapper protects retries using the complete request payload.

## JavaScript Validation

The JavaScript field is restricted to:

- a string value;
- at most 100 KiB after UTF-8 encoding;
- no `<script` or `</script>` markup;
- no Blade, PHP, or server-template delimiters such as `{{`, `{!!`, `<?`, or `<%`;
- no static or dynamic external module import syntax;
- no source-map URL directive.

The validator does not attempt to prove arbitrary JavaScript safe through fragile source rewriting. Page management is already a privileged content-write operation, and the formal asset remains same-origin under the storefront CSP. The restrictions prevent breaking out of the intended asset format or reintroducing external executable dependencies outside `enabled_libraries`.

External libraries continue to be selected only through `enabled_libraries`. For a Swiper carousel, the page write sends `enabled_libraries: ["swiper"]` and places only the Swiper initialization code in `content.javascript`.

## Storefront Delivery

No new storefront loader is required. `StorefrontController` already:

- discovers JavaScript under the page `assets/js` directory;
- serves it with a JavaScript MIME type;
- emits versioned same-origin URLs;
- loads formal scripts with `defer`;
- uses Default page scripts for the homepage even when a custom Theme supplies the shell.

Verification must prove that allowlisted library assets are available before the page initialization script executes. If current ordering does not guarantee that relationship, the implementation must adjust the managed library tag delivery or formal-script placement without allowing inline executable JavaScript.

## Webless Changes

`PageService` will:

- read and return `90-mcp-page.js` as `content.javascript`;
- validate JavaScript before any write;
- create, replace, preserve, or delete the formal asset according to the contract;
- keep the existing `safeHtml()` executable-content rejection unchanged;
- include JavaScript asset status and byte count in the write result.

The focused Webless tests will cover:

- create with JavaScript;
- update replacement;
- update omission preservation;
- explicit blank deletion;
- homepage and custom-page paths;
- `<script>` rejection in HTML;
- JavaScript field validation;
- upload/read-back verification failure;
- compensation restores the previous HTML and JavaScript after either write fails;
- storefront loading and ordering with `enabled_libraries: ["swiper"]`.

## SlimWeb-MCP-Core Changes

The Core package is the authoritative public tool contract. It will:

- add `content.javascript` guidance to page read/create/update tools;
- remove every statement saying inline executable JavaScript belongs in `content.html`;
- instruct clients to read, preserve, or replace `content.javascript` during page edits;
- retain `enabled_libraries` as the only external-library selector;
- forward the structured `content` object without flattening or dropping `javascript`;
- update Core tests and release a new package tag.

## SlimWeb-MCP Changes

The service repository will:

- update `@slimweb/mcp-core` to the new tag;
- regenerate the frozen SaaS tool-contract fixture;
- update README page workflow and security documentation;
- update tests that currently require the incorrect inline-JavaScript wording;
- verify the public tool schemas and runtime forwarding behavior.

## Error Handling

Validation failures must retain field-level details from Webless. For example, invalid JavaScript returns `VALIDATION_FAILED` with a `content.javascript` field error. The MCP error mapper must expose this detail in a human-actionable message instead of reducing it to only `{ "reason": "VALIDATION_FAILED" }`.

No page object is reported as updated when JavaScript validation or storage verification fails.

## Migration And Compatibility

Existing pages without `90-mcp-page.js` continue to work unchanged.

Legacy inline scripts already stored in page HTML are handled by the existing `slimweb:extract-storefront-page-scripts` command. That command is not used for new MCP writes. Existing migrated files such as `90-migrated-inline.js` remain separate and are not overwritten by `90-mcp-page.js`.

EasyDays requires a read-only audit after deployment:

- confirm whether a migrated formal page script exists;
- confirm the live carousel controls and automatic rotation work;
- do not overwrite EasyDays merely to normalize filenames.

## Deployment And Acceptance

Deployment order is:

1. deploy Webless support and verify its candidate revision;
2. tag and publish SlimWeb-MCP-Core;
3. update, test, and deploy SlimWeb-MCP;
4. refresh the connected MCP tool contract;
5. re-read Sweety homepage state;
6. submit the Sweety homepage with `enabled_libraries: ["swiper"]`, HTML without `<script>`, and initialization source in `content.javascript`;
7. read back the saved HTML and JavaScript;
8. inspect the Sweety storefront at required desktop and mobile widths and exercise automatic rotation, previous/next controls, pagination, keyboard behavior, reduced-motion behavior, image selection, and overflow;
9. verify EasyDays has no regression.

Acceptance requires:

- HTML still rejects executable inline scripts;
- formal JavaScript is saved, returned, versioned, and executed;
- Swiper is available before Sweety initialization runs;
- failed writes expose actionable validation details;
- Sweety carousel works at desktop and mobile sizes;
- EasyDays and unrelated Theme shell content remain unchanged;
- focused and full relevant tests pass in all three repositories;
- deployed revisions and live behavior are recorded separately from Git commit state.
