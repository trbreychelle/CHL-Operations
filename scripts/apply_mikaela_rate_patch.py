from pathlib import Path
import re

CHANGED = []


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def localize_newlines(text: str, replacement: str) -> str:
    newline = "\r\n" if "\r\n" in text else "\n"
    return replacement.replace("\n", newline)


def replace_regex(
    path: str,
    pattern: str,
    replacement: str,
    label: str,
    *,
    required: bool = False,
) -> int:
    text = read_text(path)
    localized = localize_newlines(text, replacement)
    updated, count = re.subn(pattern, localized, text, count=1, flags=re.S)

    if required and count != 1:
        raise RuntimeError(
            f"{label}: expected exactly one match in {path}, found {count}"
        )

    if count:
        write_text(path, updated)
        CHANGED.append(path)
        print(f"Updated {label} in {path}")

    return count


MAIN_RATE_POLICY = """const SALES_RATE_POLICY = Object.freeze({
    standardEffectiveDate: '2026-03-09',
    mikaelaEffectiveDate: '2026-08-08',
    historicalRate: 125,
    standardRate: 135,
    trbRate: 100,
    mikaelaRate: 150
});

function getSalesLeadRateForDeal(category, purchaseDateValue) {
    const normalizedCategory = normalizeSalesCategoryForRates(category);
    const rawDate = String(purchaseDateValue || '').trim();
    const dateMatch = rawDate.match(/^(\\d{4}-\\d{2}-\\d{2})/);
    let purchaseDateKey = dateMatch ? dateMatch[1] : '';

    if (!purchaseDateKey && purchaseDateValue) {
        const parsedDate = new Date(purchaseDateValue);
        if (!isNaN(parsedDate.getTime())) {
            const year = parsedDate.getFullYear();
            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const day = String(parsedDate.getDate()).padStart(2, '0');
            purchaseDateKey = `${year}-${month}-${day}`;
        }
    }

    if (!purchaseDateKey || purchaseDateKey < SALES_RATE_POLICY.standardEffectiveDate) {
        return SALES_RATE_POLICY.historicalRate;
    }

    if (
        normalizedCategory === 'Mikaela' &&
        purchaseDateKey >= SALES_RATE_POLICY.mikaelaEffectiveDate
    ) {
        return SALES_RATE_POLICY.mikaelaRate;
    }

    if (normalizedCategory === 'TRB') {
        return SALES_RATE_POLICY.trbRate;
    }

    return SALES_RATE_POLICY.standardRate;
}"""

replace_regex(
    "main.js",
    r"function getSalesLeadRateForDeal\(category, purchaseDateValue\) \{.*?\r?\n\}",
    MAIN_RATE_POLICY,
    "central rate policy",
    required=True,
)

replace_regex(
    "main.js",
    r"function isSalesRepDealEntryContext\(\) \{.*?\r?\n\}",
    """function isSalesRepDealEntryContext() {
    // Every access level now uses the same category/date commission policy.
    return false;
}""",
    "shared commission mode for every access level",
    required=True,
)

main_text = read_text("main.js")
export_marker = "window.calculateAutoSalesCommission = calculateAutoSalesCommission;"
if export_marker not in main_text:
    raise RuntimeError("Could not find the sales calculator export in main.js")

if "window.getSalesLeadRateForDeal = getSalesLeadRateForDeal;" not in main_text:
    newline = "\r\n" if "\r\n" in main_text else "\n"
    replacement = newline.join(
        [
            "window.SALES_RATE_POLICY = SALES_RATE_POLICY;",
            "window.getSalesLeadRateForDeal = getSalesLeadRateForDeal;",
            export_marker,
        ]
    )
    main_text = main_text.replace(export_marker, replacement, 1)
    write_text("main.js", main_text)
    if "main.js" not in CHANGED:
        CHANGED.append("main.js")
    print("Exported the shared rate policy from main.js")

SHARED_RATE_WRAPPER = """const getSalesLeadRate = (category, purchaseDateValue) => {
  if (typeof window.getSalesLeadRateForDeal !== "function") {
    throw new Error("Shared sales-rate policy is unavailable.");
  }
  return window.getSalesLeadRateForDeal(category, purchaseDateValue);
};"""

ADMIN_STYLE_PATTERN = (
    r"const getSalesLeadRate = \(category, purchaseDateValue\) => \{"
    r".*?\r?\n\};"
)

replace_regex(
    "admin-dashboard.html",
    ADMIN_STYLE_PATTERN,
    SHARED_RATE_WRAPPER,
    "admin shared-rate wrapper",
    required=True,
)

for optional_path in (
    "management-dashboard.html",
    "salesdashboard.html",
    "salesrep-dashboard.html",
):
    replace_regex(
        optional_path,
        ADMIN_STYLE_PATTERN,
        SHARED_RATE_WRAPPER,
        "optional shared-rate wrapper",
        required=False,
    )

SHARED_SALES_RENDER = """const salesFinancials = window.calculateAutoSalesCommission(
  purchasedAmount,
  dealVal,
  p.sales_category || p.sold_by || "",
  p.purchase_date
);
const ratePerLead = salesFinancials.rate;
const totalLeadCost = salesFinancials.profit;
const commVal = salesFinancials.commission;"""

