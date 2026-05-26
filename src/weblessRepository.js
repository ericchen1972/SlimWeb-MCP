import pg from 'pg';

const { Pool } = pg;

export function databaseConfigFromEnv(env = process.env) {
  const sslMode = String(env.DB_SSLMODE ?? '').toLowerCase();
  const config = {
    host: env.DB_HOST,
    port: env.DB_PORT ? Number.parseInt(env.DB_PORT, 10) : undefined,
    database: env.DB_DATABASE,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    max: 3
  };

  if (sslMode === 'require') {
    config.ssl = {
      rejectUnauthorized: false
    };
  }

  return config;
}

export class WeblessAccountRepository {
  constructor(pool = new Pool(databaseConfigFromEnv())) {
    this.pool = pool;
  }

  async upsertGoogleAccount(profile) {
    const result = await this.pool.query(
      `
        insert into accounts (google_id, email, name)
        values ($1, $2, $3)
        on conflict (google_id)
        do update set email = excluded.email, name = excluded.name
        returning id, google_id, email, name
      `,
      [profile.sub, profile.email, profile.name]
    );

    return result.rows[0];
  }

  async listSitesForAccount(accountId) {
    const result = await this.pool.query(
      `
        select id, slug, name, domain, status, site_status
        from sites
        where account_id = $1
        order by id asc
      `,
      [accountId]
    );

    return result.rows.map((site) => ({
      id: site.id,
      slug: site.slug,
      name: site.name,
      domain: site.domain,
      status: site.status,
      site_status: site.site_status
    }));
  }
}
