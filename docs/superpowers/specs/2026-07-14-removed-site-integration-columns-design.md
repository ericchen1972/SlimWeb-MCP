# Removed Site Integration Columns Design

## Problem

Webless migration `2026_06_13_010000_remove_site_level_social_login_and_ai_api_settings.php` removed seven site columns: LINE Login channel ID/secret, Google Login client ID, and the site-level AI API URL/key/model/provider. SlimWeb-MCP still selects and updates six of those columns through its integration-settings repository path. `slimweb_site_launch_progress_get` calls that path while building readiness, so PostgreSQL aborts the request at the first missing column.

## Chosen approach

Align SlimWeb-MCP with the current Webless schema instead of restoring deprecated columns or silently probing for them. Remove the deprecated fields from the repository integration contract and persistence SQL. Remove the site-level third-party-login readiness category because login is no longer configured per site. Keep the remaining Facebook, Notion, SMS, customer-service, Google Search, and LINE Bot fields unchanged.

## Data flow

`slimweb_site_launch_progress_get` continues to call `getSiteReadiness()`. Readiness loads only current integration columns, then evaluates categories that are still actionable at site scope. Facebook and Notion tools continue to use the shared integration persistence path, but that path reads and writes only current columns.

## Compatibility and error handling

No database migration is required. Existing response fields for the exposed Facebook and Notion tools are unchanged. Deprecated internal integration fields disappear from the repository-only aggregate result; no public MCP tool advertises them. PostgreSQL errors remain visible for genuinely unexpected schema drift.

## Tests

Add a regression guard whose fake database rejects any SQL containing a removed column. Exercise launch progress plus Facebook and Notion reads/writes. Update readiness expectations to confirm the obsolete `third_party_login` category is absent. Run the focused repository test and the complete Node test suite before deployment.
