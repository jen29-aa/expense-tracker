from flask import Flask, request, jsonify, render_template
from datetime import datetime, date
from sqlalchemy import func, extract
import os

from database import db
from models import Expense

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///database.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

def seed_database_records():
    samples = [
        # March 2026
        {"title": "Apartment Rent", "amount": 15000.00, "category": "Bills", "date": "2026-03-01", "note": "Monthly house rent"},
        {"title": "Grocery Shopping", "amount": 3450.50, "category": "Food", "date": "2026-03-05", "note": "Reliance Smart Bazar"},
        {"title": "Netflix Premium", "amount": 649.00, "category": "Entertainment", "date": "2026-03-15", "note": "Monthly streaming subscription"},
        {"title": "Petrol Refill", "amount": 1200.00, "category": "Transport", "date": "2026-03-22", "note": "Full tank for commuter bike"},
        {"title": "Nike Pegasus 40", "amount": 7999.00, "category": "Shopping", "date": "2026-03-28", "note": "Bought from official store"},
        
        # April 2026
        {"title": "Apartment Rent", "amount": 15000.00, "category": "Bills", "date": "2026-04-01", "note": "Monthly house rent"},
        {"title": "Electric Bill", "amount": 2840.00, "category": "Bills", "date": "2026-04-10", "note": "Summer consumption"},
        {"title": "Uber Hails", "amount": 650.00, "category": "Transport", "date": "2026-04-18", "note": "Office travel during rain"},
        {"title": "Dining Out (Pizza)", "amount": 1850.00, "category": "Food", "date": "2026-04-22", "note": "Dinner with family"},
        {"title": "IMAX Movie Ticket", "amount": 950.00, "category": "Entertainment", "date": "2026-04-28", "note": "Avatar re-run"},
        
        # May 2026
        {"title": "Apartment Rent", "amount": 15000.00, "category": "Bills", "date": "2026-05-01", "note": "Monthly house rent"},
        {"title": "Organic Vegetables", "amount": 1420.00, "category": "Food", "date": "2026-05-06", "note": "Weekly farmers market"},
        {"title": "Broadband Internet", "amount": 999.00, "category": "Bills", "date": "2026-05-12", "note": "Airtel Xstream Fiber"},
        {"title": "Train ticket to Delhi", "amount": 2450.00, "category": "Transport", "date": "2026-05-20", "note": "Shatabdi express"},
        {"title": "Novel Books Purchase", "amount": 1150.00, "category": "Shopping", "date": "2026-05-25", "note": "Fiction & self-help books"},
        
        # June 2026
        {"title": "Apartment Rent", "amount": 15000.00, "category": "Bills", "date": "2026-06-01", "note": "Monthly house rent"},
        {"title": "Starbucks Coffee", "amount": 350.78, "category": "Food", "date": "2026-06-02", "note": ""},
        {"title": "PVR Movie Tickets", "amount": 950.00, "category": "Entertainment", "date": "2026-06-03", "note": "Good Movie"},
        {"title": "Grocery Shopping", "amount": 4200.00, "category": "Food", "date": "2026-06-05", "note": ""},
        {"title": "Water Utility Bill", "amount": 480.00, "category": "Bills", "date": "2026-06-12", "note": ""},
        
        # July 2026
        {"title": "Apartment Rent", "amount": 15000.00, "category": "Bills", "date": "2026-07-01", "note": "Monthly house rent"},
        {"title": "Ice Cream Parlour", "amount": 350.00, "category": "Food", "date": "2026-07-04", "note": "Summer special dessert"},
        {"title": "Gas Utility Bill", "amount": 1100.00, "category": "Bills", "date": "2026-07-08", "note": "Quarterly billing"},
        {"title": "Mechanical Keyboard", "amount": 4500.00, "category": "Shopping", "date": "2026-07-15", "note": "Keychron V1"},
        {"title": "Concert Tickets", "amount": 3200.00, "category": "Entertainment", "date": "2026-07-22", "note": "Local indie band festival"},
    ]
    
    seeded_count = 0
    for s in samples:
        existing = Expense.query.filter_by(
            title=s["title"],
            amount=s["amount"],
            date=datetime.strptime(s["date"], "%Y-%m-%d").date()
        ).first()
        
        if not existing:
            expense = Expense(
                title=s["title"],
                amount=s["amount"],
                category=s["category"],
                date=datetime.strptime(s["date"], "%Y-%m-%d").date(),
                note=s["note"] or None
            )
            db.session.add(expense)
            seeded_count += 1
            
    db.session.commit()
    return seeded_count

