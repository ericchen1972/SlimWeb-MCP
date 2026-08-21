# EasyDays Theme Migration Acceptance — 2026-08-22

## Scope

- Site: EasyDays (`swcb_bofnoha3vtoiehmq`, site ID 6)
- Historical source: Default Theme #30
- New active Theme: EasyDays #31
- Webless production revision: `webless-00636-xaf`
- Webless source commit: `f53f931b86294c52dd58a70b87a1cc4af8348861`
- SlimWeb MCP source commit: `47c8fcf`
- Standalone MCP candidate source commit: `cd38729`

## Migration evidence

The copy dry-run identified exactly three historical Default root objects:

- `sites/6/templates/default/assets/root-elements/css/00-mcp-theme.css`
- `sites/6/templates/default/root-elements/footer.blade.php`
- `sites/6/templates/default/root-elements/navbar.blade.php`

The apply phase copied those objects to Theme #31, cloned the complete Theme style profile, and created the backup manifest:

`sites/6/template-backups/easydays-default-theme-20260821-212825-984399/manifest.json`

The migration command verifies source, destination, backup hashes, and the profile snapshot before cleanup. The cleanup dry-run and apply phase both selected only the same three manifest-owned root objects. Default page bodies were outside the cleanup scope.

## Post-migration state

- Theme #31 (`EasyDays`) is active and non-Default.
- Theme #30 (`Default`) is inactive.
- Default root CSS reads as an empty string and Default style profile reads as `null`, so canonical runtime shell/profile fallback applies.
- Theme #31 retains the EasyDays navbar, footer, root CSS, and complete style profile.
- `slimweb_design_context_get` reports the active custom-Theme policy action as `ask_create_or_modify`.
- Theme-managed elements are `navbar`, `floating_actions`, `footer`, `root_css`, and `style_profile`.

## Storefront regression

The public storefront was checked before activation, after activation, and again after Default cleanup.

| Viewport | Navbar | Footer | Overflow | Responsive state |
| --- | --- | --- | --- | --- |
| 1536 x 1000 | EasyDays navbar present | `rgb(57, 71, 58)` | none | desktop navigation visible; mobile trigger hidden |
| 390 x 844 | EasyDays navbar present | `rgb(57, 71, 58)` | none | desktop navigation hidden; 44 x 44 mobile trigger visible |

The public page title remained `EasyDays｜陪你過好每個小日子` and the live shell appearance remained unchanged throughout the migration.

## Deployment notes

- Webless was deployed candidate-first, health-checked at `/up`, then promoted to 100% production traffic.
- SlimWeb MCP GitHub Actions deployment completed successfully.
- Standalone MCP GitHub Actions deployed the new contract as a no-traffic candidate; it was not promoted automatically.
- The first migration Job dry-run failed before command execution because the reusable Job retained `APP_DEBUG=true`. The Job was corrected to production-safe environment values, then all dry-run and apply executions completed successfully.
