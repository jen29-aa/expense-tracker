# SpendWise — Personal Finance Dashboard

A single-page web app to track personal expenses — add, edit, delete, filter, and view monthly summaries. Runs locally with Python + SQLite.

---

## Features

1. **Add an expense** with these fields:
   - **Title** — short text (e.g., "Coffee at Starbucks"), max 50 chars
   - **Amount** — positive number in ₹, up to 2 decimal places, capped at ₹1,00,00,000
   - **Category** — one of: Food, Transport, Shopping, Bills, Entertainment, Other
   - **Date** — defaults to today; rejects dates before 2000 or more than 1 year in the future
   - **Note** — optional, max 1000 chars

2. **View a list of all expenses**, sorted by date (most recent first), showing all fields

3. **Edit or delete** any expense — edit populates the form, delete shows confirmation with the expense title

4. **Monthly summary** — total spent + breakdown by category with percentages; navigate between months

5. **Filter** by category, date range (from / to), and title (partial text match) — all combinable

6. **Spending Breakdown Chart** — dynamic Chart.js doughnut chart that automatically updates based on active filters and changes

7. **Custom UI customization (Light/Dark Mode)** — interactive persistent theme toggle saved in local storage with adaptive Chart.js coloring

---

## Tech Stack

| Layer    | Choice              | Reason                            |
|----------|---------------------|-----------------------------------|
| Backend  | Python + Flask      | Fast to write, minimal boilerplate |
| Database | SQLite              | Zero setup, file-based, sufficient for single-user local use |
| Frontend | HTML + Vanilla CSS + Vanilla JS | No build step, zero framework overhead |

**Why SQLite?**  
No server process needed. The DB is a single file (`instance/database.db`). For a personal local tracker this is ideal — simple backup, simple reset. Tradeoff: not suitable for concurrent multi-user writes, but that's explicitly out of scope.

---

## Setup & Run

```bash
# 1. Clone / unzip the project
cd expense-tracker

# 2. Create and activate virtual environment
python -m venv venv

# macOS / Linux
source venv/bin/activate

# Windows
venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the app
python app.py
```

Open browser at **http://127.0.0.1:5000**

---

## Project Structure

```
expense-tracker/
├── app.py            # Flask app + all API routes + validation
├── models.py         # SQLAlchemy Expense model
├── database.py       # db instance (avoids circular imports)
├── requirements.txt
├── README.md
├── templates/
│   ├── base.html     # Layout shell (header, fonts, scripts)
│   └── index.html    # Single-page dashboard
├── static/
│   ├── style.css     # Full custom dark theme (no Bootstrap)
│   └── app.js        # All frontend logic + validation
└── instance/
    └── database.db   # Auto-created on first run
```

---

## API Endpoints

| Method | Endpoint                    | Description              |
|--------|-----------------------------|--------------------------| 
| GET    | `/api/expenses`             | List expenses (filtered) |
| POST   | `/api/expenses`             | Create expense           |
| GET    | `/api/expenses/<id>`        | Get single expense       |
| PUT    | `/api/expenses/<id>`        | Update expense           |
| DELETE | `/api/expenses/<id>`        | Delete expense           |
| GET    | `/api/summary/monthly`      | Monthly aggregation      |

Filter params for GET `/api/expenses`: `category`, `from_date`, `to_date`, `search`

---

## Edge Cases Handled

### Input Validation (both frontend and backend)

| Edge Case | How It's Handled |
|-----------|-----------------|
| Empty title | Required field error, auto-focuses the field |
| Title > 50 chars | Maxlength validation on frontend; live character counter shifts to red alert; server-side limit of 50 chars |
| Amount = 0 or negative | "Enter a positive number" error |
| Amount > ₹1,0,00,000 | Rejected — sensible cap for personal tracker |
| Amount with > 2 decimal places | Frontend validates inline, server rejects - "at most 2 decimal places" |
| Amount as non-numeric string | "Must be a valid number" |
| Missing category | "Select a category" — invalid categories rejected server-side |
| Invalid category value (API tampering) | Server validates against whitelist |
| Date before year 2000 | Frontend validates inline, server rejects - "cannot be before 2000-01-01" |
| Date > 1 year in future | Frontend validates inline, server rejects - catches typos like "2036" instead of "2026" |
| Date in wrong format | "Must be in YYYY-MM-DD format" |
| Note > 1000 chars | Rejected with message; server truncates as safety net |
| Empty JSON body | 400 "Invalid JSON body" |

### State & Concurrency

