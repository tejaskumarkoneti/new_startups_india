const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'companies.db');
const db = new DatabaseSync(dbPath);

// Initialize schema
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      cin TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      date_of_registration TEXT,
      website_url TEXT,
      guessed_domain TEXT,
      status TEXT NOT NULL,
      notes_evidence TEXT,
      checked_on TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
    CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);
    CREATE INDEX IF NOT EXISTS idx_companies_reg_date ON companies(date_of_registration);
  `);
}

module.exports = {
  db,
  initDatabase
};
