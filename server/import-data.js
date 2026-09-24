const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { isPostgres, pool, sqliteDb, initDatabase, queryAll } = require('./db');

async function importData(customInput = null) {
  await initDatabase();

  let workbook = null;
  let sourceDescription = '';

  if (Buffer.isBuffer(customInput)) {
    sourceDescription = 'Uploaded File Buffer';
    workbook = xlsx.read(customInput, { type: 'buffer' });
  } else {
    const candidatePaths = [
      customInput,
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
      console.error('❌ Excel file not found.');
      return { success: false, total: 0, newRecords: 0, updatedRecords: 0, error: 'File not found' };
    }

    sourceDescription = targetPath;
    console.log(`📄 Reading data from: ${targetPath}`);
    workbook = xlsx.readFile(targetPath);
  }

  const sheetName = workbook.SheetNames.includes('Companies') ? 'Companies' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  console.log(`📊 Processing ${rows.length} rows from ${sourceDescription}...`);

  // Query existing CINs to count new vs updated
  const existingRows = await queryAll('SELECT cin FROM companies');
  const existingCins = new Set(existingRows.map(r => r.cin));

  let newCount = 0;
  let updatedCount = 0;

  if (isPostgres) {
    // PostgreSQL Transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pgUpsertSql = `
        INSERT INTO companies (
          cin, company_name, date_of_registration, website_url, guessed_domain, status, notes_evidence, checked_on, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP
        )
        ON CONFLICT(cin) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          date_of_registration = EXCLUDED.date_of_registration,
          website_url = CASE WHEN EXCLUDED.website_url != '' THEN EXCLUDED.website_url ELSE companies.website_url END,
          guessed_domain = CASE WHEN EXCLUDED.guessed_domain != '' THEN EXCLUDED.guessed_domain ELSE companies.guessed_domain END,
          status = CASE WHEN EXCLUDED.status != '' THEN EXCLUDED.status ELSE companies.status END,
          notes_evidence = CASE WHEN EXCLUDED.notes_evidence != '' THEN EXCLUDED.notes_evidence ELSE companies.notes_evidence END,
          checked_on = EXCLUDED.checked_on,
          updated_at = CURRENT_TIMESTAMP;
      `;

      for (const row of rows) {
        const cin = String(row['CIN'] || row['cin'] || '').trim();
        const companyName = String(row['Company Name'] || row['company_name'] || '').trim();
        if (!cin || !companyName) continue;

        const dateOfReg = String(row['Date Of Registration'] || row['date_of_registration'] || '').trim();
        const websiteUrl = String(row['Website URL'] || row['website_url'] || '').trim();
        const guessedDomain = String(row['Guessed Domain'] || row['guessed_domain'] || '').trim();
        const rawStatus = String(row['Status'] || row['status'] || 'UNCERTAIN').trim().toUpperCase();
        const notesEvidence = String(row['Notes / Evidence'] || row['notes_evidence'] || '').trim();
        const checkedOn = String(row['Checked_On'] || row['checked_on'] || '').trim();

        if (existingCins.has(cin)) {
          updatedCount++;
        } else {
          newCount++;
          existingCins.add(cin);
        }

        await client.query(pgUpsertSql, [
          cin, companyName, dateOfReg, websiteUrl, guessedDomain, rawStatus, notesEvidence, checkedOn
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // SQLite Transaction
    const insertStmt = sqliteDb.prepare(`
      INSERT INTO companies (
        cin, company_name, date_of_registration, website_url, guessed_domain, status, notes_evidence, checked_on, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
      ON CONFLICT(cin) DO UPDATE SET
        company_name = excluded.company_name,
        date_of_registration = excluded.date_of_registration,
        website_url = CASE WHEN excluded.website_url != '' THEN excluded.website_url ELSE companies.website_url END,
        guessed_domain = CASE WHEN excluded.guessed_domain != '' THEN excluded.guessed_domain ELSE companies.guessed_domain END,
        status = CASE WHEN excluded.status != '' THEN excluded.status ELSE companies.status END,
        notes_evidence = CASE WHEN excluded.notes_evidence != '' THEN excluded.notes_evidence ELSE companies.notes_evidence END,
        checked_on = excluded.checked_on,
        updated_at = CURRENT_TIMESTAMP
    `);

    sqliteDb.exec('BEGIN TRANSACTION;');
    try {
      for (const row of rows) {
        const cin = String(row['CIN'] || row['cin'] || '').trim();
        const companyName = String(row['Company Name'] || row['company_name'] || '').trim();
        if (!cin || !companyName) continue;

        const dateOfReg = String(row['Date Of Registration'] || row['date_of_registration'] || '').trim();
        const websiteUrl = String(row['Website URL'] || row['website_url'] || '').trim();
        const guessedDomain = String(row['Guessed Domain'] || row['guessed_domain'] || '').trim();
        const rawStatus = String(row['Status'] || row['status'] || 'UNCERTAIN').trim().toUpperCase();
        const notesEvidence = String(row['Notes / Evidence'] || row['notes_evidence'] || '').trim();
        const checkedOn = String(row['Checked_On'] || row['checked_on'] || '').trim();

        if (existingCins.has(cin)) {
          updatedCount++;
        } else {
          newCount++;
          existingCins.add(cin);
        }

        insertStmt.run(
          cin, companyName, dateOfReg, websiteUrl, guessedDomain, rawStatus, notesEvidence, checkedOn
        );
      }
      sqliteDb.exec('COMMIT;');
    } catch (err) {
      sqliteDb.exec('ROLLBACK;');
      throw err;
    }
  }

  const totalProcessed = newCount + updatedCount;
  console.log(`✅ Ingestion complete: ${totalProcessed} total processed (${newCount} new, ${updatedCount} updated).`);

  return {
    success: true,
    total: totalProcessed,
    newRecords: newCount,
    updatedRecords: updatedCount
  };
}

if (require.main === module) {
  const customArg = process.argv[2] || null;
  importData(customArg)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { importData };
