# Removed Site Integration Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop SlimAI launch-progress and integration-setting tools from querying Webless site columns removed by migration.

**Architecture:** Keep the existing shared integration-settings repository path, but narrow its column list and persistence statement to the current Webless schema. Remove the readiness category whose inputs no longer exist at site scope.

**Tech Stack:** Node.js 20+, ECMAScript modules, `node:test`, PostgreSQL SQL strings

---

### Task 1: Add a schema-contract regression test

**Files:**
- Modify: `test/weblessRepository.test.js`

- [x] **Step 1: Make the readiness and integration fake pools reject removed columns**

Add a helper with the exact removed identifiers and call it for every SQL query:

```js
const REMOVED_SITE_INTEGRATION_COLUMNS = [
  'line_login_channel_id', 'line_login_channel_secret', 'google_login_client_id',
  'ai_api_url', 'ai_api_key', 'ai_model_name', 'ai_provider'
];

function assertNoRemovedSiteIntegrationColumns(sql) {
  for (const column of REMOVED_SITE_INTEGRATION_COLUMNS) {
    assert.equal(sql.includes(column), false, `query references removed sites column: ${column}`);
  }
}
```

Update the fake rows and update-parameter mapping to contain only current columns. Assert launch progress succeeds without a `third_party_login` readiness category, and keep Facebook/Notion read-write coverage.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='site readiness|site launch progress|integration settings' test/weblessRepository.test.js`

Expected: FAIL because current repository SQL references `line_login_channel_id` and other removed fields.

### Task 2: Align repository SQL and readiness behavior

**Files:**
- Modify: `src/weblessRepository.js`

- [x] **Step 1: Remove deprecated integration fields**

Delete the removed identifiers from `INTEGRATION_SETTINGS_COLUMNS`, `persistIntegrationSettings()`, `normalizeIntegrationSettings()`, and `formatIntegrationSettings()`. Renumber SQL placeholders and parameter bindings so current fields remain patch-preserving.

- [x] **Step 2: Remove obsolete readiness category**

Remove `thirdPartyLoginReadiness(integrationSettings)` from `buildSiteReadinessReport()` and delete the helper. Do not replace it with a permanently-ready placeholder.

- [x] **Step 3: Run the focused test and verify GREEN**

Run: `node --test --test-name-pattern='site readiness|site launch progress|integration settings' test/weblessRepository.test.js`

Expected: PASS.

### Task 3: Verify, commit, deploy, and live-check

**Files:**
- Verify: `src/weblessRepository.js`
- Verify: `test/weblessRepository.test.js`
- Verify: `.github/workflows/deploy.yml`

- [x] **Step 1: Run the complete suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Review scope and commit**

Run `git diff --check`, inspect `git diff --stat` and the full diff, then commit only the intended files with message `fix: align integration settings with current schema`.

- [ ] **Step 3: Push and verify GitHub Actions**

Push `main`, resolve the deploy workflow run for the new commit, and wait for `conclusion: success`.

- [ ] **Step 4: Verify Cloud Run**

Run `curl` against `/readyz` and `/`, requiring HTTP 200. If authenticated live MCP credentials are available, invoke launch progress for the affected site; otherwise report the health and deployment proofs separately from the authenticated functional check.