INLINE_RATE_PATTERN = (
    r"const purchaseDateObj = p\.purchase_date \? new Date\(String\(p\.purchase_date\)\.trim\(\) \+ [\"']T00:00:00[\"']\) : null;"
    r"\s*const ratePerLead = purchaseDateObj && purchaseDateObj >= new Date\([\"']2026-03-09T00:00:00[\"']\)"
    r"\s*\? 135\s*: 125;"
    r"\s*const totalLeadCost = purchasedAmount \* ratePerLead;"
    r"\s*const commVal = Math\.max\(0, dealVal - totalLeadCost\);"
)

replace_regex(
    "salesdashboard.html",
    INLINE_RATE_PATTERN,
    SHARED_SALES_RENDER,
    "sales-access shared calculator",
    required=True,
)

replace_regex(
    "salesrep-dashboard.html",
    r"const commVal = Number\(\s*p\.manual_commission \?\?\s*p\.commission \?\?\s*p\.commission_per_lead \?\?\s*0\s*\) \|\| 0;",
    """const salesFinancials = window.calculateAutoSalesCommission(
  Number(p.purchased_leads) || 0,
  dealVal,
  soldBy,
  p.purchase_date
);
const commVal = salesFinancials.commission;""",
    "sales-rep shared table calculator",
    required=True,
)

salesrep_text = read_text("salesrep-dashboard.html")
for old, new in (
    (
        "Track Mikaela deals only and use manual commission entry.",
        "Track Mikaela and Hammer deals using the shared commission policy.",
    ),
    ("Manual Commission ($)", "Commission ($)"),
):
    if old not in salesrep_text:
        raise RuntimeError(f"Could not find sales-rep UI text: {old}")
    salesrep_text = salesrep_text.replace(old, new, 1)

open_marker = "document.getElementById('sale-category').value = \"Mikaela\";"
if open_marker not in salesrep_text:
    raise RuntimeError("Could not find sales-rep Add Deal category marker")
salesrep_text = salesrep_text.replace(
    open_marker,
    open_marker + "\n    window.installSaleCommissionAutoCalc?.();",
    1,
)

edit_marker = (
    "document.getElementById('sale-category').value = "
    "pkg.sales_category || \"Mikaela\";"
)
if edit_marker not in salesrep_text:
    raise RuntimeError("Could not find sales-rep Edit Deal category marker")
salesrep_text = salesrep_text.replace(
    edit_marker,
    edit_marker + "\n    window.installSaleCommissionAutoCalc?.();",
    1,
)

OLD_PAYLOAD = """        const payload = {
    client_code: clientCode,
    purchased_leads: parseInt(document.getElementById('sale-leads').value) || 0,
    amount: parseFloat(document.getElementById('sale-value').value) || 0,
    commission_per_lead: parseFloat(document.getElementById('sale-commission').value) || 0,
    purchase_date: document.getElementById('sale-date').value,
    external_package_id: document.getElementById('sale-transaction-id').value,
    status: "Active",
    deal_status: document.getElementById('sale-deal-status').value,
    deal_type: document.getElementById('sale-deal-type').value,
   sales_category: document.getElementById('sale-category').value
};"""

NEW_PAYLOAD = """        const purchasedLeads = parseInt(document.getElementById('sale-leads').value) || 0;
        const dealAmount = parseFloat(document.getElementById('sale-value').value) || 0;
        const purchaseDate = document.getElementById('sale-date').value;
        const salesCategory = document.getElementById('sale-category').value;
        const commissionValue = window.calculateAutoSalesCommission(
          purchasedLeads,
          dealAmount,
          salesCategory,
          purchaseDate
        ).commission;

        document.getElementById('sale-commission').value = commissionValue.toFixed(2);

        const payload = {
    client_code: clientCode,
    purchased_leads: purchasedLeads,
    amount: dealAmount,
    commission_per_lead: commissionValue,
    purchase_date: purchaseDate,
    external_package_id: document.getElementById('sale-transaction-id').value,
    status: "Active",
    deal_status: document.getElementById('sale-deal-status').value,
    deal_type: document.getElementById('sale-deal-type').value,
   sales_category: salesCategory
};"""

old_payload_local = localize_newlines(salesrep_text, OLD_PAYLOAD)
new_payload_local = localize_newlines(salesrep_text, NEW_PAYLOAD)
if old_payload_local not in salesrep_text:
    raise RuntimeError("Could not find sales-rep save payload")
salesrep_text = salesrep_text.replace(old_payload_local, new_payload_local, 1)
write_text("salesrep-dashboard.html", salesrep_text)
if "salesrep-dashboard.html" not in CHANGED:
    CHANGED.append("salesrep-dashboard.html")

legacy_markers = {
    "main.js": [
        "return normalizeSalesCategoryForRates(category) === 'TRB' ? 100 : 135;",
    ],
    "admin-dashboard.html": [
        'return normalizeSalesCategory(category) === "TRB" ? 100 : 135;',
    ],
    "salesrep-dashboard.html": [
        "Track Mikaela deals only and use manual commission entry.",
        "commission_per_lead: parseFloat(document.getElementById('sale-commission').value) || 0",
    ],
}

for path, markers in legacy_markers.items():
    text = read_text(path)
    for marker in markers:
        if marker in text:
            raise RuntimeError(f"Legacy sales-rate behavior remains in {path}: {marker}")

print("Files changed:")
for path in sorted(set(CHANGED)):
    print(f" - {path}")