with app.app_context():
    db.create_all()
    if Expense.query.count() == 0:
        seed_database_records()


# ─── Constants ─────────────────────────────────────────────────────────────────

MAX_TITLE_LEN = 50
MAX_NOTE_LEN = 1000
MAX_AMOUNT = 10_000_000  # ₹1 crore — sensible upper bound for personal tracker
MIN_DATE = date(2000, 1, 1)


# ─── Validation ────────────────────────────────────────────────────────────────

def validate_expense_data(data):
    """Return list of error strings, empty if valid."""
    errors = []

    # Title
    title = (data.get("title") or "").strip()
    if not title:
        errors.append("Title is required.")
    elif len(title) > MAX_TITLE_LEN:
        errors.append(f"Title must be {MAX_TITLE_LEN} characters or fewer (got {len(title)}).")

    # Amount
    amount_raw = data.get("amount")
    if amount_raw is None or str(amount_raw).strip() == "":
        errors.append("Amount is required.")
    else:
        try:
            amount = float(amount_raw)
            if amount <= 0:
                errors.append("Amount must be a positive number.")
            elif amount > MAX_AMOUNT:
                errors.append(f"Amount cannot exceed ₹{MAX_AMOUNT:,.0f}.")
            # Check for absurd precision (more than 2 decimal places)
            elif round(amount, 2) != amount:
                errors.append("Amount can have at most 2 decimal places.")
        except (ValueError, TypeError):
            errors.append("Amount must be a valid number.")

    # Category
    category = data.get("category", "").strip()
    if category not in Expense.VALID_CATEGORIES:
        errors.append(f"Category must be one of: {', '.join(Expense.VALID_CATEGORIES)}.")

    # Date
    date_str = data.get("date", "").strip()
    if not date_str:
        errors.append("Date is required.")
    else:
        try:
            parsed = datetime.strptime(date_str, "%Y-%m-%d").date()
            # Reject unreasonable dates
            if parsed < MIN_DATE:
                errors.append(f"Date cannot be before {MIN_DATE.isoformat()}.")
            elif parsed > date.today().replace(year=date.today().year + 1):
                errors.append("Date cannot be more than 1 year in the future.")
        except ValueError:
            errors.append("Date must be in YYYY-MM-DD format.")

    # Note (optional but bounded)
    note = (data.get("note") or "").strip()
    if len(note) > MAX_NOTE_LEN:
        errors.append(f"Note must be {MAX_NOTE_LEN} characters or fewer.")

    return errors


# ─── Error Handlers ────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Resource not found."}), 404
    return render_template("index.html", categories=Expense.VALID_CATEGORIES), 200

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error."}), 500


# ─── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", categories=Expense.VALID_CATEGORIES)


@app.route("/api/expenses", methods=["GET"])
def get_expenses():
    """Return filtered expenses sorted by date desc."""
    query = Expense.query

    category = request.args.get("category", "").strip()
    if category and category in Expense.VALID_CATEGORIES:
        query = query.filter(Expense.category == category)

    # Sanitize search: escape SQL LIKE wildcards in user input
    search = request.args.get("search", "").strip()
    if search:
        safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(Expense.title.ilike(f"%{safe_search}%", escape="\\"))

    from_date = request.args.get("from_date", "").strip()
    to_date = request.args.get("to_date", "").strip()

    fd = None
    td = None

    if from_date:
        try:
            fd = datetime.strptime(from_date, "%Y-%m-%d").date()
            query = query.filter(Expense.date >= fd)
        except ValueError:
            return jsonify({"error": "Invalid from_date format. Use YYYY-MM-DD."}), 400

    if to_date:
        try:
            td = datetime.strptime(to_date, "%Y-%m-%d").date()
            query = query.filter(Expense.date <= td)
        except ValueError:
            return jsonify({"error": "Invalid to_date format. Use YYYY-MM-DD."}), 400

    if fd and td and fd > td:
        return jsonify({"error": "from_date cannot be after to_date."}), 400

    expenses = query.order_by(Expense.date.desc(), Expense.created_at.desc()).all()
    return jsonify([e.to_dict() for e in expenses])


