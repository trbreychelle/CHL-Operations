#!/usr/bin/env python3
"""Apply the reviewed payroll-loading repair. Never changes database records."""
from pathlib import Path
import hashlib
p = Path("admin-dashboard.html")
text = p.read_text()
if "async payrollRead(query, label)" in text:
    print("Payroll-loading repair already applied.")
    raise SystemExit(0)
if hashlib.sha256(text.encode()).hexdigest() != '6d8a12c2e1c4f2f9c5ea48f2ed0ad06ac2c51e2208f31a0ea76a7629ac7262c1':
    raise SystemExit("Dashboard changed; review the patch before proceeding.")
def section(start, end, replacement):
    global text
    a = text.index(start)
    b = text.index(end, a)
    text = text[:a] + replacement + text[b:]
section('             async renderPayrollFinance() {', '          if (selectedWeekMeta?.week_start) {', r'''        // Payroll reads are bounded and never turn request failures into a $0 payroll.
        async payrollRead(query, label) {
          const controller = new AbortController();
          let timer;
          try {
            const request = typeof query.abortSignal === "function"
              ? query.abortSignal(controller.signal) : query;
            const result = await Promise.race([
              Promise.resolve(request),
              new Promise((_, reject) => {
                timer = setTimeout(() => {
                  reject(Object.assign(new Error(`${label} timed out. Please retry.`), { code: "TIMEOUT" }));
                  controller.abort();
                }, this._payrollTimeoutMs || 20000);
              })
            ]);
            if (result?.error) throw result.error;
            if (!Array.isArray(result?.data)) throw new Error(`${label} returned an invalid response.`);
            return result.data;
          } finally {
            clearTimeout(timer);
          }
        },

        setPayrollLoadMessage(message, retry = false) {
          const box = document.getElementById("payroll-load-status");
          const text = document.getElementById("payroll-load-message");
          const button = document.getElementById("payroll-retry");
          if (box) box.hidden = !message;
          if (text) text.textContent = message || "";
          if (button) button.hidden = !retry;
        },

        clearPayrollDisplay(message, total = "—") {
          this._currentPayrollRows = [];
          this._chartData = { labels: [], payouts: [], revenue: [] };
          for (const chart of Object.values(this._payrollCharts || {})) {
            if (chart?.data) {
              chart.data.labels = [];
              (chart.data.datasets || []).forEach(dataset => { dataset.data = []; });
              chart.update?.();
            }
          }
          for (const [id, span] of [["payroll-summary-body", 7], ["payroll-ledger-body", 16]]) {
            const body = document.getElementById(id);
            if (!body) continue;
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = span;
            cell.className = "p-8 text-center text-gray-500";
            cell.textContent = message;
            row.appendChild(cell);
            body.replaceChildren(row);
          }
          const totalEl = document.getElementById("ceo-total-payout");
          if (totalEl) totalEl.textContent = total;
          const alerts = document.getElementById("payroll-notifications");
          if (alerts) alerts.textContent = message;
          const notes = document.getElementById("payroll-notes-container");
          if (notes) notes.textContent = "";
          const exportBtn = document.getElementById("payroll-export");
          if (exportBtn) exportBtn.disabled = true;
        },

        async retryPayrollLoad() {
          this._payrollWeekList = [];
          this._payrollWeekListAt = 0;
          const id = String(document.getElementById("payroll-week-select")?.value || "");
          this._payrollLoadedWeeks.delete(id);
          // A retry re-reads the selected week even when a cached copy exists.
          this._payrollForceWeekId = id;
          return this.renderPayrollFinance();
        },

        renderPayrollFinance() {
          this._payrollRenderQueued = true;
          if (this._payrollRenderPromise) return this._payrollRenderPromise;
          this._payrollRenderPromise = (async () => {
            do {
              this._payrollRenderQueued = false;
              const select = document.getElementById("payroll-week-select");
              const retry = document.getElementById("payroll-retry");
              if (select) select.disabled = true;
              if (retry) retry.disabled = true;
              try {
                this.bindPayrollUI();
                await this.renderPayrollFinanceContent();
              } catch (error) {
                console.error("Payroll & Finance load failed:", error);
                this.getState().payrollFetchError = error;
                this.clearPayrollDisplay("Payroll is unavailable. Use Retry payroll to try again.");
                const code = String(error?.code || "");
                const message = code === "42501" || code === "PGRST301" || code === "PGRST302"
                  ? "Payroll access could not be verified. Sign in again, then retry."
                  : code === "TIMEOUT"
                    ? "The payroll request timed out. Your payroll records have not been changed. Retry payroll."
                    : "Payroll could not be loaded. Retry payroll; if this continues, check your connection or sign in again.";
                this.setPayrollLoadMessage(message + (code ? ` (${code})` : ""), true);
                // Never leave the original loading placeholder after a failed request.
                if (select && (!select.value || select.value === "latest")) {
                  const option = document.createElement("option");
                  option.value = "";
                  option.textContent = "Unable to load weeks";
                  select.replaceChildren(option);
                }
              } finally {
                if (select) select.disabled = !select.value || select.value === "latest";
                if (retry) retry.disabled = false;
              }
            } while (this._payrollRenderQueued);
          })().finally(() => { this._payrollRenderPromise = null; });
          return this._payrollRenderPromise;
        },

        async renderPayrollFinanceContent() {
          const state = this.getState();
          const weekSelect = document.getElementById("payroll-week-select");
          if (!weekSelect) return;
          const requested = String(this._payrollRequestedWeekId || weekSelect.value || "");
          this.clearPayrollDisplay("Loading payroll…");
          this.setPayrollLoadMessage("Loading payroll weeks…");
          let payrollRows = Array.isArray(state.payrollWeeklyFactView) ? state.payrollWeeklyFactView : [];
          let uniqueWeeks;
          let weekListError = null;
          try {
            uniqueWeeks = await this.loadPayrollWeekList();
          } catch (error) {
            weekListError = error;
            uniqueWeeks = [];
          }
          // Existing authorized rows can still supply period metadata if the list fails.
          if (!uniqueWeeks.length) {
            uniqueWeeks = [...new Map(payrollRows.filter(r => r.week_id && r.week_start).map(r => [String(r.week_id), {
              week_id: String(r.week_id), week_start: String(r.week_start), week_end: String(r.week_end || "")
            }])).values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
          }
          if (!uniqueWeeks.length) {
            if (weekListError) throw weekListError;
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No payroll weeks available";
            weekSelect.replaceChildren(option);
            this.clearPayrollDisplay("No payroll weeks are available for this account.");
            this.setPayrollLoadMessage("No payroll weeks are available for this account. Retry after payroll is updated.", true);
            return;
          }
          const loadedLatest = payrollRows.filter(r => r.week_id && r.week_start)
            .slice().sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)))[0];
          const now = new Date();
          const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          const selectedWeekMeta = uniqueWeeks.find(w => w.week_id === requested)
            || uniqueWeeks.find(w => w.week_id === String(loadedLatest?.week_id || ""))
            || uniqueWeeks.find(w => w.week_end && w.week_end < today)
            || uniqueWeeks.find(w => w.week_start <= today)
            || uniqueWeeks[0];
          const selectedWeekId = selectedWeekMeta.week_id;
          // Populate the selector BEFORE fetching rows, including empty payroll weeks.
          weekSelect.replaceChildren(...uniqueWeeks.map(w => {
            const option = document.createElement("option");
            option.value = w.week_id;
            option.dataset.weekStart = w.week_start;
            option.dataset.weekEnd = w.week_end;
            option.textContent = this.getPayrollWeekRangeLabel(w.week_start);
            return option;
          }));
          weekSelect.value = selectedWeekId;
          this._payrollRequestedWeekId = null;
          this.setPayrollLoadMessage("Loading the selected payroll week…");
          const force = this._payrollForceWeekId === selectedWeekId;
          this._payrollForceWeekId = null;
          const success = await this.loadPayrollWeek(selectedWeekId, selectedWeekMeta.week_start, force);
          if (!success) throw this._payrollWeekErrors?.get(selectedWeekId) || new Error("Unable to load this payroll week.");
          payrollRows = Array.isArray(state.payrollWeeklyFactView) ? state.payrollWeeklyFactView : [];
          const selectedRows = payrollRows.filter(r => String(r.week_id) === selectedWeekId);
          const workers = Array.isArray(state.payrollWorkers) ? state.payrollWorkers : [];
          const consistencyBonusRows = Array.isArray(state.payrollConsistencyBonusStatus) ? state.payrollConsistencyBonusStatus : [];
          this._currentPayrollRows = selectedRows;
          this.setPayrollLoadMessage(weekListError
            ? "The full week list is unavailable. Showing previously loaded periods; retry to refresh the list."
            : selectedRows.length ? "" : "No payroll rows were returned for this week. Choose another week or retry.",
            !!weekListError || !selectedRows.length);

''')
section('        // Payroll week dropdown list', '        bindPayrollUI() {', r'''        // Cache period metadata briefly and share concurrent requests.
        async loadPayrollWeekList() {
          if (this._payrollWeekList.length && Date.now() - (this._payrollWeekListAt || 0) < 60000) {
            return this._payrollWeekList;
          }
          if (this._payrollWeekListPromise) return this._payrollWeekListPromise;
          this._payrollWeekListPromise = (async () => {
            const client = window.portal?.supabase;
            if (!client) throw new Error("Database connection missing.");
            const rows = await this.payrollRead(client.from("payroll_weeks")
              .select("id, week_start, week_end").order("week_start", { ascending: false }), "Payroll weeks");
            this._payrollWeekList = rows.filter(r => r.id && r.week_start).map(r => ({
              week_id: String(r.id), week_start: String(r.week_start), week_end: String(r.week_end || "")
            }));
            this._payrollWeekListAt = Date.now();
            return this._payrollWeekList;
          })();
          try {
            return await this._payrollWeekListPromise;
          } finally {
            this._payrollWeekListPromise = null;
          }
        },

        async loadPayrollWeek(weekId, weekStart = null, force = false) {
          const id = String(weekId || "");
          if (!id) return false;
          this._payrollWeekRequests ||= new Map();
          this._payrollWeekErrors ||= new Map();
          if (this._payrollWeekRequests.has(id)) return this._payrollWeekRequests.get(id);
          const state = this.getState();
          const rows = Array.isArray(state.payrollWeeklyFactView) ? state.payrollWeeklyFactView : [];
          if (!force && !this._payrollWeekErrors.has(id) &&
              (this._payrollLoadedWeeks.has(id) || rows.some(r => String(r.week_id) === id))) {
            this._payrollLoadedWeeks.add(id);
            return true;
          }
          const request = (async () => {
            this._payrollLoadingWeeks.add(id);
            try {
              const client = window.portal?.supabase;
              if (!client) throw new Error("Database connection missing.");
              const newRows = await this.payrollRead(client.from("payroll_weekly_fact_v2")
                .select("*").eq("week_id", id), "Payroll week");
              // Replace ONLY this week after a successful read; preserve all history on errors.
              const existing = Array.isArray(state.payrollWeeklyFactView) ? state.payrollWeeklyFactView : [];
              state.payrollWeeklyFactView = existing.filter(r => String(r.week_id) !== id).concat(newRows);
              this._payrollLoadedWeeks.add(id); // Empty successes are cached too.
              this._payrollWeekErrors.delete(id);
              state.payrollFetchError = null;
              return true;
            } catch (error) {
              console.error("Payroll week load failed:", error);
              this._payrollWeekErrors.set(id, error);
              state.payrollFetchError = error;
              return false;
            } finally {
              this._payrollLoadingWeeks.delete(id);
            }
          })();
          this._payrollWeekRequests.set(id, request);
          try {
            return await request;
          } finally {
            this._payrollWeekRequests.delete(id);
          }
        },

''')
section('          //Payroll Dropdown event', '          const noteInput =', r'''          const sel = document.getElementById("payroll-week-select");
          if (sel) {
            sel.addEventListener("change", () => {
              this._payrollRequestedWeekId = String(sel.value || "");
              this.renderPayrollFinance();
            });
          }
          document.getElementById("payroll-retry")?.addEventListener("click", () => this.retryPayrollLoad());

''')
assert text.count('          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">\n') == 1
text = text.replace('          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">\n', '          <div id="payroll-load-status" hidden role="status" aria-live="polite" class="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">\n            <span id="payroll-load-message"></span>\n            <button id="payroll-retry" type="button" hidden class="ml-3 rounded-lg border border-blue-300 bg-white px-3 py-2 font-bold disabled:opacity-50">Retry payroll</button>\n          </div>\n          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">\n', 1)
assert text.count('          this.bindExportCSV(selectedWeekMeta?.week_start || selectedWeekId, processedAgents);') == 1
text = text.replace('          this.bindExportCSV(selectedWeekMeta?.week_start || selectedWeekId, processedAgents);', '          this.bindExportCSV(selectedWeekMeta?.week_start || selectedWeekId, processedAgents);\n          document.getElementById("payroll-export").disabled = !processedAgents.length;', 1)
assert text.count('main.js?v=20260601-1') == 1
text = text.replace('main.js?v=20260601-1', 'main.js?v=20261012-payroll-loading', 1)
p.write_text(text)
print("Applied payroll-loading repair; payroll formulas and authentication are unchanged.")
