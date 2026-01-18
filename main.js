// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
  constructor() {
    this.currentUser = null;
    this.leadsData = [];
    this.employeeList = [];
    this.filteredLeads = [];
    this.currentFilter = 'this-week';

    // ✅ NEW (optional TL/admin datasets from n8n)
    this.weeklyPayroll = [];
    this.timeTracker = [];

    this.charts = {
      appointments: null,
      incentives: null
    };

    this.webhooks = {
      login: 'https://automate.callhammerleads.com/webhook/agent-login',
      fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data',
      timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
      changePassword: 'https://automate.callhammerleads.com/webhook/change-password',
      manageEmployee: 'https://automate.callhammerleads.com/webhook/manage-employee'
    };

    this.init();
  }

  init() {
    this.checkExistingSession();
    this.enforceRoleRouting(); // ✅ NEW (prevents wrong page access)
    this.bindEvents();

    // ✅ MST clock (only shows if HTML has #mst-clock)
    this.startMSTClock();

    if (this.currentUser && window.location.pathname.includes('dashboard')) {
      this.fetchAllData();
      this.updateProfileUI();

      if (this.currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      } else if (this.currentUser.role === 'team_leader') {
        document.querySelectorAll('.tl-only').forEach(el => el.classList.remove('hidden'));
      }
    }
  }

  // ✅ NEW: Role-based routing guard (minimal, non-breaking)
  enforceRoleRouting() {
    if (!this.currentUser) return;

    const path = (window.location.pathname || '').toLowerCase();
    const role = (this.currentUser.role || 'agent').toLowerCase();

    const onAdmin = path.includes('admin-dashboard');
    const onAgent = path.includes('agent-dashboard');
    const onTL = path.includes('team-leader-dashboard');
    const onAnyDashboard = path.includes('dashboard');

    if (!onAnyDashboard) return;

    if (role === 'admin' && !onAdmin) window.location.href = 'admin-dashboard.html';
    else if (role === 'team_leader' && !onTL) window.location.href = 'team-leader-dashboard.html';
    else if (role === 'agent' && !onAgent) window.location.href = 'agent-dashboard.html';
  }

  // ------------------------
  // Helpers
  // ------------------------
  normalizeKey(obj, key) {
    if (!obj) return '';
    const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return foundKey ? obj[foundKey] : '';
  }

  // ✅ FIXED: robust parsing (uses lead's Date Submitted only; supports Google Sheets serial numbers)
  parseDateSafe(value) {
    if (value === null || value === undefined || value === '') return null;

    // If Google Sheets sends a number (serial date)
    // Google Sheets serial: days since 1899-12-30
    if (typeof value === 'number' && isFinite(value)) {
      const ms = Math.round((value - 25569) * 86400 * 1000); // 25569 = days from 1899-12-30 to 1970-01-01
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }

    // If it’s numeric string serial
    const str = value.toString().trim();
    if (/^\d+(\.\d+)?$/.test(str)) {
      const num = parseFloat(str);
      if (isFinite(num)) {
        const ms = Math.round((num - 25569) * 86400 * 1000);
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    // Normal date parsing
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  formatDateShort(d) {
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // --- Payroll Week Calculation (Saturday to Friday MST) ---
  getPayrollWeekRange() {
    const now = new Date();
    const mstOffset = -7 * 60;
    const localOffset = now.getTimezoneOffset();
    const mstNow = new Date(now.getTime() + (mstOffset + localOffset) * 60000);

    const dayOfWeek = mstNow.getDay(); // Sun=0 ... Sat=6
    const start = new Date(mstNow);
    const diffToSat = (dayOfWeek === 6) ? 0 : (dayOfWeek + 1);

    start.setDate(mstNow.getDate() - diffToSat);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  // ✅ NEW: Previous payroll week range (Sat–Fri MST, strictly Date Submitted based)
  getPreviousPayrollWeekRange() {
    const current = this.getPayrollWeekRange();
    const start = new Date(current.start);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);

    const end = new Date(current.end);
    end.setDate(end.getDate() - 7);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  // Convert a Date to MST wall-clock (as a Date object shifted from local time)
  toMST(date) {
    const d = new Date(date);
    const mstOffset = -7 * 60;
    const localOffset = d.getTimezoneOffset();
    return new Date(d.getTime() + (mstOffset + localOffset) * 60000);
  }

  // Payroll week start for a given date (Saturday 00:00 MST)
  getPayrollWeekStart(date) {
    const mstDate = this.toMST(date);
    const dayOfWeek = mstDate.getDay(); // Sun=0 ... Sat=6
    const start = new Date(mstDate);
    const diffToSat = (dayOfWeek === 6) ? 0 : (dayOfWeek + 1);
    start.setDate(mstDate.getDate() - diffToSat);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  getPayrollWeekKey(date) {
    const start = this.getPayrollWeekStart(date);
    return start.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  }

  // Status helpers (Confirmed-only counting for incentives / performance)
  isConfirmedStatus(status) {
    const s = (status || '').toString().trim().toLowerCase();
    return s === 'confirmed';
  }

  isCancelledLikeStatus(status) {
    const s = (status || '').toString().toLowerCase();
    return s.includes('cancel') || s.includes('credited') || s.includes('rejected') || s.includes('declined');
  }

  // ------------------------
  // MST Clock (bottom-left in sidebar if element exists)
  // ------------------------
  startMSTClock() {
    const el = document.getElementById('mst-clock');
    if (!el) return;

    const pad = (n) => (n < 10 ? '0' + n : '' + n);

    const tick = () => {
      const now = new Date();
      const mstNow = this.toMST(now);

      let h = mstNow.getHours();
      const m = mstNow.getMinutes();
      const s = mstNow.getSeconds();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;

      el.textContent = `${pad(h)}:${pad(m)}:${pad(s)} ${ampm} MST`;
    };

    tick();
    setInterval(tick, 1000);
  }

  // ------------------------
  // Data Fetch
  // ------------------------
  async fetchAllData() {
    if (!this.currentUser) return;

    try {
      const response = await fetch(this.webhooks.fetchData, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.currentUser.email,
          role: this.currentUser.role
        })
      });

      const result = await response.json();

      if (result.status === "success") {
        this.leadsData = Array.isArray(result.leads) ? result.leads : [];
        this.employeeList = Array.isArray(result.employeeList) ? result.employeeList : [];

        // ✅ NEW (optional datasets if backend sends them)
        this.weeklyPayroll = Array.isArray(result.weeklyPayroll) ? result.weeklyPayroll : [];
        this.timeTracker = Array.isArray(result.timeTracker) ? result.timeTracker : [];

        // ✅ Update profile from AGENT_MASTER real-time (if provided)
        if (result.profile) {
          const p = result.profile;

          this.currentUser = {
            ...this.currentUser,
            name: p['Employee Name'] || this.currentUser.name,
            email: p['Email'] || this.currentUser.email,
            role: (p['Role'] || this.currentUser.role || 'agent').toLowerCase(),
            baseRate: p['Base Rate'] || this.currentUser.baseRate,
            weeklyHours: p['Weekly Hours'] || this.currentUser.weeklyHours,
            startDate: p['Start Date'] || this.currentUser.startDate,
            position: p['Position'] || this.currentUser.position,
            managerEmail: p['Manager_Email'] || p['Manager Email'] || this.currentUser.managerEmail,
            employmentStatus: p['Employment_Status'] || p['Employment Status'] || this.currentUser.employmentStatus,
            paymentStatus: p['Payment Status'] || this.currentUser.paymentStatus
          };

          const session = localStorage.getItem('callHammerSession');
          if (session) {
            const s = JSON.parse(session);
            s.user = this.currentUser;
            localStorage.setItem('callHammerSession', JSON.stringify(s));
          }

          this.updateProfileUI();

          // ✅ NEW: if role changes in sheet, enforce correct page
          this.enforceRoleRouting();
        }

        if (result.timeOffHistory) {
          this.renderTimeOffHistory(result.timeOffHistory);
        }

        // Refresh UI for selected filter
        this.handleFilterChange(this.currentFilter);

        // Build charts after we have data
        this.updateCharts();

        // ✅ NEW: Optional external dashboards refresh (safe if unused)
        if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
          window.adminDashboard.refreshDashboard();
        }
        if (window.teamLeadDashboard && typeof window.teamLeadDashboard.refresh === 'function') {
          window.teamLeadDashboard.refresh();
        }
      }
    } catch (error) {
      console.error('Data Sync Error:', error);
    }
  }

  // ------------------------
  // Incentives (CONFIRMED-based; $50 triggers at 6th only)
  // ------------------------
  calculateIncentives(confirmedN, cancelRate) {
    const isHighPerf = cancelRate < 25;
    let total = 0;

    // Base flat bonus at 6th confirmed (not per appointment 1–6)
    if (confirmedN >= 6) total += 50;

    // 7th confirmed: no additional bonus
    // 8th confirmed: add tier bonus
    if (confirmedN >= 8) total += isHighPerf ? 50 : 30;

    // 9th–12th confirmed: add per appointment
    if (confirmedN >= 9) {
      const count9to12 = Math.min(confirmedN, 12) - 8; // 9..12 => 1..4
      total += count9to12 * (isHighPerf ? 17 : 15);
    }

    // 13th+ confirmed: add per appointment above 12
    if (confirmedN >= 13) {
      total += (confirmedN - 12) * (isHighPerf ? 27 : 25);
    }

    return total;
  }

  // ------------------------
  // Weekly performance summaries (Payroll week, MST Sat–Fri)
  // ------------------------
  buildPayrollWeekBucketsFromLeads(leads) {
    const getVal = (obj, key) => this.normalizeKey(obj, key) || '';
    const buckets = {};

    for (const lead of leads) {
      // ✅ STRICT: Date Submitted only
      const date = this.parseDateSafe(getVal(lead, 'Date Submitted'));
      if (!date) continue;

      const weekKey = this.getPayrollWeekKey(date);
      if (!buckets[weekKey]) {
        buckets[weekKey] = {
          weekKey,
          weekStart: this.getPayrollWeekStart(date),
          submitted: 0,
          confirmed: 0,
          cancelled: 0,
          cancelRate: 0,
          incentives: 0
        };
      }

      const status = getVal(lead, 'Status');
      buckets[weekKey].submitted += 1;
      if (this.isConfirmedStatus(status)) buckets[weekKey].confirmed += 1;
      if (this.isCancelledLikeStatus(status)) buckets[weekKey].cancelled += 1;
    }

    // finalize
    for (const k of Object.keys(buckets)) {
      const w = buckets[k];
      w.cancelRate = w.submitted > 0 ? (w.cancelled / w.submitted) * 100 : 0;
      w.incentives = this.calculateIncentives(w.confirmed, w.cancelRate);
    }

    return buckets;
  }

  // Monthly Incentive ($100): last 4 payroll weeks, need 3/4 weeks meeting:
  // confirmed >= 8 AND cancelRate < 25
  computeMonthlyIncentiveStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const keys = Object.keys(buckets).sort((a, b) => (buckets[a].weekStart - buckets[b].weekStart)); // newest first
    const last4 = keys.slice(0, 4).map(k => buckets[k]);

    const hits = last4.filter(w => w.confirmed >= 8 && w.cancelRate < 25).length;
    const qualified = last4.length === 4 ? hits >= 3 : false;

    return {
      qualified,
      hits,
      weeksConsidered: last4.length,
      needed: 3
    };
  }

  // Monthly Raffle ($250): accumulate 4 eligible weeks (not necessarily consecutive):
  // confirmed >= 8 AND cancelRate < 20
  computeMonthlyRaffleStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const weeks = Object.values(buckets).sort((a, b) => a.weekStart - b.weekStart); // oldest -> newest

    const eligibleWeeks = weeks.filter(w => w.confirmed >= 8 && w.cancelRate < 20);
    const totalEligibleWeeks = eligibleWeeks.length;

    const entriesEarned = Math.floor(totalEligibleWeeks / 4);
    const progress = totalEligibleWeeks % 4;

    const lastEligibleWeek = eligibleWeeks.length ? eligibleWeeks[eligibleWeeks.length - 1] : null;

    const now = new Date();
    const eligibleNow =
      totalEligibleWeeks >= 4 &&
      progress === 0 &&
      lastEligibleWeek &&
      lastEligibleWeek.weekStart.getMonth() === now.getMonth() &&
      lastEligibleWeek.weekStart.getFullYear() === now.getFullYear();

    return {
      eligibleNow,
      progress,
      needed: 4,
      entriesEarned
    };
  }

  // Milestones: 90-day and 1-year based on "75% of all-time weekly record"
  computeMilestoneStatus() {
    const startDate = this.parseDateSafe(this.currentUser?.startDate);
    if (!startDate) {
      return {
        hasStartDate: false,
        daysEmployed: 0,
        increases: { ninetyDay: 0, oneYear: 0, total: 0 },
        ninetyDay: { eligible: false, standardMet: false, highMet: false },
        oneYear: { eligible: false, standardMet: false, highMet: false, graceActive: false, graceEnds: null }
      };
    }

    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysEmployed = Math.floor((now.getTime() - startDate.getTime()) / msPerDay);

    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);

    const firstWeekStart = this.getPayrollWeekStart(startDate);
    const currentWeekStart = this.getPayrollWeekStart(now);

    const weeks = [];
    for (let d = new Date(firstWeekStart); d <= currentWeekStart; d.setDate(d.getDate() + 7)) {
      const wkStart = new Date(d);
      const key = wkStart.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      const existing = Object.values(buckets).find(b => {
        return b.weekStart && b.weekStart.getFullYear() === wkStart.getFullYear() &&
          b.weekStart.getMonth() === wkStart.getMonth() &&
          b.weekStart.getDate() === wkStart.getDate();
      });

      weeks.push(existing || {
        weekKey: key,
        weekStart: new Date(wkStart),
        submitted: 0,
        confirmed: 0,
        cancelled: 0,
        cancelRate: 0,
        incentives: 0
      });
    }

    const totalWeeks = weeks.length || 1;

    const standardHits = weeks.filter(w => w.confirmed >= 8).length;
    const highHits = weeks.filter(w => w.confirmed >= 8 && w.cancelRate < 25).length;

    const standardMet = (standardHits / totalWeeks) >= 0.75;
    const highMet = (highHits / totalWeeks) >= 0.75;

    const ninetyEligible = daysEmployed >= 90;
    const ninetyIncrease = ninetyEligible ? (highMet ? 0.75 : (standardMet ? 0.50 : 0)) : 0;

    const oneYearEligible = daysEmployed >= 365;
    const oneYearStandardMet = standardMet;
    const oneYearHighMet = highMet;

    const graceActive = oneYearEligible && oneYearStandardMet && !oneYearHighMet && daysEmployed < (365 + 90);
    const graceEnds = graceActive ? new Date(startDate.getTime() + (365 + 90) * msPerDay) : null;

    let oneYearIncrease = 0;
    if (oneYearEligible) {
      if (oneYearStandardMet) {
        oneYearIncrease = oneYearHighMet ? 1.50 : 0.75;
      }
    }

    const totalIncrease = (ninetyIncrease || 0) + (oneYearIncrease || 0);

    return {
      hasStartDate: true,
      daysEmployed,
      increases: {
        ninetyDay: ninetyIncrease,
        oneYear: oneYearIncrease,
        total: totalIncrease
      },
      ninetyDay: {
        eligible: ninetyEligible,
        standardMet,
        highMet
      },
      oneYear: {
        eligible: oneYearEligible,
        standardMet: oneYearStandardMet,
        highMet: oneYearHighMet,
        graceActive,
        graceEnds: graceEnds ? this.formatDateShort(graceEnds) : null
      }
    };
  }

  // ------------------------
  // Dashboard UI
  // ------------------------
  updateDashboardUI(leads) {
    const getVal = (obj, key) => this.normalizeKey(obj, key) || '';

    // Payroll week incentives always use payroll week (Saturday–Friday MST)
    const payrollRange = this.getPayrollWeekRange();
    const payrollLeads = this.leadsData.filter(l => {
      // ✅ STRICT: Date Submitted only
      const subDate = this.parseDateSafe(getVal(l, 'Date Submitted'));
      return subDate && subDate >= payrollRange.start && subDate <= payrollRange.end;
    });

    const payrollConfirmed = payrollLeads.filter(l => this.isConfirmedStatus(getVal(l, 'Status')));

    const payrollTotal = payrollLeads.length;
    const payrollCancelled = payrollLeads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;

    const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;

    const currentIncentives = this.calculateIncentives(payrollConfirmed.length, payrollCancelRate);

    // ✅ Total appointments for the selected timeframe (already filtered by Date Submitted)
    const totalRaw = leads.length;
    const cancelledCount = leads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;

    const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : "0.0";

    if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
    if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
    if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(currentIncentives);

    if (document.getElementById('stat-hours')) document.getElementById('stat-hours').textContent = this.currentUser?.weeklyHours || 0;

    const progressBar = document.getElementById('tier-progress-bar');
    const tierText = document.getElementById('tier-status-text');
    const tierCountDisplay = document.getElementById('tier-count-display');

    if (progressBar && tierText && tierCountDisplay) {
      const confirmed = payrollConfirmed.length;

      let nextGoal = 6;
      if (confirmed >= 6 && confirmed < 8) nextGoal = 8;
      else if (confirmed >= 8 && confirmed < 12) nextGoal = 12;
      else if (confirmed >= 12 && confirmed < 13) nextGoal = 13;
      else if (confirmed >= 13) nextGoal = 13;

      const pct = nextGoal > 0 ? Math.min((confirmed / nextGoal) * 100, 100) : 0;
      progressBar.style.width = `${pct}%`;

      tierText.textContent = `Cycle: ${this.formatDateShort(payrollRange.start)} - ${this.formatDateShort(payrollRange.end)}`;
      tierCountDisplay.textContent = `${confirmed} / ${nextGoal} confirmed (This Payroll Week)`;

      const noteEl = document.getElementById('tier-note-7th');
      if (noteEl) noteEl.textContent = "Note: 7th confirmed appointment has no additional bonus.";
    }

    const monthly = this.computeMonthlyIncentiveStatus();
    const raffle = this.computeMonthlyRaffleStatus();
    const milestone = this.computeMilestoneStatus();

    const monthlyEl = document.getElementById('monthly-incentive-status');
    if (monthlyEl) {
      monthlyEl.textContent = monthly.weeksConsidered === 4
        ? (monthly.qualified ? `Qualified ($100) — ${monthly.hits}/4 weeks met` : `Not qualified — ${monthly.hits}/4 weeks met (need 3/4)`)
        : `Not enough data — ${monthly.hits}/${monthly.weeksConsidered} weeks met (need 4 weeks tracked)`;
    }

    const raffleEl = document.getElementById('monthly-raffle-status');
    if (raffleEl) {
      if (raffle.eligibleNow) {
        raffleEl.textContent = `Eligible for Monthly Raffle ($250) — entry earned (cycle reset after entry)`;
      } else {
        raffleEl.textContent = `Raffle progress: ${raffle.progress}/${raffle.needed} eligible weeks (Entries earned: ${raffle.entriesEarned})`;
      }
    }

    const increaseEl = document.getElementById('milestone-hourly-increase');
    if (increaseEl) {
      if (!milestone.hasStartDate) {
        increaseEl.textContent = `Hourly Increase: N/A (missing start date)`;
      } else {
        increaseEl.textContent = `Hourly Increase: +$${(milestone.increases.total || 0).toFixed(2)}/hr`;
      }
    }

    const effectiveRateEl = document.getElementById('effective-hourly-rate');
    if (effectiveRateEl) {
      const base = parseFloat(this.currentUser?.baseRate || 0) || 0;
      const eff = base + (milestone.increases.total || 0);
      effectiveRateEl.textContent = this.formatCurrency(eff);
    }

    const graceEl = document.getElementById('milestone-grace-status');
    if (graceEl) {
      if (milestone.oneYear?.graceActive) {
        graceEl.textContent = `Grace period active — ends ${milestone.oneYear.graceEnds} (improve cancellation rate to qualify for high performance increase)`;
      } else {
        graceEl.textContent = '';
      }
    }

    this.renderLeadsTable(leads);
  }

  // ------------------------
  // Leads Table + Status Filter
  // ------------------------
  renderLeadsTable(leads) {
    const body = document.getElementById('leads-table-body');
    if (!body) return;

    body.innerHTML = leads.map(l => {
      const date = l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted') || 'N/A';
      const homeowner = l['Homeowner Name(s)'] || l['Homeowner Name'] || this.normalizeKey(l, 'Homeowner Name(s)') || 'N/A';
      const status = l['Status'] || this.normalizeKey(l, 'Status') || 'Pending';

      return `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 text-sm text-gray-600">${date}</td>
          <td class="px-6 py-4 font-bold text-gray-900">${homeowner}</td>
          <td class="px-6 py-4">
            <span class="px-3 py-1 rounded-full text-xs font-bold ${this.getStatusStyle(status)} uppercase">
              ${status}
            </span>
          </td>
        </tr>
      `;
    }).join('') || `<tr><td class="px-6 py-6 text-sm text-gray-500" colspan="3">No leads found.</td></tr>`;
  }

  getStatusStyle(status) {
    const s = (status || '').toLowerCase();
    if (s === 'approved') return 'bg-gree
