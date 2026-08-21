from pathlib import Path
import re


CHANGED = []


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    if path not in CHANGED:
        CHANGED.append(path)


def newline_for(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def localize(text: str, replacement: str) -> str:
    return replacement.replace("\n", newline_for(text))


def replace_regex(path: str, pattern: str, replacement: str, label: str, *, required: bool = True) -> int:
    text = read_text(path)
    localized = localize(text, replacement)
    updated, count = re.subn(pattern, lambda _match: localized, text, count=1, flags=re.S)
    if required and count != 1:
        raise RuntimeError(f"{label}: expected exactly one match in {path}, found {count}")
    if count:
        write_text(path, updated)
        print(f"Updated {label} in {path}")
    return count


def replace_literal(path: str, old: str, new: str, label: str, *, required: bool = True) -> int:
    text = read_text(path)
    old_local = localize(text, old)
    new_local = localize(text, new)
    count = text.count(old_local)
    if required and count != 1:
        raise RuntimeError(f"{label}: expected exactly one match in {path}, found {count}")
    if count:
        text = text.replace(old_local, new_local, 1)
        write_text(path, text)
        print(f"Updated {label} in {path}")
    return count


# ---------------------------------------------------------------------------
# main.js: remove all pricing formulas and make the modal backend-read-only.
# ---------------------------------------------------------------------------
main_backend_reader = r'''function parseSalesMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
    const n = Number(cleaned);

    return Number.isFinite(n) ? n : 0;
}

function readBackendSalesFinancials(pkg = {}) {
    const originalSalesValue = parseSalesMoney(
        pkg.original_sales_value ??
        pkg.original_sales_value_calc ??
        pkg.amount
    );

    const salesValue = parseSalesMoney(
        pkg.sales_value ??
        pkg.adjusted_sales_value ??
        pkg.adjusted_sales_value_calc ??
        originalSalesValue
    );

    const originalProfit = parseSalesMoney(
        pkg.original_profit_value ??
        pkg.original_company_profit_calc
    );

    const profit = parseSalesMoney(
        pkg.chl_profit ??
        pkg.adjusted_profit_value ??
        pkg.adjusted_profit_value_calc ??
        originalProfit
    );

    const originalCommission = parseSalesMoney(
        pkg.original_commission_value ??
        pkg.original_commission_value_calc ??
        pkg.commission_per_lead
    );

    const commission = parseSalesMoney(
        pkg.sales_commission ??
        pkg.adjusted_commission_value ??
        originalCommission
    );

    const rate = parseSalesMoney(
        pkg.rate_per_lead ??
        pkg.rate_per_lead_calc
    );

    return {
        rate,
        originalSalesValue,
        salesValue,
        originalProfit,
        profit,
        originalCommission,
        commission
    };
}

function configureSaleCommissionField() {
    const commissionInput = document.getElementById('sale-commission');
    if (!commissionInput) return;

    commissionInput.readOnly = true;
    commissionInput.placeholder = 'Calculated by Supabase after save';
    commissionInput.classList.add('bg-gray-50', 'text-gray-700', 'cursor-not-allowed');
}

function updateSaleCommissionField() {
    configureSaleCommissionField();
}

function installSaleCommissionAutoCalc() {
    configureSaleCommissionField();
}

function removeHistoricalSaleCategoryOptions() {
    const select = document.getElementById('sale-category');
    if (!select) return;

    Array.from(select.querySelectorAll('option[data-historical="true"]')).forEach(opt => opt.remove());
    delete select.dataset.originalSalesCategory;
}

function setSaleCategoryValueSafely(categoryValue) {
    const select = document.getElementById('sale-category');
    if (!select) return;

    removeHistoricalSaleCategoryOptions();

    const rawCategory = String(categoryValue || '').trim();
    select.dataset.originalSalesCategory = rawCategory;

    if (!rawCategory) return;

    const existingOption = Array.from(select.options).find(opt =>
        String(opt.value || '').trim().toLowerCase() === rawCategory.toLowerCase()
    );

    if (existingOption) {
        select.value = existingOption.value;
    } else {
        const opt = document.createElement('option');
        opt.value = rawCategory;
        opt.textContent = `${rawCategory} (historical)`;
        opt.dataset.historical = 'true';
        opt.disabled = true;
        select.appendChild(opt);
        select.value = rawCategory;
    }
}

window.readBackendSalesFinancials = readBackendSalesFinancials;
window.updateSaleCommissionField = updateSaleCommissionField;
window.installSaleCommissionAutoCalc = installSaleCommissionAutoCalc;
'''

replace_regex(
    "main.js",
    r"function isSalesRepDealEntryContext\(\) \{.*?window\.installSaleCommissionAutoCalc = installSaleCommissionAutoCalc;\r?\n",
    main_backend_reader,
    "backend-only sales financial reader",
)

replace_literal(
    "main.js",
    """    configureSaleCommissionField();
document.getElementById('sale-commission').value = pkg.commission_per_lead || 0;
""",
    """    configureSaleCommissionField();
    const backendFinancials = readBackendSalesFinancials(pkg);
    document.getElementById('sale-commission').value = backendFinancials.commission.toFixed(2);
""",
    "edit modal backend commission",
)

replace_regex(
    "main.js",
    r"\r?\nconst categorySelect = document\.getElementById\('sale-category'\);.*?\r?\nconst payload = \{",
    "\nconst payload = {",
    "remove browser commission calculation before save",
)

replace_literal(
    "main.js",
    """    commission_per_lead: commissionValue,
""",
    "",
    "remove commission from package payload",
)

replace_literal(
    "main.js",
    """            'commission_per_lead',
""",
    "",
    "remove browser commission from tracked input fields",
)

# ---------------------------------------------------------------------------
# Admin: preserve all current refund behavior, but read every value from view.
# ---------------------------------------------------------------------------
replace_regex(
    "admin-dashboard.html",
    r"const isAutoCommissionCategory = \(category\) => \{.*?\r?\n\};\r?\n\r?\nconst getSalesLeadRate = \(category, purchaseDateValue\) => \{.*?\r?\n\};\r?\n\r?\n",
    "",
    "remove admin pricing helpers",
)

admin_backend_financials = r'''const calculateSalesFinancials = (pkg, packageStatus, dealStatus) => {
  const dealVal = parseSalesNumber(
    pkg.original_sales_value ??
    pkg.original_sales_value_calc ??
    pkg.amount
  );

  const purchasedAmount = parseSalesNumber(
    pkg.purchased_leads_calc ??
    pkg.purchased_leads
  );

  const ratePerLead = parseSalesNumber(
    pkg.rate_per_lead ??
    pkg.rate_per_lead_calc
  );

  const originalProfit = parseSalesNumber(
    pkg.original_profit_value ??
    pkg.original_company_profit_calc
  );

  const originalCommission = parseSalesNumber(
    pkg.original_commission_value ??
    pkg.original_commission_value_calc
  );

  const adjustedSales = parseSalesNumber(
    pkg.sales_value ??
    pkg.adjusted_sales_value ??
    pkg.adjusted_sales_value_calc ??
    dealVal
  );

  const adjustedCommission = parseSalesNumber(
    pkg.sales_commission ??
    pkg.adjusted_commission_value ??
    originalCommission
  );

  const adjustedProfit = parseSalesNumber(
    pkg.chl_profit ??
    pkg.adjusted_profit_value ??
    pkg.adjusted_profit_value_calc ??
    originalProfit
  );

  return {
    dealVal,
    purchasedAmount,
    ratePerLead,
    originalProfit,
    originalCommission,
    adjustedSales,
    adjustedCommission,
    adjustedProfit
  };
};'''

replace_regex(
    "admin-dashboard.html",
    r"const calculateSalesFinancials = \(pkg, packageStatus, dealStatus\) => \{.*?\r?\n\};",
    admin_backend_financials,
    "admin backend financial reader",
)

# ---------------------------------------------------------------------------
# Sales: display the final values returned by sales_pipeline_financials_view.
# ---------------------------------------------------------------------------
sales_backend_render = r'''            const backendFinancials = window.readBackendSalesFinancials(p);
            const dealVal = backendFinancials.salesValue;
            const purchasedAmount = Number(p.purchased_leads_calc ?? p.purchased_leads) || 0;
            const ratePerLead = backendFinancials.rate;
            const totalLeadCost = backendFinancials.profit;
            const commVal = backendFinancials.commission;'''

replace_regex(
    "salesdashboard.html",
    r"\s*const rawAmt = p\.amount \? String\(p\.amount\)\.replace\(/\[\^0-9\.\-\]\+/g,\"\"\) : \"0\";\s*const dealVal = parseFloat\(rawAmt\) \|\| 0;\s*const purchasedAmount = Number\(p\.purchased_leads\) \|\| 0;\s*const salesFinancials = window\.calculateAutoSalesCommission\(.*?\);\s*const ratePerLead = salesFinancials\.rate;\s*const totalLeadCost = salesFinancials\.profit;\s*const commVal = salesFinancials\.commission;",
    "\n" + sales_backend_render,
    "sales access backend values",
)

# ---------------------------------------------------------------------------
# Sales Rep: same backend values, read-only modal, no commission writes.
# ---------------------------------------------------------------------------
salesrep_backend_render = r'''            const backendFinancials = window.readBackendSalesFinancials(p);
            const dealVal = backendFinancials.salesValue;
            const commVal = backendFinancials.commission;'''

replace_regex(
    "salesrep-dashboard.html",
    r"\s*const rawAmt = p\.amount \? String\(p\.amount\)\.replace\(/\[\^0-9\.\-\]\+/g, \"\"\) : \"0\";\s*const dealVal = parseFloat\(rawAmt\) \|\| Number\(p\.deal_value \|\| 0\) \|\| 0;\s*const salesFinancials = window\.calculateAutoSalesCommission\(.*?\);\s*const commVal = salesFinancials\.commission;",
    "\n" + salesrep_backend_render,
    "sales rep backend values",
)

replace_literal(
    "salesrep-dashboard.html",
    """    document.getElementById('sale-commission').value = pkg.commission_per_lead || 0;
""",
    """    const backendFinancials = window.readBackendSalesFinancials(pkg);
    document.getElementById('sale-commission').value = backendFinancials.commission.toFixed(2);
""",
    "sales rep edit modal backend commission",
)

replace_regex(
    "salesrep-dashboard.html",
    r"\s*const commissionValue = window\.calculateAutoSalesCommission\(.*?\)\.commission;\s*document\.getElementById\('sale-commission'\)\.value = commissionValue\.toFixed\(2\);",
    "",
    "remove sales rep browser commission calculation",
)

replace_literal(
    "salesrep-dashboard.html",
    """    commission_per_lead: commissionValue,
""",
    "",
    "remove sales rep commission payload",
)

# Clear labels that imply the browser is authoritative.
for path in ["admin-dashboard.html", "salesdashboard.html", "salesrep-dashboard.html"]:
    text = read_text(path)
    updated = text.replace("Manual Commission ($)", "Backend Commission ($)")
    updated = updated.replace("Auto-calculated", "Calculated by Supabase")
    if updated != text:
        write_text(path, updated)
        print(f"Updated backend commission labels in {path}")

# ---------------------------------------------------------------------------
# Guardrails: fail rather than silently leave a second formula behind.
# ---------------------------------------------------------------------------
checks = {
    "main.js": [
        "SALES_RATE_POLICY",
        "getSalesLeadRateForDeal",
        "calculateAutoSalesCommission",
        "commission_per_lead: commissionValue",
    ],
    "admin-dashboard.html": [
        "getSalesLeadRate(category",
        "purchasedAmount * ratePerLead",
    ],
    "salesdashboard.html": [
        "window.calculateAutoSalesCommission",
    ],
    "salesrep-dashboard.html": [
        "window.calculateAutoSalesCommission",
        "commission_per_lead: commissionValue",
    ],
}

for path, forbidden in checks.items():
    text = read_text(path)
    for marker in forbidden:
        if marker in text:
            raise RuntimeError(f"Frontend sales formula remains in {path}: {marker}")

required_markers = {
    "main.js": ["function readBackendSalesFinancials", "window.readBackendSalesFinancials"],
    "admin-dashboard.html": ["pkg.sales_commission", "pkg.chl_profit", "pkg.rate_per_lead"],
    "salesdashboard.html": ["window.readBackendSalesFinancials(p)"],
    "salesrep-dashboard.html": ["window.readBackendSalesFinancials(p)"],
}

for path, required in required_markers.items():
    text = read_text(path)
    for marker in required:
        if marker not in text:
            raise RuntimeError(f"Required backend marker missing in {path}: {marker}")

print("Files changed:")
for path in CHANGED:
    print(f" - {path}")