@app.route("/api/expenses", methods=["POST"])
def create_expense():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON body."}), 400

    errors = validate_expense_data(data)
    if errors:
        return jsonify({"errors": errors}), 422

    expense = Expense(
        title=data["title"].strip()[:MAX_TITLE_LEN],
        amount=round(float(data["amount"]), 2),
        category=data["category"].strip(),
        date=datetime.strptime(data["date"].strip(), "%Y-%m-%d").date(),
        note=(data.get("note") or "").strip()[:MAX_NOTE_LEN] or None,
    )
    db.session.add(expense)
    db.session.commit()
    return jsonify(expense.to_dict()), 201


@app.route("/api/expenses/<int:expense_id>", methods=["GET"])
def get_expense(expense_id):
    expense = Expense.query.get(expense_id)
    if not expense:
        return jsonify({"error": "Expense not found."}), 404
    return jsonify(expense.to_dict())


@app.route("/api/expenses/<int:expense_id>", methods=["PUT"])
def update_expense(expense_id):
    expense = Expense.query.get(expense_id)
    if not expense:
        return jsonify({"error": "Expense not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON body."}), 400

    errors = validate_expense_data(data)
    if errors:
        return jsonify({"errors": errors}), 422

    expense.title = data["title"].strip()[:MAX_TITLE_LEN]
    expense.amount = round(float(data["amount"]), 2)
    expense.category = data["category"].strip()
    expense.date = datetime.strptime(data["date"].strip(), "%Y-%m-%d").date()
    expense.note = (data.get("note") or "").strip()[:MAX_NOTE_LEN] or None
    expense.updated_at = datetime.utcnow()

    db.session.commit()
    return jsonify(expense.to_dict())


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
def delete_expense(expense_id):
    expense = Expense.query.get(expense_id)
    if not expense:
        return jsonify({"error": "Expense not found."}), 404

    db.session.delete(expense)
    db.session.commit()
    return jsonify({"message": "Expense deleted."})


@app.route("/api/summary/monthly", methods=["GET"])
def monthly_summary():
    """Aggregate current month's expenses by category via SQL."""
    today = date.today()
    year = request.args.get("year", today.year, type=int)
    month = request.args.get("month", today.month, type=int)

    # Clamp to valid ranges
    if month < 1 or month > 12:
        return jsonify({"error": "Month must be between 1 and 12."}), 400
    if year < 2000 or year > 2100:
        return jsonify({"error": "Year must be between 2000 and 2100."}), 400

    total_result = db.session.query(func.sum(Expense.amount)).filter(
        extract("year", Expense.date) == year,
        extract("month", Expense.date) == month,
    ).scalar()
    total = round(total_result or 0, 2)

    breakdown_rows = (
        db.session.query(Expense.category, func.sum(Expense.amount).label("total"))
        .filter(
            extract("year", Expense.date) == year,
            extract("month", Expense.date) == month,
        )
        .group_by(Expense.category)
        .all()
    )
    breakdown = {row.category: round(row.total, 2) for row in breakdown_rows}

    return jsonify({"year": year, "month": month, "total": total, "breakdown": breakdown})


@app.route("/api/expenses/seed", methods=["POST"])
def seed_expenses():
    seeded_count = seed_database_records()
    return jsonify({"message": f"Successfully seeded {seeded_count} sample expenses."}), 201


if __name__ == "__main__":
    app.run(debug=True, port=5000)
