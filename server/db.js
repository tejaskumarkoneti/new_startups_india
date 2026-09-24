const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = Boolean(DATABASE_URL);

let pool = null;
let sqliteDb = null;

if (isPostgres) {
  console.log('🔌 Cloud PostgreSQL detected via DATABASE_URL');
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  console.log('📁 Using local SQLite database (companies.db)');
  const dbPath = path.join(__dirname, 'companies.db');
  sqliteDb = new DatabaseSync(dbPath);
}

// Convert SQLite '?' placeholders to PostgreSQL '$1, $2, ...'
function convertPlaceholders(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

async function queryAll(sql, params = []) {
  if (isPostgres) {
    const pgSql = convertPlaceholders(sql);
    const result = await pool.query(pgSql, params);
    return result.rows;
  } else {
    return sqliteDb.prepare(sql).all(...params);
  }
}

async function queryGet(sql, params = []) {
  if (isPostgres) {
    const pgSql = convertPlaceholders(sql);
    const result = await pool.query(pgSql, params);
    return result.rows[0] || null;
  } else {
    return sqliteDb.prepare(sql).get(...params) || null;
  }
}

async function execute(sql, params = []) {
  if (isPostgres) {
    const pgSql = convertPlaceholders(sql);
    return await pool.query(pgSql, params);
  } else {
    return sqliteDb.prepare(sql).run(...params);
  }
}

async function initDatabase() {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS companies (
      cin VARCHAR(64) PRIMARY KEY,
      company_name TEXT NOT NULL,
      date_of_registration TEXT,
      website_url TEXT,
      guessed_domain TEXT,
      status VARCHAR(64) NOT NULL,
      notes_evidence TEXT,
      checked_on TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
    CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);
    CREATE INDEX IF NOT EXISTS idx_companies_reg_date ON companies(date_of_registration);
  `;

  if (isPostgres) {
    await pool.query(schemaSql);
  } else {
    sqliteDb.exec(schemaSql);
  }
}

module.exports = {
  isPostgres,
  pool,
  sqliteDb,
  queryAll,
  queryGet,
  execute,
  initDatabase
};
