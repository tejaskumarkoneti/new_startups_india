const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { isPostgres, initDatabase, queryAll, queryGet, execute } = require('./db');
const { importData } = require('./import-data');

const app = express();
const PORT = process.env.PORT || 5000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30 MB max
});

app.use(cors());
app.use(express.json());

// Boot bootstrap: initialize schema and auto-seed if database is empty
async function bootstrap() {
  try {
    await initDatabase();
    const countRow = await queryGet('SELECT COUNT(*) as total FROM companies');
    const total = countRow ? parseInt(countRow.total || 0) : 0;
    
    if (total === 0) {
      console.log('Database empty. Running initial import from Excel...');
      await importData();
    } else {
      console.log(`📊 Database loaded with ${total} companies (${isPostgres ? 'PostgreSQL' : 'SQLite'}).`);
    }
  } catch (err) {
    console.error('Error during database bootstrap:', err);
  }
}

bootstrap();

// ----------------------------------------------------
// 1. GET /api/companies - Paginated, filtered, sorted
// ----------------------------------------------------
app.get('/api/companies', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const statusFilter = (req.query.status || '').trim();
    const hasWebsite = (req.query.hasWebsite || '').trim();
    const sortBy = ['company_name', 'cin', 'date_of_registration', 'status', 'checked_on'].includes(req.query.sortBy)
      ? req.query.sortBy
      : 'company_name';
    const order = (req.query.order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(cin LIKE ? OR company_name LIKE ? OR notes_evidence LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    if (statusFilter && statusFilter !== 'ALL') {
      const statuses = statusFilter.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (statuses.length > 0) {
        const placeholders = statuses.map(() => '?').join(',');
        conditions.push(`status IN (${placeholders})`);
        params.push(...statuses);
      }
    }

    if (hasWebsite === 'true') {
      conditions.push("(website_url IS NOT NULL AND TRIM(website_url) != '')");
    } else if (hasWebsite === 'false') {
      conditions.push("(website_url IS NULL OR TRIM(website_url) = '')");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching records
    const countSql = `SELECT COUNT(*) as total FROM companies ${whereClause}`;
    const countResult = await queryGet(countSql, params);
    const totalRecords = countResult ? parseInt(countResult.total) : 0;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    // Fetch paginated data
    const dataSql = `
      SELECT 
        cin,
        company_name,
        date_of_registration,
        website_url,
        guessed_domain,
        status,
        notes_evidence,
        checked_on,
        updated_at
      FROM companies
      ${whereClause}
      ORDER BY ${sortBy} ${order}
      LIMIT ? OFFSET ?
    `;

    const records = await queryAll(dataSql, [...params, limit, offset]);

    res.json({
      success: true,
      data: records,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages
      }
    });
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 2. GET /api/metrics - Status breakdown and statistics
// ----------------------------------------------------
app.get('/api/metrics', async (req, res) => {
  try {
    const totalRow = await queryGet('SELECT COUNT(*) as total FROM companies');
    const total = totalRow ? parseInt(totalRow.total) : 0;

    const statusRows = await queryAll(`
      SELECT status, COUNT(*) as count 
      FROM companies 
      GROUP BY status
    `);

    const withWebsiteRow = await queryGet(`
      SELECT COUNT(*) as count 
      FROM companies 
      WHERE website_url IS NOT NULL AND TRIM(website_url) != ''
    `);
    const withWebsite = withWebsiteRow ? parseInt(withWebsiteRow.count) : 0;

    const statusCounts = {
      CONFIRMED: 0,
      LIKELY: 0,
      UNCERTAIN: 0,
      NEEDS_MANUAL_CHECK: 0,
      NOT_FOUND: 0
    };

    statusRows.forEach(r => {
      const st = r.status.toUpperCase();
      if (statusCounts[st] !== undefined) {
        statusCounts[st] = parseInt(r.count);
      }
    });

    res.json({
      success: true,
      metrics: {
        total,
        statusCounts,
        withWebsite,
        verifiedCount: (statusCounts.CONFIRMED + statusCounts.LIKELY),
        completionRate: total > 0 ? ((statusCounts.CONFIRMED + statusCounts.LIKELY + statusCounts.NOT_FOUND) / total * 100).toFixed(1) : 0
      }
    });
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 3. GET /api/companies/:cin - Get single company record
// ----------------------------------------------------
app.get('/api/companies/:cin', async (req, res) => {
  try {
    const cin = req.params.cin;
    const record = await queryGet('SELECT * FROM companies WHERE cin = ?', [cin]);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Passcode Security (Configurable via environment variable ADMIN_SECRET)
const ADMIN_SECRET = (process.env.ADMIN_SECRET || 'admin123').trim();

function requireAdmin(req, res, next) {
  const providedKey = (
    req.headers['x-admin-key'] ||
    req.headers['x-admin-secret'] ||
    req.body?.adminKey ||
    req.query?.adminKey ||
    ''
  ).trim();

  if (!providedKey || providedKey !== ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing Admin Passcode'
    });
  }
  next();
}

// ----------------------------------------------------
// 4. PATCH /api/companies/:cin - Update record (Admin only)
// ----------------------------------------------------
app.patch('/api/companies/:cin', requireAdmin, async (req, res) => {
  try {
    const cin = req.params.cin;
    const { status, website_url, guessed_domain, notes_evidence } = req.body;

    const existing = await queryGet('SELECT * FROM companies WHERE cin = ?', [cin]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const updatedStatus = status ? status.toUpperCase() : existing.status;
    const updatedUrl = website_url !== undefined ? website_url : existing.website_url;
    const updatedDomain = guessed_domain !== undefined ? guessed_domain : existing.guessed_domain;
    const updatedNotes = notes_evidence !== undefined ? notes_evidence : existing.notes_evidence;

    await execute(`
      UPDATE companies 
      SET 
        status = ?,
        website_url = ?,
        guessed_domain = ?,
        notes_evidence = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE cin = ?
    `, [updatedStatus, updatedUrl, updatedDomain, updatedNotes, cin]);

    const updatedRecord = await queryGet('SELECT * FROM companies WHERE cin = ?', [cin]);
    res.json({ success: true, message: 'Updated successfully', data: updatedRecord });
  } catch (err) {
    console.error('Error updating company:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 5. POST /api/import - Re-sync from local Excel file (Admin only)
// ----------------------------------------------------
app.post('/api/import', requireAdmin, async (req, res) => {
  try {
    const result = await importData();
    res.json({
      success: true,
      message: `Processed ${result.total} records (${result.newRecords} new, ${result.updatedRecords} updated)`,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 6. POST /api/upload-excel - Ingest new monthly Excel (Admin only)
// ----------------------------------------------------
app.post('/api/upload-excel', upload.single('excelFile'), requireAdmin, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No Excel file provided' });
    }
    console.log(`📥 Received monthly upload: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);
    const result = await importData(req.file.buffer);
    res.json({
      success: true,
      message: `Successfully processed ${result.total} records (${result.newRecords} new, ${result.updatedRecords} updated)`,
      ...result
    });
  } catch (err) {
    console.error('Upload processing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend static build or public folder if present
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Serve frontend fallback for SPA
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Company Database & API Server running on port ${PORT}`);
});
