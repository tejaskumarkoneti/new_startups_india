const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { db, initDatabase } = require('./db');

function importData(customFilePath = null) {
  initDatabase();

  const candidatePaths = [
    customFilePath,
    path.join(__dirname, '..', 'IT_Activity_Code_62_Companies_with_Websites.xlsx'),
    path.join(__dirname, 'IT_Activity_Code_62_Companies_with_Websites.xlsx'),
    path.join(process.cwd(), 'IT_Activity_Code_62_Companies_with_Websites.xlsx')
  ].filter(Boolean);

  let targetPath = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      targetPath = p;
      break;
    }
  }

  if (!targetPath) {
    console.error('❌ Excel file "IT_Activity_Code_62_Companies_with_Websites.xlsx" not found in search paths.');
    return { success: false, count: 0, error: 'File not found' };
  }

  console.log(`📄 Reading data from: ${targetPath}`);
  const workbook = xlsx.readFile(targetPath);
  const sheetName = workbook.SheetNames[0]; // 'Companies'
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  console.log(`📊 Found ${rows.length} rows to process.`);

  const insertStmt = db.prepare(`
    INSERT INTO companies (
      cin,
      company_name,
      date_of_registration,
      website_url,
      guessed_domain,
      status,
      notes_evidence,
      checked_on,
      updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
    )
    ON CONFLICT(cin) DO UPDATE SET
      company_name = excluded.company_name,
      date_of_registration = excluded.date_of_registration,
      website_url = excluded.website_url,
      guessed_domain = excluded.guessed_domain,
      status = excluded.status,
      notes_evidence = excluded.notes_evidence,
      checked_on = excluded.checked_on,
      updated_at = CURRENT_TIMESTAMP
  `);

  db.exec('BEGIN TRANSACTION;');
  let inserted = 0;

  try {
    for (const row of rows) {
      const cin = String(row['CIN'] || '').trim();
      const companyName = String(row['Company Name'] || '').trim();

      // Skip summary or batch divider rows if any lack CIN or valid company name
      if (!cin || !companyName) continue;

      const dateOfReg = String(row['Date Of Registration'] || '').trim();
      const websiteUrl = String(row['Website URL'] || '').trim();
      const guessedDomain = String(row['Guessed Domain'] || '').trim();
      const status = String(row['Status'] || 'UNCERTAIN').trim().toUpperCase();
      const notesEvidence = String(row['Notes / Evidence'] || '').trim();
      const checkedOn = String(row['Checked_On'] || '').trim();

      insertStmt.run(
        cin,
        companyName,
        dateOfReg,
        websiteUrl,
        guessedDomain,
        status,
        notesEvidence,
        checkedOn
      );
      inserted++;
    }
    db.exec('COMMIT;');
    console.log(`✅ Successfully seeded/updated ${inserted} company records.`);
    return { success: true, count: inserted };
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('❌ Ingestion failed, rolled back transaction:', err);
    throw err;
  }
}

if (require.main === module) {
  importData();
}

module.exports = { importData };
