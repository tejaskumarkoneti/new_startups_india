# Company Registry Fullstack Web Application

A fullstack application for browsing, searching, filtering, and editing **3,024 Indian IT Company Records** (Activity Code 62) imported from `IT_Activity_Code_62_Companies_with_Websites.xlsx`.

---

## 🚀 Features

- **Database & Data Ingestion**:
  - Built on high-performance native **SQLite** (`node:sqlite`).
  - Idempotent upsert migration script (`import-data.js`) with indexation on CIN, company name, status, and registration date.
  - Automatically seeds 3,024 records from the Excel file on startup.

- **Backend REST API (`http://localhost:5000/api`)**:
  - `GET /api/companies`: Server-side pagination (`page`, `limit`), global search (`cin`, `company_name`, `notes_evidence`), multi-status filter (`CONFIRMED`, `LIKELY`, `UNCERTAIN`, `NEEDS_MANUAL_CHECK`, `NOT_FOUND`), website filter (`hasWebsite=true/false`), and sorting.
  - `GET /api/metrics`: Live aggregation of total companies, verified counts, status breakdown, and completion rate.
  - `GET /api/companies/:cin`: Fetch individual company record.
  - `PATCH /api/companies/:cin`: Inline update of website URL, verification status, and notes.
  - `POST /api/import`: Trigger on-demand re-sync from Excel.

- **Frontend Dashboard UI**:
  - Interactive status metric cards (click any card to instantly filter the table).
  - Debounced real-time search with clear button.
  - Color-coded status badges with icons.
  - Direct clickable external links for verified company websites.
  - Expandable Notes / Verification Evidence.
  - Built-in **Edit Modal** to review or modify status, website URL, and evidence notes.
  - Full pagination controls with items-per-page selector (10, 20, 50, 100).

---

## 📁 Project Structure

```text
d:\MCA 62\New folder\
├── IT_Activity_Code_62_Companies_with_Websites.xlsx   # Source dataset (3,024 companies)
├── server\
│   ├── db.js                                          # SQLite schema and connection
│   ├── import-data.js                                 # Excel to SQLite migration script
│   ├── index.js                                       # Express REST API & static server
│   ├── companies.db                                   # SQLite database (auto-generated)
│   ├── package.json                                   # Server scripts & dependencies
│   └── public\
│       └── index.html                                 # Dashboard UI (Tailwind + Lucide)
└── README.md
```

---

## 🛠️ Quick Start

### 1. Start the Server
Open PowerShell in `d:\MCA 62\New folder\server`:
```powershell
npm start
```

### 2. View the Dashboard
Open your browser and navigate to:
```
http://localhost:5000
```

### 3. Re-run Ingestion (Optional)
If you update the Excel spreadsheet:
```powershell
npm run import
```
Or click the **"Re-sync Excel"** button directly inside the web UI header!
