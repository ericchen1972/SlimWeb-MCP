# Site Logo Basic Settings Design

## Goal

Expose site logo replacement through the existing `slimweb_settings_get` and `slimweb_settings_update` tools, while making Webless admin uploads and MCP updates use the same normalization and single-file lifecycle.

## Public MCP contract

`slimweb_settings_get` returns `settings.logo` with `media_path`, `public_url`, and `mime_type` when a custom logo exists. A successful replacement response additionally includes the normalized `width` and `height` produced by Webless.

`slimweb_settings_update` accepts an optional `logo` object with exactly one source:

- `media_path`: a committed raster image created through the existing signed-upload flow.
- `svg_base64`: base64-encoded SVG markup read from a local SVG file by a byte-capable client such as Codex.

Omitting `logo` preserves the current logo. No new MCP tool is added.

## Shared Webless behavior

Webless owns logo normalization through one `SiteLogoManager` service used by both the manual basic-settings controller and a narrow MCP-internal logo endpoint.

- Raster input is decoded, never upscaled, constrained to a maximum height of 96 pixels, resized proportionally, transparency-preserving, and encoded as WebP.
- SVG input remains SVG, is size-limited and sanitized to remove scripts, event handlers, embedded HTML, external references, and unsafe URLs. Its intrinsic dimensions are normalized so height never exceeds 96 while preserving the viewBox aspect ratio.
- The normalized logo is written beneath `sites/{site_id}/settings/` using a content fingerprint in the filename.
- After the database points at the new logo, the previous logo is deleted. For MCP raster updates, the committed staging object is also deleted so it does not remain visible to media-library scans.
- The public URL changes with the content fingerprint, preventing stale browser caches while keeping exactly one active stored logo.

## Failure behavior

Invalid raster bytes, malformed SVG, unsafe SVG, cross-site media paths, missing committed objects, and oversized payloads fail before the site logo is changed. A failed replacement leaves the previous logo intact.

## Verification

Automated tests cover raster resizing and WebP output, SVG preservation and sanitization, single-logo replacement cleanup, the manual admin upload path, the MCP internal endpoint, the MCP public schema/dispatch, and settings readback. Both repositories must pass their focused suites and full suites before deployment. Production verification checks the Webless ready endpoint and the SlimWeb-MCP `/readyz` endpoint after their deployments finish.
