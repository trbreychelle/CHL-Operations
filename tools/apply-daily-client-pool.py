#!/usr/bin/env python3
"""Apply the guarded, idempotent old-dashboard client-pool compatibility repair."""
from pathlib import Path

START = "  // DAILY CLIENT POOL COMPATIBILITY START"
END = "  // DAILY CLIENT POOL COMPATIBILITY END"
HELPERS = r'''  // DAILY CLIENT POOL COMPATIBILITY START
  resolvePassbookClientStatus(rawClient = {}) {
    const normalize = value => String(value || "").trim().toUpperCase();
    const current = normalize(rawClient.client_status);
    const canonical = ["ACTIVE", "INACTIVE", "BLACKLISTED"];

    // The editable client status always wins, including explicit exclusions.
    if (canonical.includes(current)) return current;

    // Older imports put PACKAGE statuses here. Use the legacy CLIENT status
    // only for those known old values; never infer activation from a package.
    const legacyPackageValues = ["", "ONGOING", "PAUSE", "PAUSED", "COMPLETED", "REFUNDED"];
    if (!legacyPackageValues.includes(current)) return "INACTIVE";
    const legacy = normalize(rawClient.status);
    return canonical.includes(legacy) ? legacy : "INACTIVE";
  },

  getDailyClientPoolRows(rows, packageFilter = "ONGOING", search = "", assignedCodes = new Set()) {
    const normalize = value => String(value || "").trim().toUpperCase();
    const normalizePackage = value => {
      const status = normalize(value);
      if (status === "ACTIVE") return "ONGOING";
      if (status === "PAUSED") return "PAUSE";
      return status;
    };
    const filter = normalizePackage(packageFilter) || "ONGOING";
    const query = String(search || "").trim().toLowerCase();
    const assigned = new Set(Array.from(assignedCodes, code => String(code || "").trim().toLowerCase()));

    return (Array.isArray(rows) ? rows : []).filter(row => {
      const status = normalizePackage(row.packageStatus);
      const code = String(row.code || "").trim().toLowerCase();
      if (normalize(row.passbookStatus) !== "ACTIVE") return false;
      // ALL means all available packages, not completed/refunded history.
      if (!["ONGOING", "PAUSE"].includes(status)) return false;
      if (normalize(row.dealStatus) === "REFUNDED") return false;
      if (filter !== "ALL" && status !== filter) return false;
      if (!code || assigned.has(code)) return false;
      const company = String(row.searchName || row.roofingCompany || "").replace(/<[^>]*>/g, "");
      const text = `${row.code || ""} ${row.clientName || ""} ${company}`.toLowerCase();
      return !query || text.includes(query);
    });
  },

  showAllDailyClientPoolStatuses() {
    const select = document.getElementById("daily-client-pool-status");
    if (select) select.value = "ALL";
    return this.renderDailyTab();
  },
  // DAILY CLIENT POOL COMPATIBILITY END

'''

def once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Refusing unexpected source: expected one match, found {count}: {old[:100]!r}")
    return text.replace(old, new, 1)


def apply(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if START in text:
        required = [END, 'passbookStatus: this.resolvePassbookClientStatus(rawClient),',
                    'const activeClientPool = this.getDailyClientPoolRows(',
                    'onclick="Admin.showAllDailyClientPoolStatuses()"']
        if not all(item in text for item in required):
            raise SystemExit("Refusing a partially applied repair")
        print("Daily client pool repair already applied")
        return False

    text = once(text, '        normalizeClientHealthRows(allocationRows, rawClients = [], packages = []) {',
                HELPERS + '        normalizeClientHealthRows(allocationRows, rawClients = [], packages = []) {')
    text = once(text, 'passbookStatus: String(rawClient.client_status || "INACTIVE").toUpperCase().trim(),',
                'passbookStatus: this.resolvePassbookClientStatus(rawClient),')
    start = text.index('  const activeClientPool = clientHealthRows\n    .filter(r => {')
    finish = text.index('        .sort((a, b) => {', start)
    old_filter = text[start:finish]
    if 'if (passbookStatus !== "ACTIVE") return false;' not in old_filter or 'if (assignedCodes.has(code)) return false;' not in old_filter or len(old_filter) > 2000:
        raise SystemExit("Unexpected existing pool filter; manual review required")
    text = once(text, old_filter, '''  const activeClientPool = this.getDailyClientPoolRows(
    clientHealthRows, clientPoolStatus, clientPoolSearch, assignedCodes
  )
''')
    text = once(text, 'clientPoolEl.innerHTML = `<div class="text-sm text-gray-400 italic">No available active clients for this strategy day.</div>`;',
                '''clientPoolEl.innerHTML = `
          <div class="text-sm text-gray-500 md:col-span-2 xl:col-span-3">
            <p>No available clients match this search and package filter for the selected day and shift.</p>
            ${clientPoolStatus !== "ALL" ? `
              <button type="button" onclick="Admin.showAllDailyClientPoolStatuses()"
                class="mt-3 px-3 py-2 rounded-lg border border-blue-200 text-blue-700 font-bold hover:bg-blue-50">
                Show all available package statuses
              </button>
            ` : ""}
          </div>`;''')
    text = once(text, '      id="daily-client-pool-status"\n      class=',
                '      id="daily-client-pool-status"\n      aria-label="Package status filter"\n      class=')
    path.write_text(text, encoding="utf-8")
    print(f"Repaired {path}; no database records or authentication settings changed")
    return True

if __name__ == "__main__":
    apply(Path("admin-dashboard.html"))
