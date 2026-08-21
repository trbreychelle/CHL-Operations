from pathlib import Path
import re

CHANGED: list[str] = []


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def newline_for(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def localize_newlines(text: str, value: str) -> str:
    return value.replace("\n", newline_for(text))


def mark_changed(path: str) -> None:
    if path not in CHANGED:
        CHANGED.append(path)


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

    # A callback is intentional: re.sub replacement strings interpret backslashes,
    # while the generated JavaScript contains regex escapes such as \d.
    updated, count = re.subn(
        pattern,
        lambda _match: localized,
        text,
        count=1,
        flags=re.S,
    )

    if required and count != 1:
        raise RuntimeError(
            f"{label}: expected exactly one match in {path}, found {count}"
        )

    if count:
        write_text(path, updated)
        mark_changed(path)
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

main_text = read_text("main.js")

if "const SALES_RATE_POLICY = Object.freeze({" not in main_text:
    replace_regex(
        "main.js",
        r"function getSalesLeadRateForDeal\(category, purchaseDateValue\) \{.*?\r?\n\}",
        MAIN_RATE_POLICY,
        "central rate policy",
        required=True,
    )

main_text = read_text("main.js")
if "// Every access level now uses the same category/date commission policy." not in main_text:
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
    newline = newline_for(main_text)
    replacement = newline.join(
        [
            "window.SALES_RATE_POLICY = SALES_RATE_POLICY;",
            "window.getSalesLeadRateForDeal = getSalesLeadRateForDeal;",
            export_marker,
        ]
    )
    main_text = main_text.replace(export_marker, replacement, 1)
    write_text("main.js", main_text)
    mark_changed("main.js")
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

admin_text = read_text("admin-dashboard.html")
if "return window.getSalesLeadRateForDeal(category, purchaseDateValue);" not in admin_text:
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
    optional_text = read_text(optional_path)
    if (
        "const getSalesLeadRate = (category, purchaseDateValue) => {" in optional_text
        and "return window.getSalesLeadRateForDeal(category, purchaseDateValue);" not in optional_text
    ):
        replace_regex(
            optional_path,
            ADMIN_STYLE_PATTERN,
            SHARED_RATE_WRAPPER,
            "optional shared-rate wrapper",
            required=True,
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

sales_text = read_text("salesdashboard.html")
if "const salesFinancials = window.calculateAutoSalesCommission(" not in sales_text:
    replace_regex(
        "salesdashboard.html",
        INLINE_RATE_PATTERN,
        SHARED_SALES_RENDER,
        "sales-access shared calculator",
        required=True,
    )


salesrep_text = read_text("salesrep-dashboard.html")
if "const commVal = salesFinancials.commission;" not in salesrep_text:
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
    if old in salesrep_text:
        salesrep_text = salesrep_text.replace(old, new, 1)

newline = newline_for(salesrep_text)
open_marker = "document.getElementById('sale-category').value = \"Mikaela\";"
open_call = "window.installSaleCommissionAutoCalc?.();"
if open_marker in salesrep_text:
    open_pos = salesrep_text.index(open_marker)
    nearby = salesrep_text[open_pos : open_pos + len(open_marker) + 120]
    if open_call not in nearby:
        salesrep_text = salesrep_text.replace(
            open_marker,
            open_marker + newline + "    " + open_call,
            1,
        )

edit_marker = (
    "document.getElementById('sale-category').value = "
    "pkg.sales_category || \"Mikaela\";"
)
if edit_marker in salesrep_text:
    edit_pos = salesrep_text.index(edit_marker)
    nearby = salesrep_text[edit_pos : edit_pos + len(edit_marker) + 120]
    if open_call not in nearby:
        salesrep_text = salesrep_text.replace(
            edit_marker,
            edit_marker + newline + "    " + open_call,
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

if "const commissionValue = window.calculateAutoSalesCommission(" not in salesrep_text:
    old_payload = localize_newlines(salesrep_text, OLD_PAYLOAD)
    new_payload = localize_newlines(salesrep_text, NEW_PAYLOAD)
    if old_payload not in salesrep_text:
        raise RuntimeError("Could not find sales-rep save payload")
    salesrep_text = salesrep_text.replace(old_payload, new_payload, 1)

original_salesrep = read_text("salesrep-dashboard.html")
if salesrep_text != original_salesrep:
    write_text("salesrep-dashboard.html", salesrep_text)
    mark_changed("salesrep-dashboard.html")
    print("Updated sales-rep modal, table, and save behavior")


legacy_markers = {
    "main.js": [
        "return normalizeSalesCategoryForRates(category) === 'TRB' ? 100 : 135;",
    ],
    "admin-dashboard.html": [
        'return normalizeSalesCategory(category) === "TRB" ? 100 : 135;',
    ],
    "salesdashboard.html": [
        "const ratePerLead = purchaseDateObj && purchaseDateObj >= new Date",
    ],
    "salesrep-dashboard.html": [
        "Track Mikaela deals only and use manual commission entry.",
        "commission_per_lead: parseFloat(document.getElementById('sale-commission').value) || 0",
        "p.manual_commission ??",
    ],
}

for path, markers in legacy_markers.items():
    text = read_text(path)
    for marker in markers:
        if marker in text:
            raise RuntimeError(f"Legacy sales-rate behavior remains in {path}: {marker}")

required_markers = {
    "main.js": [
        "mikaelaEffectiveDate: '2026-08-08'",
        "mikaelaRate: 150",
        "window.getSalesLeadRateForDeal = getSalesLeadRateForDeal;",
    ],
    "admin-dashboard.html": [
        "return window.getSalesLeadRateForDeal(category, purchaseDateValue);",
    ],
    "salesdashboard.html": [
        "const salesFinancials = window.calculateAutoSalesCommission(",
    ],
    "salesrep-dashboard.html": [
        "const salesFinancials = window.calculateAutoSalesCommission(",
        "const commissionValue = window.calculateAutoSalesCommission(",
    ],
}

for path, markers in required_markers.items():
    text = read_text(path)
    for marker in markers:
        if marker not in text:
            raise RuntimeError(f"Required shared-rate behavior is missing in {path}: {marker}")

print("Files changed:")
for path in sorted(CHANGED):
    print(f" - {path}")
