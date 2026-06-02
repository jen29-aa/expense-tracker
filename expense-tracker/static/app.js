"use strict";

// ─── State ───────────────────────────────────────────────────────────────────
let pendingDeleteId = null;
let summaryYear = new Date().getFullYear();
let summaryMonth = new Date().getMonth() + 1;
let isSubmitting = false; // guard against double-submit
let hasUnsavedChanges = false; // track dirty form state
let allExpenses = []; // cached for "filtered vs total" distinction
let spendingChart = null; // Chart.js instance

// Category icons map
const CATEGORY_ICONS = {
  Food: "bi-cup-hot",
  Transport: "bi-car-front",
  Shopping: "bi-bag",
  Bills: "bi-receipt",
  Entertainment: "bi-controller",
  Other: "bi-three-dots",
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Initialize theme
  const themeBtn = document.getElementById("theme-toggle-btn");
  const themeIcon = document.getElementById("theme-toggle-icon");
  const currentTheme = localStorage.getItem("theme") || "dark";
  if (currentTheme === "light") {
    document.body.classList.add("light");
    if (themeIcon) themeIcon.className = "bi bi-moon";
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      document.body.classList.toggle("light");
      const isLight = document.body.classList.contains("light");
      localStorage.setItem("theme", isLight ? "light" : "dark");
      if (themeIcon) themeIcon.className = isLight ? "bi bi-moon" : "bi bi-sun";
      
      // Update Chart.js colors dynamically if initialized
      if (spendingChart) {
        spendingChart.options.plugins.legend.labels.color = isLight ? "#64748b" : "#9ca3b4";
        spendingChart.options.plugins.tooltip.backgroundColor = isLight ? "#ffffff" : "#242837";
        spendingChart.options.plugins.tooltip.titleColor = isLight ? "#1e293b" : "#e8eaf0";
        spendingChart.options.plugins.tooltip.bodyColor = isLight ? "#64748b" : "#9ca3b4";
        spendingChart.options.plugins.tooltip.borderColor = isLight ? "#cbd5e1" : "#2a2e3e";
        spendingChart.data.datasets[0].borderColor = isLight ? "#ffffff" : "#1a1d27";
        spendingChart.update();
      }
    });
  }

  // Default date = today
  document.getElementById("date").value = todayStr();

  // Auto-focus the title field so user can start typing immediately
  document.getElementById("title").focus();

  // Delete modal
  document.getElementById("confirm-delete-btn").addEventListener("click", () => {
    if (pendingDeleteId !== null) executeDelete(pendingDeleteId);
  });

  // Close modal on overlay click
  document.getElementById("delete-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDeleteModal();
  });

  // Form submit
  document.getElementById("expense-form").addEventListener("submit", handleFormSubmit);

  // Track dirty form state: if user types anything, set unsaved flag
  const formFields = ["title", "amount", "category", "date", "note"];
  formFields.forEach((f) => {
    document.getElementById(f).addEventListener("input", () => {
      hasUnsavedChanges = true;
    });
  });

  // Warn before leaving with unsaved changes in the form (both add and edit modes)
  window.addEventListener("beforeunload", (e) => {
    const titleVal = document.getElementById("title").value.trim();
    const amtVal = document.getElementById("amount").value.trim();
    const noteVal = document.getElementById("note").value.trim();
    const hasText = titleVal || amtVal || noteVal;
    if (hasUnsavedChanges && hasText) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Live filter on search with debounce
  let searchTimer;
  document.getElementById("filter-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadExpenses(), 350);
  });

  // Auto-apply category filter on change
  document.getElementById("filter-category").addEventListener("change", () => loadExpenses());

  // Auto-apply date filters on change
  document.getElementById("filter-from").addEventListener("change", () => {
    const from = document.getElementById("filter-from").value;
    const to = document.getElementById("filter-to").value;
    const errBox = document.getElementById("filter-error");
    if (from && to && from > to) {
      errBox.textContent = '"From" date cannot be after "To" date.';
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    loadExpenses();
  });
  document.getElementById("filter-to").addEventListener("change", () => {
    const from = document.getElementById("filter-from").value;
    const to = document.getElementById("filter-to").value;
    const errBox = document.getElementById("filter-error");
    if (from && to && from > to) {
      errBox.textContent = '"From" date cannot be after "To" date.';
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    loadExpenses();
  });

  // Header scroll effect
  window.addEventListener("scroll", () => {
    document.getElementById("app-header").classList.toggle("scrolled", window.scrollY > 10);
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Escape: close modal or cancel edit
    if (e.key === "Escape") {
      const modalVisible = !document.getElementById("delete-modal-overlay").classList.contains("hidden");
      if (modalVisible) {
        closeDeleteModal();
      } else if (document.getElementById("edit-id").value) {
        cancelEdit();
      }
    }
  });

  // Clear inline error when user starts typing in a field
  ["title", "amount", "category", "date"].forEach((f) => {
    const el = document.getElementById(f);
    el.addEventListener("input", () => {
      el.classList.remove("is-invalid");
      document.getElementById(f + "-err").textContent = "";
    });
    el.addEventListener("change", () => {
      el.classList.remove("is-invalid");
      document.getElementById(f + "-err").textContent = "";
    });
  });

  // Title character counter
  const titleEl = document.getElementById("title");
  const countEl = document.getElementById("title-count");
  titleEl.addEventListener("input", () => {
    updateCharCount(titleEl, countEl, 50);
  });

  // Load data
  loadExpenses();
  loadSummary();
  updateHeaderTotal();
  updateMonthLabel();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  // Use local date, not UTC — avoids off-by-one in timezones ahead of UTC
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmt(amount) {
  return "₹" + Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function catClass(cat) {
  return "cat-" + cat.toLowerCase();
}

function catIcon(cat) {
  return CATEGORY_ICONS[cat] || "bi-three-dots";
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // Show "Today" or "Yesterday" for recent dates — easier to scan
  if (dateStr === todayStr()) return "Today";
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  if (dateStr === yStr) return "Yesterday";

  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function hasActiveFilters() {
  return (
    document.getElementById("filter-category").value ||
    document.getElementById("filter-from").value ||
    document.getElementById("filter-to").value ||
    document.getElementById("filter-search").value.trim()
  );
}

function truncate(str, maxLen) {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "…";
}

function updateCharCount(input, counter, max) {
  const len = input.value.length;
  counter.textContent = `${len} / ${max}`;
  counter.classList.remove("near-limit", "at-limit");
  if (len >= max) {
    counter.classList.add("at-limit");
  } else if (len >= max * 0.8) {
    counter.classList.add("near-limit");
  }
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const icons = {
    success: "bi-check-circle-fill",
    danger: "bi-exclamation-circle-fill",
    warning: "bi-exclamation-triangle-fill",
  };
  const id = "toast-" + Date.now();
  const html = `
    <div id="${id}" class="toast toast-${type}" role="alert" aria-live="assertive">
      <i class="bi ${icons[type] || icons.success} toast-icon"></i>
      <span class="toast-msg">${escHtml(msg)}</span>
      <button class="toast-close" onclick="dismissToast('${id}')" aria-label="Close notification"><i class="bi bi-x"></i></button>
    </div>`;
  document.getElementById("toast-container").insertAdjacentHTML("beforeend", html);
  setTimeout(() => dismissToast(id), 4000);
}

function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("toast-exit");
  setTimeout(() => el.remove(), 300);
}

// ─── Form ─────────────────────────────────────────────────────────────────────
function clearFormErrors() {
  ["title", "amount", "category", "date"].forEach((f) => {
    document.getElementById(f).classList.remove("is-invalid");
    document.getElementById(f + "-err").textContent = "";
  });
  document.getElementById("form-errors").classList.add("hidden");
}

function showFieldError(field, msg) {
  const el = document.getElementById(field);
  el.classList.add("is-invalid");
  document.getElementById(field + "-err").textContent = msg;
  // Focus the first invalid field so user knows what to fix
  if (!document.querySelector(".form-input.is-invalid:focus")) {
    el.focus();
  }
}

function frontendValidate(data) {
  let firstError = null;

  if (!data.title.trim()) {
    showFieldError("title", "Title is required.");
    if (!firstError) firstError = "title";
  } else if (data.title.trim().length > 50) {
    showFieldError("title", "Title must be 50 characters or fewer.");
    if (!firstError) firstError = "title";
  }

  const amt = parseFloat(data.amount);
  if (!data.amount || isNaN(data.amount) || amt <= 0) {
    showFieldError("amount", "Enter a positive number.");
    if (!firstError) firstError = "amount";
  } else if (amt > 10000000) {
    showFieldError("amount", "Amount cannot exceed ₹1,00,00,000.");
    if (!firstError) firstError = "amount";
  } else {
    // Validate decimal places (max 2)
    const amountStr = String(data.amount).trim();
    const decimalPart = amountStr.split(".")[1];
    if (decimalPart && decimalPart.length > 2) {
      showFieldError("amount", "Amount can have at most 2 decimal places.");
      if (!firstError) firstError = "amount";
    }
  }

  if (!data.category) {
    showFieldError("category", "Select a category.");
    if (!firstError) firstError = "category";
  }

  if (!data.date) {
    showFieldError("date", "Date is required.");
    if (!firstError) firstError = "date";
  } else {
    // Validate date range matching backend constraints
    const dVal = new Date(data.date + "T00:00:00");
    const minD = new Date("2000-01-01T00:00:00");
    const maxD = new Date();
    maxD.setFullYear(maxD.getFullYear() + 1);
    if (dVal < minD) {
      showFieldError("date", "Date cannot be before 2000-01-01.");
      if (!firstError) firstError = "date";
    } else if (dVal > maxD) {
      showFieldError("date", "Date cannot be more than 1 year in the future.");
      if (!firstError) firstError = "date";
    }
  }

  // Focus the first errored field
  if (firstError) {
    document.getElementById(firstError).focus();
  }

  return firstError === null;
}

async function handleFormSubmit(e) {
  e.preventDefault();

  // Guard against double-submit
  if (isSubmitting) return;

  clearFormErrors();

  const editId = document.getElementById("edit-id").value;
  const data = {
    title: document.getElementById("title").value,
    amount: document.getElementById("amount").value,
    category: document.getElementById("category").value,
    date: document.getElementById("date").value,
    note: document.getElementById("note").value,
  };

  if (!frontendValidate(data)) return;

  const isEdit = editId !== "";
  const url = isEdit ? `/api/expenses/${editId}` : "/api/expenses";
  const method = isEdit ? "PUT" : "POST";

  // Lock submission
  isSubmitting = true;
  const btn = document.getElementById("submit-btn");
  const label = document.getElementById("submit-label");
  const originalLabel = label.textContent;
  btn.disabled = true;
  btn.classList.add("btn-loading");
  label.textContent = isEdit ? "Saving..." : "Adding...";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    let json;
    try {
      json = await res.json();
    } catch {
      showToast("Server returned an invalid response.", "danger");
      return;
    }

    if (!res.ok) {
      if (json.errors) {
        const box = document.getElementById("form-errors");
        box.innerHTML = json.errors.map((e) => `<div>• ${escHtml(e)}</div>`).join("");
        box.classList.remove("hidden");
      } else if (res.status === 404) {
        showToast("This expense was already deleted. Refreshing list.", "danger");
        loadExpenses();
        loadSummary();
        resetForm();
      } else {
        showToast(json.error || "Something went wrong.", "danger");
      }
      return;
    }

    showToast(isEdit ? "Expense updated!" : "Expense added!");
    hasUnsavedChanges = false;
    resetForm();
    loadExpenses();
    loadSummary();
    updateHeaderTotal();

    // After adding, refocus title so user can add another expense quickly
    if (!isEdit) {
      document.getElementById("title").focus();
    }
  } catch (err) {
    showToast("Network error — check your connection.", "danger");
  } finally {
    isSubmitting = false;
    btn.disabled = false;
    btn.classList.remove("btn-loading");
    label.textContent = originalLabel;
  }
}

function resetForm() {
  document.getElementById("expense-form").reset();
  document.getElementById("date").value = todayStr();
  document.getElementById("edit-id").value = "";
  document.getElementById("form-title").textContent = "Add Expense";
  document.getElementById("submit-label").textContent = "Add Expense";
  document.getElementById("submit-icon").className = "bi bi-plus-lg";
  document.getElementById("cancel-edit-btn").classList.add("hidden");
  hasUnsavedChanges = false;
  clearFormErrors();

  // Reset card visual cue
  document.getElementById("form-card").style.borderColor = "";
}

function populateEditForm(expense) {
  document.getElementById("edit-id").value = expense.id;
  document.getElementById("title").value = expense.title;
  document.getElementById("amount").value = expense.amount;
  document.getElementById("category").value = expense.category;
  document.getElementById("date").value = expense.date;
  document.getElementById("note").value = expense.note || "";
  document.getElementById("form-title").textContent = "Edit Expense";
  document.getElementById("submit-label").textContent = "Save Changes";
  document.getElementById("submit-icon").className = "bi bi-check-lg";
  document.getElementById("cancel-edit-btn").classList.remove("hidden");
  hasUnsavedChanges = false;
  clearFormErrors();

  // Visual cue that we're editing
  const card = document.getElementById("form-card");
  card.style.borderColor = "var(--accent)";
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  // Focus title for quick editing
  setTimeout(() => document.getElementById("title").focus(), 100);
}

function cancelEdit() {
  hasUnsavedChanges = false;
  resetForm();
  document.getElementById("title").focus();
}

async function updateHeaderTotal() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  try {
    const res = await fetch(`/api/summary/monthly?year=${y}&month=${m}`);
    if (res.ok) {
      const json = await res.json();
      const headerStat = document.getElementById("header-total");
      if (headerStat) {
        headerStat.querySelector(".header-stat-value").textContent = fmt(json.total);
      }
    }
  } catch (err) {
    console.error("Failed to update header total:", err);
  }
}

async function seedDemoData() {
  const btn = document.getElementById("seed-demo-btn");
  if (!btn) return;
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Seeding...';

  try {
    const res = await fetch("/api/expenses/seed", { method: "POST" });
    if (res.ok) {
      showToast("Demo data successfully seeded across different months!");
      loadExpenses();
      loadSummary();
      updateHeaderTotal();
    } else {
      let json;
      try { json = await res.json(); } catch { json = {}; }
      showToast(json.error || "Failed to seed demo data.", "danger");
    }
  } catch (err) {
    showToast("Network error.", "danger");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ─── Load Expenses ─────────────────────────────────────────────────────────────
function buildFilterParams() {
  const params = new URLSearchParams();
  const cat = document.getElementById("filter-category").value;
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;
  const search = document.getElementById("filter-search").value.trim();
  if (cat) params.set("category", cat);
  if (from) params.set("from_date", from);
  if (to) params.set("to_date", to);
  if (search) params.set("search", search);
  return params;
}

async function loadExpenses() {
  const params = buildFilterParams();
  try {
    const res = await fetch("/api/expenses?" + params.toString());
    if (!res.ok) {
      let json;
      try { json = await res.json(); } catch { json = {}; }
      showToast(json.error || "Failed to load expenses.", "danger");
      return;
    }
    const json = await res.json();
    renderExpenses(json);
  } catch {
    showToast("Network error loading expenses.", "danger");
  }
}

function renderExpenses(expenses) {
  const tbody = document.getElementById("expenses-tbody");
  document.getElementById("expense-count").textContent = expenses.length;

  if (expenses.length === 0) {
    // Different message depending on whether filters are active
    const filtered = hasActiveFilters();
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <div class="empty-state-icon"><i class="bi ${filtered ? "bi-filter" : "bi-inbox"}"></i></div>
          <div class="empty-state-text">${filtered ? "No expenses match your filters" : "No expenses yet"}</div>
          <div class="empty-state-sub">${filtered ? "Try adjusting or clearing your filters" : "Add your first expense using the form on the left"}</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = expenses
    .map(
      (e, i) => `
    <tr class="row-enter" style="animation-delay: ${Math.min(i * 30, 300)}ms">
      <td class="td-title" title="${escAttr(e.title)}">${escHtml(e.title)}</td>
      <td class="td-amount">${fmt(e.amount)}</td>
      <td>
        <span class="category-badge ${catClass(e.category)}">
          <i class="bi ${catIcon(e.category)}"></i>
          ${escHtml(e.category)}
        </span>
      </td>
      <td class="td-date">${formatDate(e.date)}</td>
      <td class="${e.note ? "td-note" : "td-note-empty"}" title="${escAttr(e.note)}">${e.note ? escHtml(e.note) : "—"}</td>
      <td class="td-actions">
        <button class="btn-action btn-action-edit" onclick="editExpense(${e.id})" title="Edit this expense" aria-label="Edit ${escAttr(e.title)}">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn-action btn-action-delete" onclick="confirmDelete(${e.id}, '${escAttr(e.title)}')" title="Delete this expense" aria-label="Delete ${escAttr(e.title)}">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`
    )
    .join("");
}

// ─── Edit ─────────────────────────────────────────────────────────────────────
async function editExpense(id) {
  try {
    const res = await fetch(`/api/expenses/${id}`);
    if (!res.ok) {
      if (res.status === 404) {
        showToast("This expense no longer exists. Refreshing list.", "danger");
        loadExpenses();
        loadSummary();
      } else {
        showToast("Failed to load expense.", "danger");
      }
      return;
    }
    const expense = await res.json();
    populateEditForm(expense);
  } catch {
    showToast("Network error.", "danger");
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function confirmDelete(id, title) {
  pendingDeleteId = id;
  // Show a truncated title in the modal so user knows what they're deleting
  const desc = document.getElementById("delete-modal-desc");
  if (title) {
    const short = truncate(title, 40);
    desc.innerHTML = `Delete <strong>"${escHtml(short)}"</strong>? This cannot be undone.`;
  } else {
    desc.textContent = "This action cannot be undone. The expense will be permanently removed.";
  }
  document.getElementById("delete-modal-overlay").classList.remove("hidden");
  // Focus the cancel button (safer default)
  document.getElementById("cancel-delete-btn").focus();
}

function closeDeleteModal() {
  document.getElementById("delete-modal-overlay").classList.add("hidden");
  pendingDeleteId = null;
}

async function executeDelete(id) {
  // Disable the delete button during request
  const btn = document.getElementById("confirm-delete-btn");
  btn.disabled = true;
  btn.textContent = "Deleting...";

  try {
    const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    let json;
    try { json = await res.json(); } catch { json = {}; }

    closeDeleteModal();

    if (!res.ok) {
      if (res.status === 404) {
        showToast("Already deleted. Refreshing list.", "warning");
      } else {
        showToast(json.error || "Delete failed.", "danger");
      }
    } else {
      showToast("Expense deleted.", "warning");
    }

    pendingDeleteId = null;

    // If we were editing this same expense, cancel the edit
    if (document.getElementById("edit-id").value == id) {
      resetForm();
    }

    loadExpenses();
    loadSummary();
    updateHeaderTotal();
  } catch {
    closeDeleteModal();
    showToast("Network error.", "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = "Delete";
  }
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function applyFilters() {
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;
  const errBox = document.getElementById("filter-error");

  if (from && to && from > to) {
    errBox.textContent = '"From" date cannot be after "To" date.';
    errBox.classList.remove("hidden");
    return;
  }
  errBox.classList.add("hidden");
  loadExpenses();
}

function clearFilters() {
  document.getElementById("filter-category").value = "";
  document.getElementById("filter-from").value = "";
  document.getElementById("filter-to").value = "";
  document.getElementById("filter-search").value = "";
  document.getElementById("filter-error").classList.add("hidden");
  loadExpenses();
}

function toggleFilters() {
  const body = document.getElementById("filter-body");
  const chevron = document.getElementById("filter-chevron");
  body.classList.toggle("collapsed");
  chevron.classList.toggle("rotated");
}

// ─── Monthly Summary ──────────────────────────────────────────────────────────
function updateMonthLabel() {
  const label = new Date(summaryYear, summaryMonth - 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  document.getElementById("month-label").textContent = label;
}

function changeMonth(delta) {
  summaryMonth += delta;
  if (summaryMonth > 12) {
    summaryMonth = 1;
    summaryYear++;
  } else if (summaryMonth < 1) {
    summaryMonth = 12;
    summaryYear--;
  }
  updateMonthLabel();
  loadSummary();

  // Auto-filter the expense table to this newly selected month
  const firstDay = `${summaryYear}-${String(summaryMonth).padStart(2, "0")}-01`;
  const lastDayVal = new Date(summaryYear, summaryMonth, 0).getDate();
  const lastDay = `${summaryYear}-${String(summaryMonth).padStart(2, "0")}-${String(lastDayVal).padStart(2, "0")}`;

  document.getElementById("filter-from").value = firstDay;
  document.getElementById("filter-to").value = lastDay;
  document.getElementById("filter-error").classList.add("hidden");

  loadExpenses();

  // Scroll the expenses table automatically back to the top of the viewport
  const expensesCard = document.querySelector(".card-expenses");
  if (expensesCard) {
    setTimeout(() => {
      expensesCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }
}

async function loadSummary() {
  try {
    const res = await fetch(`/api/summary/monthly?year=${summaryYear}&month=${summaryMonth}`);
    if (!res.ok) {
      document.getElementById("summary-body").innerHTML =
        '<p style="color: var(--danger); padding: 12px 0; text-align: center; font-size: 0.85rem;">Failed to load summary.</p>';
      return;
    }
    const json = await res.json();
    renderSummary(json);
  } catch {
    document.getElementById("summary-body").innerHTML =
      '<p style="color: var(--danger); padding: 12px 0; text-align: center; font-size: 0.85rem;">Failed to load summary.</p>';
  }
}

function renderSummary(data) {
  const breakdown = data.breakdown || {};
  const cats = Object.keys(breakdown).sort();
  const isZero = data.total === 0;

  let html = `
    <div class="summary-total-wrap">
      <div class="summary-total-label">Total Spent</div>
      <div class="summary-total-value ${isZero ? "zero" : ""}">${fmt(data.total)}</div>
    </div>`;

  if (cats.length === 0) {
    html += `<div class="summary-empty">No expenses this month</div>`;
  } else {
    cats.forEach((cat) => {
      const pct = data.total > 0 ? Math.round((breakdown[cat] / data.total) * 100) : 0;
      html += `
        <div class="summary-item">
          <span class="category-badge ${catClass(cat)}">
            <i class="bi ${catIcon(cat)}"></i>
            ${escHtml(cat)}
          </span>
          <span class="summary-item-amount">${fmt(breakdown[cat])} <span style="color: var(--text-muted); font-weight: 400; font-size: 0.75rem;">(${pct}%)</span></span>
        </div>`;
    });
  }

  document.getElementById("summary-body").innerHTML = html;

  // Update the chart
  renderChart(breakdown);
}

// ─── Security ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// For HTML attribute contexts (title="...", aria-label="...")
function escAttr(str) {
  if (!str) return "";
  return escHtml(str).replace(/\n/g, " ").replace(/\r/g, "");
}

// ─── Chart ────────────────────────────────────────────────────────────────────
const CHART_COLORS = {
  Food: "#ffd43b",
  Transport: "#4dabf7",
  Shopping: "#f783ac",
  Bills: "#38d9a9",
  Entertainment: "#da77f2",
  Other: "#868e96",
};

function renderChart(breakdown) {
  const container = document.getElementById("chart-container");
  const empty = document.getElementById("chart-empty");
  const canvas = document.getElementById("spending-chart");

  const cats = Object.keys(breakdown || {});

  if (cats.length === 0) {
    container.classList.add("hidden");
    empty.classList.remove("hidden");
    if (spendingChart) {
      spendingChart.destroy();
      spendingChart = null;
    }
    return;
  }

  container.classList.remove("hidden");
  empty.classList.add("hidden");

  const labels = cats;
  const data = cats.map((c) => breakdown[c]);
  const colors = cats.map((c) => CHART_COLORS[c] || "#868e96");

  const isLight = document.body.classList.contains("light");

  if (spendingChart) {
    spendingChart.data.labels = labels;
    spendingChart.data.datasets[0].data = data;
    spendingChart.data.datasets[0].backgroundColor = colors;
    spendingChart.update();
  } else {
    const ctx = canvas.getContext("2d");
    spendingChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: colors,
            borderColor: isLight ? "#ffffff" : "#1a1d27",
            borderWidth: 3,
            hoverBorderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "65%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: isLight ? "#64748b" : "#9ca3b4",
              font: { family: "'Inter', sans-serif", size: 11, weight: "500" },
              padding: 14,
              usePointStyle: true,
              pointStyleWidth: 8,
            },
          },
          tooltip: {
            backgroundColor: isLight ? "#ffffff" : "#242837",
            titleColor: isLight ? "#1e293b" : "#e8eaf0",
            bodyColor: isLight ? "#64748b" : "#9ca3b4",
            borderColor: isLight ? "#cbd5e1" : "#2a2e3e",
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            titleFont: { family: "'Inter', sans-serif", weight: "600" },
            bodyFont: { family: "'Inter', sans-serif" },
            callbacks: {
              label: function (context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
                return ` ₹${Number(context.parsed).toLocaleString("en-IN", { minimumFractionDigits: 2 })} (${pct}%)`;
              },
            },
          },
        },
        animation: {
          animateRotate: true,
          duration: 600,
        },
      },
    });
  }
}