| Edge Case | How It's Handled |
|-----------|-----------------|
| Edit a deleted expense (stale UI) | 404 → toast "This expense no longer exists", list auto-refreshes |
| Delete a deleted expense (double-click) | 404 → "Already deleted", list refreshes |
| Delete the expense you're currently editing | Edit form auto-cancels, list refreshes |
| Double-submit form (rapid clicks) | `isSubmitting` flag + button disabled during request |
| Unsaved edits/new form + page close | `beforeunload` warning triggers in both add & edit modes if form elements contain content |
| Network failure during any operation | Specific error toast, button re-enabled |
| Server returns non-JSON (500 page) | Caught by try/catch on `res.json()` |

### Filters

| Edge Case | How It's Handled |
|-----------|-----------------|
| from_date > to_date | Inline error, query not sent |
| Search with SQL wildcards (`%`, `_`) | Escaped server-side to prevent unintended matches |
| No results from filter vs no data at all | Different empty state messages ("No expenses match your filters" vs "No expenses yet") |
| Invalid date format in URL params | 400 error with specific message |

### Display

| Edge Case | How It's Handled |
|-----------|-----------------|
| Very long title in table | CSS `text-overflow: ellipsis` with `title` attribute for hover |
| Very long note in table | Same truncation approach |
| Empty note | Renders "—" in muted color instead of blank cell |
| Today's date | Renders as "Today" instead of date string |
| Yesterday's date | Renders as "Yesterday" |
| Amount formatting | Indian locale `en-IN` with ₹ prefix |
| Timezone-off-by-one in date default | Uses local date parts instead of `toISOString()` (which uses UTC) |

### API Robustness

| Edge Case | How It's Handled |
|-----------|-----------------|
| `GET /api/expenses/99999` | 404 JSON response |
| `DELETE /api/expenses/99999` | 404 JSON response |
| `PUT /api/expenses/99999` | 404 JSON response |
| Invalid month in summary (`?month=13`) | 400 "Month must be between 1 and 12" |
| Invalid year in summary | 400 "Year must be between 2000 and 2100" |
| Method not allowed | Custom 405 handler returns JSON |
| Unexpected 500 | Global handler, never leaks stack trace |

---

## UX Decisions

- **Auto-focus title on load** — user can start typing immediately without clicking
- **Auto-focus first invalid field** — after validation fails, cursor goes to the first problem
- **Inline error clearing** — typing in a field removes its error immediately (no waiting for re-submit)
- **Auto-refocus title after add** — enables rapid batch entry of expenses
- **Escape key** — closes delete modal or cancels edit mode
- **Delete modal shows expense title** — user knows exactly what they're deleting
- **Filters auto-apply** — category and date changes apply immediately; search debounces at 350ms
- **Today / Yesterday** relative dates — easier to scan than raw dates
- **"No filter match" vs "No data"** — different empty states so user understands what happened
- **Submit button shows loading state** — "Adding..." / "Saving..." with disabled cursor
- **Edit mode visual cue** — form card border highlights during editing

---

## What Was Implemented

- Full CRUD with dual-layer validation (frontend + backend)
- Interactive Chart.js doughnut chart for visual spending breakdown (adjusts styles dynamically based on light/dark mode)
- Interactive persistent Light/Dark Theme Toggle (saves choice via `localStorage`)
- Live Title character counter (displays green/orange/red visual indicators)
- Inline decimal places validation and date range bounds validation on the frontend
- Decoupled Header Total tracker (auto-updates dynamically on any action without getting affected by monthly summary month choices)
- Title input padding fix preventing text overlapping behind the character counter
- Monthly summary via SQL `GROUP BY` / `SUM` — aggregation happens in the database, not in JS
- All five filters working together (category, from_date, to_date, search — all combinable)
- Comprehensive edge-case handling (see table above)
- XSS-safe rendering (`escHtml` on all user content, `escAttr` for HTML attributes)
- Custom modal confirmation for delete (no Bootstrap dependency, truncates long titles to 40 characters)
- Month navigation in summary (previous / next month)
- ARIA labels on action buttons for accessibility

**Skipped (by spec):**
- Authentication / multi-user
- Automated tests
- Deployment config
- Multi-currency support

---

## Known Limitations

- SQLite has no concurrent write safety — fine for single user
- No pagination — all expenses render at once (acceptable for personal tracker)
- No data export (CSV/PDF)

---

## Future Improvements

- Export to CSV
- Recurring expense templates
- Custom category creator/manager

