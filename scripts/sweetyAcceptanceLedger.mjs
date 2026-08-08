import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCEPTANCE = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  PASS_SUCCESS: 'PASS_SUCCESS',
  PASS_EXPECTED_ERROR: 'PASS_EXPECTED_ERROR',
  FAIL_DEFECT: 'FAIL_DEFECT',
});

const SITE_CODE = 'swcb_g3fg1bpnjulrr75o';
const EXPECTED_COUNT = 125;
const EXPECTED_HASH = 'd6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871';

const DOMAIN_RULES = [
  ['identity', /_(auth_status|sites_list|site_select)$/],
  ['orders', /_(orders_|returns_|refunds_)/],
  ['promotions_members', /_(coupon_|discount_|threshold_|member)/],
  ['catalog', /_(categories_|products_|product_)/],
  ['content_navigation', /_(pages_|articles_|content_seo|nav_items_)/],
  ['theme_media', /_(theme|design_context|assets_|uploads_|images_|external_assets_|media_library|preview_)/],
  ['communications_integrations', /_(mail_|newsletters_|customer_service_|facebook_|notion_|posters_)/],
  ['settings_operations', /_(settings_|site_|dashboard_|payment_|admins_|audit_|exports_|debug_)/],
];

export function classifyDomain(tool) {
  return DOMAIN_RULES.find(([, pattern]) => pattern.test(tool))?.[0] ?? 'settings_operations';
}

export function buildRows(tools) {
  return tools.map(({ name }) => ({
    tool: name,
    siteCode: SITE_CODE,
    domain: classifyDomain(name),
    prerequisite: '',
    expected: '',
    actual: '',
    status: ACCEPTANCE.NOT_RUN,
    cleanup: '',
    evidence: '',
  }));
}

export function assertFrozen(contract) {
  if (contract.count !== EXPECTED_COUNT || contract.sha256 !== EXPECTED_HASH) {
    throw new Error(`Unexpected MCP contract: ${contract.count}/${contract.sha256}`);
  }
}

export function renderMarkdown(rows) {
  const header = '| Tool | Domain | Prerequisite | Expected | Actual | Status | Cleanup | Evidence |\n|---|---|---|---|---|---|---|---|';
  return [
    header,
    ...rows.map((row) => (
      `| ${row.tool} | ${row.domain} |  |  |  | ${row.status} |  |  |`
    )),
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtureUrl = new URL('../test/fixtures/saas-tool-contract.json', import.meta.url);
  const contract = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

  assertFrozen(contract);
  process.stdout.write(`${renderMarkdown(buildRows(contract.tools))}\n`);
}
