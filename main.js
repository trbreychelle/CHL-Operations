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

    if (this.currentUser && window.location.pathname.includes('dashboard')) {
      this.fetchAllData();
      this.updateProfileUI();
            this.startMSTClock();


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

  parseDateSafe(value) {
    if (!value) return null;
    // Handles: "2026-01-06", "1/6/2026", "Jan 6, 2026"
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  formatDateShort(d) {
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
    // --- MST Clock Helpers ---
  formatMSTTime(date = new Date()) {
    const mst = this.toMST(date);
    return mst.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  startMSTClock() {
    const el = document.getElementById('mst-clock');
    if (!el) return;

    const tick = () => {
      el.textContent = `${this.formatMSTTime()} MST`;
    };

    tick();
    clearInterval(this._mstClockInterval);
    this._mstClockInterval = setInterval(tick, 1000);
  }
    // ------------------------
  // Weekly Payroll -> Worked Hours (MST Sat–Fri)
  // ------------------------
  getPayrollWeekRangeFor(date) {
    const mstDate = this.toMST(date);
    const dayOfWeek = mstDate.getDay(); // Sun=0 ... Sat=6
    const start = new Date(mstDate);
    const diffToSat = (dayOfWeek === 6) ? 0 : (dayOfWeek + 1);
    start.setDate(mstDate.getDate() - diffToSat);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  getPreviousPayrollWeekRange() {
    const cur = this.getPayrollWeekRange();
    const start = new Date(cur.start); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
    const end = new Date(cur.end); end.setDate(end.getDate() - 7); end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  computeWorkedHoursFromWeeklyPayroll(rangeStart, rangeEnd) {
    const rows = Array.isArray(this.weeklyPayroll) ? this.weeklyPayroll : [];
    if (!rows.length || !this.currentUser) return 0;

    const get = (obj, key) => this.normalizeKey(obj, key) || '';

    // Identify current user by email primarily, fallback to name
    const myEmail = (this.currentUser.email || '').toLowerCase().trim();
    const myName = (this.currentUser.name || '').toLowerCase().trim();

    const parseHours = (v) => {
      const n = parseFloat((v || '').toString().replace(/[^\d.]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    let total = 0;

    for (const r of rows) {
      const rowEmail = (get(r, 'Email') || get(r, 'Agent Email') || get(r, 'Employee Email') || '').toLowerCase().trim();
      const rowName = (get(r, 'Agent Name') || get(r, 'Employee Name') || get(r, 'Name') || '').toLowerCase().trim();

      const matchesUser = (myEmail && rowEmail && myEmail === rowEmail) || (!!myName && !!rowName && rowName.includes(myName));
      if (!matchesUser) continue;

      // Date field candidates (weekly payroll often has a work date or a week start)
      const dateVal =
        get(r, 'Work Date') ||
        get(r, 'Date') ||
        get(r, 'Day') ||
        get(r, 'Payroll Date') ||
        get(r, 'Week Start') ||
        get(r, 'Week Of') ||
        '';

      const d = this.parseDateSafe(dateVal);
      if (!d) continue;

      // Check date is within the requested payroll range (use MST-adjusted comparison)
      const mstD = this.toMST(d);
      if (mstD < rangeStart || mstD > rangeEnd) continue;

      // Hours candidates
      const hoursVal =
        get(r, 'Hours Worked') ||
        get(r, 'Hours') ||
        get(r, 'Total Hours') ||
        get(r, 'Worked Hours') ||
        get(r, 'Weekly Hours Worked') ||
        '';

      total += parseHours(hoursVal);
    }

    return total;
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
  // Once 4 weeks are accumulated, eligibility is reached and progress resets (cycle-based).
  // Since backend reset/join tracking isn't shown in this file, we compute cycle progress from all-time eligible weeks.
  computeMonthlyRaffleStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const weeks = Object.values(buckets).sort((a, b) => a.weekStart - b.weekStart); // oldest -> newest

    const eligibleWeeks = weeks.filter(w => w.confirmed >= 8 && w.cancelRate < 20);
    const totalEligibleWeeks = eligibleWeeks.length;

    const entriesEarned = Math.floor(totalEligibleWeeks / 4);
    const progress = totalEligibleWeeks % 4;

    const lastEligibleWeek = eligibleWeeks.length ? eligibleWeeks[eligibleWeeks.length - 1] : null;

    // Optional: "eligible now" when they just hit a multiple of 4 and the latest eligible week is in the current month
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

    // Build payroll-week timeline from startDate week to current week
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);

    const firstWeekStart = this.getPayrollWeekStart(startDate);
    const currentWeekStart = this.getPayrollWeekStart(now);

    const weeks = [];
    for (let d = new Date(firstWeekStart); d <= currentWeekStart; d.setDate(d.getDate() + 7)) {
      const wkStart = new Date(d);
      const key = wkStart.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      const existing = Object.values(buckets).find(b => {
        // match by date value (not label only)
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

    // 90-day milestone
    const ninetyEligible = daysEmployed >= 90;
    const ninetyIncrease = ninetyEligible ? (highMet ? 0.75 : (standardMet ? 0.50 : 0)) : 0;

    // 1-year milestone
    const oneYearEligible = daysEmployed >= 365;
    const oneYearStandardMet = standardMet; // same definition
    const oneYearHighMet = highMet;

    // grace period: 90 days after 1-year mark if standard met but high not met
    const graceActive = oneYearEligible && oneYearStandardMet && !oneYearHighMet && daysEmployed < (365 + 90);
    const graceEnds = graceActive ? new Date(startDate.getTime() + (365 + 90) * msPerDay) : null;

    // 1-year increase component (additional on top of 90-day increase)
    // Standard: +0.75
    // High: +1.50
    // Grace: if later qualifies high within grace, can upgrade from +0.75 to +1.50
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
      const subDate = this.parseDateSafe(getVal(l, 'Date Submitted'));
      return subDate && subDate >= payrollRange.start && subDate <= payrollRange.end;
    });

    // ✅ Confirmed for incentives
    const payrollConfirmed = payrollLeads.filter(l => this.isConfirmedStatus(getVal(l, 'Status')));

    // Cancel Rate (Payroll week)
    const payrollTotal = payrollLeads.length;
    const payrollCancelled = payrollLeads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;

    const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;

    // ✅ Incentives shown in card = Payroll week incentives (Confirmed-based)
    const currentIncentives = this.calculateIncentives(payrollConfirmed.length, payrollCancelRate);

    // Stats reflect selected timeframe
    const totalRaw = leads.length;
    const cancelledCount = leads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;

    const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : "0.0";

    if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
    if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
    if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(currentIncentives);

    // Weekly hours from AGENT_MASTER
    if (document.getElementById('stat-hours')) document.getElementById('stat-hours').textContent = this.currentUser?.weeklyHours || 0;

    // ✅ Tier progress (based on payroll-week confirmed)
    const progressBar = document.getElementById('tier-progress-bar');
    const tierText = document.getElementById('tier-status-text');
    const tierCountDisplay = document.getElementById('tier-count-display');

    if (progressBar && tierText && tierCountDisplay) {
      const confirmed = payrollConfirmed.length;

      // Next tier goal: 6 -> 8 -> 12 -> 13 (then keep 13 as milestone)
      let nextGoal = 6;
      if (confirmed >= 6 && confirmed < 8) nextGoal = 8;
      else if (confirmed >= 8 && confirmed < 12) nextGoal = 12;
      else if (confirmed >= 12 && confirmed < 13) nextGoal = 13;
      else if (confirmed >= 13) nextGoal = 13;

      const pct = nextGoal > 0 ? Math.min((confirmed / nextGoal) * 100, 100) : 0;
      progressBar.style.width = `${pct}%`;

      tierText.textContent = `Cycle: ${this.formatDateShort(payrollRange.start)} - ${this.formatDateShort(payrollRange.end)}`;
      tierCountDisplay.textContent = `${confirmed} / ${nextGoal} confirmed (This Payroll Week)`;

      // Optional note for appointment #7 = $0
      const noteEl = document.getElementById('tier-note-7th');
      if (noteEl) noteEl.textContent = "Note: 7th confirmed appointment has no additional bonus.";
    }

    // ✅ Monthly incentive + raffle + milestones (display if elements exist)
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

    // Leads table
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
    if (s === 'approved') return 'bg-green-100 text-green-700';
    if (s === 'confirmed') return 'bg-green-100 text-green-700';
    if (s.includes('cancel') || s.includes('reject') || s.includes('credited') || s.includes('declined')) return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  }

  // ------------------------
  // Time Off History (Dates + Status)
  // ------------------------
  renderTimeOffHistory(history) {
    const container = document.getElementById('timeoff-history-list');
    if (!container) return;

    const rows = Array.isArray(history) ? history : [];

    // Sort newest first if possible
    rows.sort((a, b) => {
      const ad = this.parseDateSafe(a['Start Date'] || a.startDate) || new Date(0);
      const bd = this.parseDateSafe(b['Start Date'] || b.startDate) || new Date(0);
      return bd - ad;
    });

    container.innerHTML = rows.map(req => {
      const start = req['Start Date'] || req.startDate || '';
      const end = req['End Date'] || req.endDate || '';
      const reason = req['Reason'] || req.Reason || req.reason || 'Leave Request';
      const status = (req['Status'] || req.status || 'Pending').toString();

      const badge = (() => {
        const s = status.toLowerCase();
        if (s.includes('approve')) return 'bg-green-100 text-green-700';
        if (s.includes('decline') || s.includes('reject')) return 'bg-red-100 text-red-700';
        return 'bg-yellow-100 text-yellow-700';
      })();

      return `
        <div class="p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[10px] font-bold text-gray-400 uppercase">${start} — ${end}</span>
            <span class="px-2 py-1 rounded-full text-[10px] font-bold ${badge}">${status}</span>
          </div>
          <p class="text-xs text-gray-700 font-semibold">${reason}</p>
        </div>
      `;
    }).join('') || `<p class="text-xs text-gray-400 italic">No history found.</p>`;
  }

  // ------------------------
  // Filters
  // ------------------------
  handleFilterChange(value) {
    this.currentFilter = value;
    const now = new Date();
    let filtered = this.leadsData;

    if (value === 'this-week') {
      const range = this.getPayrollWeekRange();
      filtered = this.leadsData.filter(l => {
        const d = this.parseDateSafe(l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted'));
        return d && d >= range.start && d <= range.end;
      });
    } else if (value === '30-days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      filtered = this.leadsData.filter(l => {
        const d = this.parseDateSafe(l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted'));
        return d && d >= thirtyDaysAgo;
      });
    } else if (value === '4-weeks') {
      const d0 = new Date();
      d0.setDate(now.getDate() - 28);
      filtered = this.leadsData.filter(l => {
        const d = this.parseDateSafe(l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted'));
        return d && d >= d0;
      });
    } else if (value === '6-weeks') {
      const d0 = new Date();
      d0.setDate(now.getDate() - 42);
      filtered = this.leadsData.filter(l => {
        const d = this.parseDateSafe(l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted'));
        return d && d >= d0;
      });
    } else if (value === 'all-time') {
      filtered = this.leadsData;
    }

    // ✅ keep filteredLeads updated for status filter dropdown usage
    this.filteredLeads = filtered;

    this.updateDashboardUI(filtered);
    this.updateCharts(); // refresh charts when filter changes
  }

  // ------------------------
  // Charts (ECharts)
  // ------------------------
  updateCharts() {
    const chartA = document.getElementById('appointmentsChart');
    const chartI = document.getElementById('incentivesChart');
    if (!chartA || !chartI) return;

    // Init charts once
    if (!this.charts.appointments) this.charts.appointments = echarts.init(chartA);
    if (!this.charts.incentives) this.charts.incentives = echarts.init(chartI);

    // Build weekly buckets for last 8 weeks (Payroll weeks)
    const buckets = this.buildWeeklyBuckets(8);

    // Fill buckets based on leadsData
    for (const lead of this.leadsData) {
      const date = this.parseDateSafe(lead['Date Submitted'] || this.normalizeKey(lead, 'Date Submitted'));
      if (!date) continue;

      const weekKey = this.getWeekKey(date);
      if (!buckets[weekKey]) continue;

      const status = (lead['Status'] || this.normalizeKey(lead, 'Status') || '').toString().toLowerCase();

      buckets[weekKey].submitted += 1;

      if (status === 'confirmed') buckets[weekKey].confirmed += 1;
      if (status.includes('cancel') || status.includes('reject') || status.includes('declined') || status.includes('credited')) buckets[weekKey].cancelled += 1;
    }

    // Compute incentives per week (Confirmed-based)
    for (const k of Object.keys(buckets)) {
      const week = buckets[k];
      const cancelRate = week.submitted > 0 ? (week.cancelled / week.submitted) * 100 : 0;
      week.incentives = this.calculateIncentives(week.confirmed, cancelRate);
    }

    const labels = Object.keys(buckets).sort(); // oldest -> newest
    const confirmedSeries = labels.map(k => buckets[k].confirmed);
    const submittedSeries = labels.map(k => buckets[k].submitted);
    const incentiveSeries = labels.map(k => buckets[k].incentives);

    // Appointment Trends chart
    this.charts.appointments.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [
        { name: 'Submitted', type: 'line', data: submittedSeries, smooth: true },
        { name: 'Confirmed', type: 'line', data: confirmedSeries, smooth: true }
      ]
    }, true);

    // Incentive Trends chart
    this.charts.incentives.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [
        { name: 'Incentives', type: 'bar', data: incentiveSeries }
      ]
    }, true);

    // Resize on window resize
    window.addEventListener('resize', () => {
      this.charts?.appointments?.resize();
      this.charts?.incentives?.resize();
    });
  }

  buildWeeklyBuckets(weeksBack = 8) {
    // Creates keys like "Dec 01" (week start)
    const out = {};
    const now = new Date();

    for (let w = weeksBack - 1; w >= 0; w--) {
      const d = new Date(now);
      d.setDate(d.getDate() - (w * 7));
      const start = this.getWeekStart(d);
      const label = start.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      out[label] = { submitted: 0, confirmed: 0, cancelled: 0, incentives: 0 };
    }
    return out;
  }

  getWeekStart(d) {
    // Payroll week start = Saturday MST
    return this.getPayrollWeekStart(d);
  }

  getWeekKey(d) {
    return this.getPayrollWeekKey(d);
  }

  // ------------------------
  // Profile
  // ------------------------
  updateProfileUI() {
    if (!this.currentUser) return;
    const u = this.currentUser;

    const map = {
      'profileName': u.name || 'N/A',
      'profileEmail': u.email || 'N/A',
      'profilePosition': (u.position || u.role || 'Agent'),
      'profileRate': this.formatCurrency(u.baseRate),
      'nav-user-name': u.name || 'Loading...',
      'nav-user-role': (u.role || 'agent').toUpperCase(),
      'stat-hours': u.weeklyHours || 0,
      'profileHours': u.weeklyHours || 0,
      'profileStartDate': u.startDate || 'N/A'
    };

    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }

    // ✅ Optional: milestone/effective rate display (if IDs exist in HTML)
    const milestone = this.computeMilestoneStatus();

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
      const base = parseFloat(u.baseRate || 0) || 0;
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

    // ✅ Optional: monthly displays (if IDs exist in HTML)
    const monthly = this.computeMonthlyIncentiveStatus();
    const raffle = this.computeMonthlyRaffleStatus();

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
  }

  // ------------------------
  // Auth / Session
  // ------------------------
  async login(email, password) {
    try {
      const res = await fetch(this.webhooks.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const result = await res.json();

      if (result.status === "success") {
        const userObj = {
          name: result.user['Employee Name'],
          role: (result.user.Role || 'agent').toLowerCase(),
          email,
          baseRate: result.user['Base Rate'],
          weeklyHours: result.user['Weekly Hours'],
          startDate: result.user['Start Date'],
          position: result.user['Position']
        };

        localStorage.setItem('callHammerSession', JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 }));

        // ✅ FIX: role-based redirect includes team_leader
        const role = userObj.role;
        if (role === 'admin') window.location.href = 'admin-dashboard.html';
        else if (role === 'team_leader') window.location.href = 'team-leader-dashboard.html';
        else window.location.href = 'agent-dashboard.html';
      } else {
        alert("Login failed");
      }
    } catch (err) {
      alert("Network error");
    }
  }

  async submitTimeOffRequest(data) {
    try {
      const res = await fetch(this.webhooks.timeOffRequest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          email: this.currentUser.email,
          name: this.currentUser.name
        })
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  checkExistingSession() {
    const session = localStorage.getItem('callHammerSession');
    if (session) {
      const data = JSON.parse(session);
      if (data.expiresAt > Date.now()) this.currentUser = data.user;
    }
  }

  bindEvents() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.onsubmit = (e) => {
        e.preventDefault();
        this.login(new FormData(loginForm).get('email'), new FormData(loginForm).get('password'));
      };
    }

    const timeframeSelect = document.getElementById('timeframe-filter');
    if (timeframeSelect) {
      timeframeSelect.onchange = (e) => this.handleFilterChange(e.target.value);
    }

    const statusSelect = document.getElementById('status-filter');
    if (statusSelect) {
      statusSelect.onchange = (e) => {
        const v = (e.target.value || 'all').toLowerCase();
        let filtered = this.filteredLeads?.length ? this.filteredLeads : this.leadsData;

        if (v !== 'all') {
          filtered = filtered.filter(l => (l['Status'] || this.normalizeKey(l, 'Status') || '').toString().toLowerCase() === v);
        }
        this.renderLeadsTable(filtered);
      };
    }
  }

  formatCurrency(val) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  }

  logout() {
    localStorage.removeItem('callHammerSession');
    window.location.href = 'index.html';
  }
}

const portal = new CallHammerPortal();
window.portal = portal;
