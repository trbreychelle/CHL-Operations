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

    // ✅ Admin dashboard datasets (UPDATED STRUCTURE)
    this.adminState = {
      clients: [],      // Normalized Client List
      leads: [],        // Raw Leads (for stats)
      agents: [],       // Normalized Agent List
      rawStatuses: [],  // For joins
      rawPackages: []   // For joins
    };
    
    // ✅ QUOTA PROTECTION: Timestamp for caching
    this.lastAdminFetch = 0; 

    this.charts = {
      appointments: null,
      incentives: null
    };

    this.webhooks = {
      login: 'https://automate.callhammerleads.com/webhook/agent-login',
      fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data',
      fetchTLData: 'https://automate.callhammerleads.com/webhook/fetch-tl-data',
      fetchAdminData: 'https://automate.callhammerleads.com/webhook/dashboard-data',
      timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
      changePassword: 'https://automate.callhammerleads.com/webhook/change-password',
      manageEmployee: 'https://automate.callhammerleads.com/webhook/manage-employee'
    };

    this.init();
  }

  init() {
    this.checkExistingSession();
    this.enforceRoleRouting(); // ✅ NEW: Protects pages
    this.bindEvents();

    // ✅ Agent / TL dashboard behavior
    if (this.currentUser && window.location.pathname.includes('dashboard')) {
      // Only run Agent fetches if NOT on Admin Dashboard
      if (!window.location.pathname.includes('admin-dashboard')) {
        this.fetchAllData();
        this.updateProfileUI();
        this.startMSTClock();
      }

      if (this.currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      } else if (this.currentUser.role === 'team_leader') {
        document.querySelectorAll('.tl-only').forEach(el => el.classList.remove('hidden'));
      }
    }

    // ✅ Admin Dashboard behavior (separate fetch so it doesn't interfere)
    if (window.location.pathname.includes('admin-dashboard')) {
      // Auto load admin dashboard data
      setTimeout(() => {
        this.fetchAdminData();
      }, 500);
    }
  }

  // ✅ NEW: Role-based routing guard (minimal, non-breaking)
  enforceRoleRouting() {
    if (!this.currentUser) return;

    const path = (window.location.pathname || '').toLowerCase();
    const role = (this.currentUser.role || 'agent').toLowerCase();

    // Only redirect if actually ON a dashboard page
    if (!path.includes('dashboard')) return;

    const onAdmin = path.includes('admin-dashboard');
    const onAgent = path.includes('agent-dashboard');
    const onTL = path.includes('team-leader-dashboard');

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

  // ✅ NEW: Normalizer for Admin Joins
  normalizeCompanyKey(str) {
    if (!str) return 'unknown';
    return str.toString().toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  }

  // ✅ FIX: date-only parsing without timezone shifting (Preserved your logic)
  parseDateSafe(value) {
    if (!value) return null;

    const raw = value.toString().trim();
    if (!raw) return null;

    // YYYY-MM-DD
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10) - 1;
      const d = parseInt(isoMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0); // noon local avoids shifting
      return isNaN(dt.getTime()) ? null : dt;
    }

    // M/D/YYYY or MM/DD/YYYY
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const m = parseInt(slashMatch[1], 10) - 1;
      const d = parseInt(slashMatch[2], 10);
      const y = parseInt(slashMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0); // noon local avoids shifting
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Fallback (handles "Jan 6, 2026", or date+time strings)
    const d = new Date(raw);
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
  // ✅ ADMIN DASHBOARD FETCH (COMPLETELY FIXED)
  // ------------------------
  async fetchAdminData(forceRefresh = false) {
    // 1) QUOTA FIX: Cache for 60 seconds
    const now = Date.now();
    if (!forceRefresh && this.adminState.clients.length > 0 && (now - this.lastAdminFetch < 60000)) {
      console.log("Using cached Admin Data (Quota Protection)...");
      if (window.adminDashboard && window.adminDashboard.refreshDashboard) {
        window.adminDashboard.refreshDashboard();
      }
      return;
    }

    try {
      console.log("📡 Fetching Admin Dashboard Data...");

      const response = await fetch(this.webhooks.fetchAdminData, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        throw new Error(`Admin Data Error: HTTP ${response.status}`);
      }

      const result = await response.json();
      this.lastAdminFetch = Date.now(); // Update timestamp

      // Support multiple possible response shapes from n8n
      const rawClients = result.clients || result.Clients || result.CLIENTS || result.data?.clients || [];
      const rawLeads = result.leads || result.Leads || result.LEADS || result.data?.leads || [];
      const rawAgents = result.agents || result.Agents || result.AGENTS || result.data?.agents || [];
      const rawStatuses = result.clientStatuses || result.data?.clientStatuses || []; // Delivery Tracker
      const rawPackages = result.packages || result.data?.packages || []; // Package Tab

      // ✅ 2) Normalize & Join Data
      this.normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages);

      console.log("📊 Admin State Ready:", {
        clients: this.adminState.clients.length,
        leads: this.adminState.leads.length,
        agents: this.adminState.agents.length
      });

      // ✅ Trigger Admin Dashboard UI
      if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === "function") {
        window.adminDashboard.refreshDashboard();
      } else {
        console.warn("⚠️ adminDashboard.refreshDashboard not found.");
      }

    } catch (err) {
      console.error("❌ fetchAdminData failed:", err);
    }
  }

  // ✅ NEW: Central Normalization & Joining Logic (Fixes Admin Headers)
  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    
    // -- Step A: Create Lookup Maps for Joins --
    const statusMap = {};
    rawStatuses.forEach(row => {
      const key = this.normalizeCompanyKey(row['Roofing Company'] || row['Company Name']);
      statusMap[key] = row; 
    });

    const packageMap = {};
    rawPackages.forEach(row => {
      const key = this.normalizeCompanyKey(row['Roofing Company Name'] || row['Company Name']);
      packageMap[key] = row;
    });

    // -- Step B: Map Clients (Fixing "Unnamed") --
    this.adminState.clients = rawClients.map(c => {
      const compName = c['COMPANY NAME'] || c['Company Name'] || c['name'] || 'Unnamed';
      const key = this.normalizeCompanyKey(compName);
      
      const statusRow = statusMap[key] || {};
      const packageRow = packageMap[key] || {};

      return {
        clientName: compName,
        codeName: c['CODE NAME'] || c['Code'] || 'N/A',
        location: c['Add location here'] || c['Location'] || 'Remote', 
        status: statusRow['Client Status'] || statusRow['Status'] || 'Not Started',
        package: packageRow['Package'] || packageRow['Lead Package'] || 'Standard',
        leadsPurchased: packageRow['Leads Purchased'] || 0
      };
    });

    // -- Step C: Map Agents (Fixing Disappearing Names) --
    this.adminState.agents = rawAgents.map(a => ({
      employeeName: a['Employee Name'] || a['Name'] || 'Unknown Agent',
      role: a['Role'] || 'Agent',
      employmentStatus: a['Employment_Status'] || a['Status'] || 'Active',
      email: a['Email'] || a['Email Address'] || ''
    }));

    // -- Step D: Store Raw Leads
    this.adminState.leads = rawLeads;
  }

  // ✅ NEW: Compute Team Performance from RAW LEADS (Fixes Efficiency Stats)
  calculateAdminTeamStats(timeFilter = 'today') {
    const stats = {}; 

    // 1. Initialize stats with ALL agents from Master List
    this.adminState.agents.forEach(agent => {
      stats[agent.employeeName] = { 
        name: agent.employeeName, 
        total: 0, 
        confirmed: 0, 
        rejected: 0,
        pending: 0
      };
    });

    // 2. Define Date Range
    const now = new Date();
    const startOfDay = new Date(now.setHours(0,0,0,0));
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0,0,0,0);
    
    const startOfMonth = new Date(); 
    startOfMonth.setDate(now.getDate() - 30);
    startOfMonth.setHours(0,0,0,0);

    // 3. Process Leads
    this.adminState.leads.forEach(lead => {
      const coordinator = lead['Appointment Coordinator Name'] || lead['Setter'] || 'Unknown';
      
      const dateStr = lead['Date Submitted'] || lead['Date'];
      const leadDate = this.parseDateSafe(dateStr);
      if (!leadDate) return;

      let include = false;
      if (timeFilter === 'today' && leadDate >= startOfDay) include = true;
      else if (timeFilter === 'this-week' && leadDate >= startOfWeek) include = true;
      else if (timeFilter === '30-days' && leadDate >= startOfMonth) include = true;
      else if (timeFilter === 'all') include = true;

      if (include) {
        if (!stats[coordinator]) {
          stats[coordinator] = { name: coordinator, total: 0, confirmed: 0, rejected: 0, pending: 0 };
        }

        const s = (lead['Status'] || '').toLowerCase();
        stats[coordinator].total++;

        if (s === 'confirmed' || s === 'approved') {
          stats[coordinator].confirmed++;
        } else if (s.includes('reject') || s.includes('decline') || s.includes('cancel') || s.includes('credit')) {
          stats[coordinator].rejected++;
        } else {
          stats[coordinator].pending++;
        }
      }
    });

    // 4. Return Array
    return Object.values(stats).map(agent => {
      const efficiency = agent.total > 0 ? (agent.confirmed / agent.total) * 100 : 0;
      return {
        ...agent,
        efficiency: efficiency.toFixed(1) + '%'
      };
    });
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

  getPreviousPayrollWeekRange() {
    const cur = this.getPayrollWeekRange();
    const start = new Date(cur.start);
    const end = new Date(cur.end);
    start.setDate(start.getDate() - 7);
    end.setDate(end.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  computeWorkedHoursFromWeeklyPayroll(rangeStart, rangeEnd) {
    const rows = Array.isArray(this.weeklyPayroll) ? this.weeklyPayroll : [];
    if (!rows.length || !this.currentUser) return 0;

    const myEmail = (this.currentUser.email || '').toLowerCase().trim();
    const myName = (this.currentUser.name || '').toLowerCase().trim();

    const parseHours = (v) => {
      const n = parseFloat((v ?? '').toString().replace(/[^\d.]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    const objRows = rows.filter(r => r && typeof r === 'object' && !Array.isArray(r));
    if (!objRows.length) return 0;

    const getPossibleEmail = (r) =>
      (r.Email || r.email || r['Agent Email'] || r['Employee Email'] || r['Email Address'] || '').toString().toLowerCase().trim();

    const getPossibleName = (r) =>
      (r['Agent Name'] || r['Employee Name'] || r['Name'] || r.name || '').toString().toLowerCase().trim();

    const myRow = objRows.find(r => {
      const rowEmail = getPossibleEmail(r);
      const rowName = getPossibleName(r);
      const emailMatch = myEmail && rowEmail && myEmail === rowEmail;
      const nameMatch = myName && rowName && (rowName.includes(myName) || myName.includes(rowName));
      return emailMatch || nameMatch;
    });

    if (!myRow) return 0;

    let total = 0;
    let foundAnyDateColumns = false;

    for (const [k, v] of Object.entries(myRow)) {
      const key = (k || '').toString().trim();
      if (!key) continue;

      const keyDate = this.parseDateSafe(key);
      if (!keyDate) continue;

      foundAnyDateColumns = true;

      const mstK = this.toMST(keyDate);
      if (mstK >= rangeStart && mstK <= rangeEnd) {
        total += parseHours(v);
      }
    }

    if (foundAnyDateColumns) return total;

    const totalHoursCandidate =
      myRow['Total Hours'] ??
      myRow['TOTAL HOURS'] ??
      myRow['TotalHours'] ??
      myRow['total_hours'] ??
      myRow['Hours'] ??
      myRow['hours'] ??
      0;

    const n = parseHours(totalHoursCandidate);
    return n;
  }

  toMST(date) {
    const d = new Date(date);
    const mstOffset = -7 * 60;
    const localOffset = d.getTimezoneOffset();
    return new Date(d.getTime() + (mstOffset + localOffset) * 60000);
  }

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

  isConfirmedStatus(status) {
    const s = (status || '').toString().trim().toLowerCase();
    return s === 'confirmed';
  }

  isCancelledLikeStatus(status) {
    const s = (status || '').toString().toLowerCase();
    return s.includes('cancel') || s.includes('credited') || s.includes('rejected') || s.includes('declined');
  }

  // ------------------------
  // Data Fetch (AGENT)
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

        this.weeklyPayroll = Array.isArray(result.weeklyPayroll) ? result.weeklyPayroll : [];
        this.timeTracker = Array.isArray(result.timeTracker) ? result.timeTracker : [];

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
          this.enforceRoleRouting();
        }

        if (result.timeOffHistory) {
          this.renderTimeOffHistory(result.timeOffHistory);
        }

        this.handleFilterChange(this.currentFilter);
        this.updateCharts();

        if (window.teamLeadDashboard && typeof window.teamLeadDashboard.refresh === 'function') {
          window.teamLeadDashboard.refresh();
        }
      }
    } catch (error) {
      console.error('Data Sync Error:', error);
    }
  }

  // ✅ NEW: Team Leader dashboard fetch (does not affect agent dashboard)
  async fetchTeamLeaderDashboardData() {
    if (!this.currentUser) return null;

    try {
      const response = await fetch(this.webhooks.fetchTLData, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.currentUser.email,
          role: this.currentUser.role
        })
      });

      const result = await response.json();

      if (result.status === "success") return result;

      console.error("TL Fetch Failed:", result);
      return null;
    } catch (err) {
      console.error("TL Fetch Network Error:", err);
      return null;
    }
  }

  // ------------------------
  // Incentives
  // ------------------------
  calculateIncentives(confirmedN, cancelRate) {
    const isHighPerf = cancelRate < 25;
    let total = 0;

    if (confirmedN >= 6) total += 50;
    if (confirmedN >= 8) total += isHighPerf ? 50 : 30;

    if (confirmedN >= 9) {
      const count9to12 = Math.min(confirmedN, 12) - 8;
      total += count9to12 * (isHighPerf ? 17 : 15);
    }

    if (confirmedN >= 13) {
      total += (confirmedN - 12) * (isHighPerf ? 27 : 25);
    }

    return total;
  }

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

    for (const k of Object.keys(buckets)) {
      const w = buckets[k];
      w.cancelRate = w.submitted > 0 ? (w.cancelled / w.submitted) * 100 : 0;
      w.incentives = this.calculateIncentives(w.confirmed, w.cancelRate);
    }

    return buckets;
  }

  computeMonthlyIncentiveStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const keys = Object.keys(buckets).sort((a, b) => (buckets[a].weekStart - buckets[b].weekStart));
    const last4 = keys.slice(-4).map(k => buckets[k]);

    const hits = last4.filter(w => w.confirmed >= 8 && w.cancelRate < 25).length;
    const qualified = last4.length === 4 ? hits >= 3 : false;

    return { qualified, hits, weeksConsidered: last4.length, needed: 3 };
  }

  computeMonthlyRaffleStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const weeks = Object.values(buckets).sort((a, b) => a.weekStart - b.weekStart);

    const eligibleWeeks = weeks.filter(w => w.confirmed >= 8 && w.cancelRate < 20);
    const totalEligibleWeeks = eligibleWeeks.length;

    const entriesEarned = Math.floor(totalEligibleWeeks / 4);
    const progress = totalEligibleWeeks % 4;

    return { eligibleNow: false, progress, needed: 4, entriesEarned };
  }

  // ------------------------
  // Dashboard UI
  // ------------------------
  updateDashboardUI(leads) {
    const getVal = (obj, key) => this.normalizeKey(obj, key) || '';

    const payrollRange = this.getPayrollWeekRange();
    const payrollLeads = this.leadsData.filter(l => {
      const subDate = this.parseDateSafe(getVal(l, 'Date Submitted'));
      return subDate && subDate >= payrollRange.start && subDate <= payrollRange.end;
    });

    const payrollConfirmed = payrollLeads.filter(l => this.isConfirmedStatus(getVal(l, 'Status')));

    const payrollTotal = payrollLeads.length;
    const payrollCancelled = payrollLeads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;
    const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;

    const currentIncentives = this.calculateIncentives(payrollConfirmed.length, payrollCancelRate);

    const totalRaw = leads.length;
    const cancelledCount = leads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;
    const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : "0.0";

    if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
    if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
    if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(currentIncentives);

    const hoursRange = (this.currentFilter === 'previous-week')
      ? this.getPreviousPayrollWeekRange()
      : this.getPayrollWeekRange();

    const workedHours = this.computeWorkedHoursFromWeeklyPayroll(hoursRange.start, hoursRange.end);

    const statHoursEl = document.getElementById('stat-hours');
    if (statHoursEl) statHoursEl.textContent = `${(workedHours || 0).toFixed(2)} hrs`;

    this.renderLeadsTable(leads);
  }

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

  renderTimeOffHistory(history) {
    const container = document.getElementById('timeoff-history-list');
    if (!container) return;

    const rows = Array.isArray(history) ? history : [];

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

  handleFilterChange(value) {
    this.currentFilter = value;
    const now = new Date();
    let filtered = this.leadsData;

    const getSubmittedDate = (l) => this.parseDateSafe(l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted'));

    if (value === 'this-week') {
      const range = this.getPayrollWeekRange();
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= range.start && d <= range.end;
      });
    } else if (value === 'previous-week') {
      const range = this.getPreviousPayrollWeekRange();
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= range.start && d <= range.end;
      });
    } else if (value === '30-days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= thirtyDaysAgo;
      });
    } else if (value === '4-weeks') {
      const d0 = new Date();
      d0.setDate(now.getDate() - 28);
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= d0;
      });
    } else if (value === '6-weeks') {
      const d0 = new Date();
      d0.setDate(now.getDate() - 42);
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= d0;
      });
    } else if (value === 'all-time') {
      filtered = this.leadsData;
    }

    this.filteredLeads = filtered;
    this.updateDashboardUI(filtered);
    this.updateCharts();
  }

  // ------------------------
  // Charts
  // ------------------------
  updateCharts() {
    const chartA = document.getElementById('appointmentsChart');
    const chartI = document.getElementById('incentivesChart');
    if (!chartA || !chartI) return;

    if (!this.charts.appointments) this.charts.appointments = echarts.init(chartA);
    if (!this.charts.incentives) this.charts.incentives = echarts.init(chartI);

    const buckets = this.buildWeeklyBuckets(8);

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

    for (const k of Object.keys(buckets)) {
      const week = buckets[k];
      const cancelRate = week.submitted > 0 ? (week.cancelled / week.submitted) * 100 : 0;
      week.incentives = this.calculateIncentives(week.confirmed, cancelRate);
    }

    const labels = Object.keys(buckets).sort();
    const confirmedSeries = labels.map(k => buckets[k].confirmed);
    const submittedSeries = labels.map(k => buckets[k].submitted);
    const incentiveSeries = labels.map(k => buckets[k].incentives);

    this.charts.appointments.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [
        { name: 'Submitted', type: 'line', data: submittedSeries, smooth: true },
        { name: 'Confirmed', type: 'line', data: confirmedSeries, smooth: true }
      ]
    }, true);

    this.charts.incentives.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [
        { name: 'Incentives', type: 'bar', data: incentiveSeries }
      ]
    }, true);

    window.addEventListener('resize', () => {
      this.charts?.appointments?.resize();
      this.charts?.incentives?.resize();
    });
  }

  buildWeeklyBuckets(weeksBack = 8) {
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
    return this.getPayrollWeekStart(d);
  }

  getWeekKey(d) {
    return this.getPayrollWeekKey(d);
  }

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
      'profileHours': u.weeklyHours || 0,
      'profileStartDate': u.startDate || 'N/A'
    };

    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }
  }

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
("TL Fetch Failed:", result);
      return null;
    } catch (err) {
      console.error("TL Fetch Network Error:", err);
      return null;
    }
  }

  // ------------------------
  // INCENTIVE LOGIC
  // ------------------------
  calculateIncentives(confirmedN, cancelRate) {
    const isHighPerf = cancelRate < 25;
    let total = 0;

    if (confirmedN >= 6) total += 50;
    if (confirmedN >= 8) total += isHighPerf ? 50 : 30;

    if (confirmedN >= 9) {
      const count9to12 = Math.min(confirmedN, 12) - 8;
      total += count9to12 * (isHighPerf ? 17 : 15);
    }

    if (confirmedN >= 13) {
      total += (confirmedN - 12) * (isHighPerf ? 27 : 25);
    }

    return total;
  }

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

    for (const k of Object.keys(buckets)) {
      const w = buckets[k];
      w.cancelRate = w.submitted > 0 ? (w.cancelled / w.submitted) * 100 : 0;
      w.incentives = this.calculateIncentives(w.confirmed, w.cancelRate);
    }

    return buckets;
  }

  computeMonthlyIncentiveStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const keys = Object.keys(buckets).sort((a, b) => (buckets[a].weekStart - buckets[b].weekStart));
    const last4 = keys.slice(-4).map(k => buckets[k]);

    const hits = last4.filter(w => w.confirmed >= 8 && w.cancelRate < 25).length;
    const qualified = last4.length === 4 ? hits >= 3 : false;

    return { qualified, hits, weeksConsidered: last4.length, needed: 3 };
  }

  computeMonthlyRaffleStatus() {
    const buckets = this.buildPayrollWeekBucketsFromLeads(this.leadsData);
    const weeks = Object.values(buckets).sort((a, b) => a.weekStart - b.weekStart);

    const eligibleWeeks = weeks.filter(w => w.confirmed >= 8 && w.cancelRate < 20);
    const totalEligibleWeeks = eligibleWeeks.length;

    const entriesEarned = Math.floor(totalEligibleWeeks / 4);
    const progress = totalEligibleWeeks % 4;

    return { eligibleNow: false, progress, needed: 4, entriesEarned };
  }

  // ------------------------
  // DASHBOARD UI UPDATES
  // ------------------------
  updateDashboardUI(leads) {
    const getVal = (obj, key) => this.normalizeKey(obj, key) || '';

    const payrollRange = this.getPayrollWeekRange();
    const payrollLeads = this.leadsData.filter(l => {
      const subDate = this.parseDateSafe(getVal(l, 'Date Submitted'));
      return subDate && subDate >= payrollRange.start && subDate <= payrollRange.end;
    });

    const payrollConfirmed = payrollLeads.filter(l => this.isConfirmedStatus(getVal(l, 'Status')));

    const payrollTotal = payrollLeads.length;
    const payrollCancelled = payrollLeads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;
    const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;

    const currentIncentives = this.calculateIncentives(payrollConfirmed.length, payrollCancelRate);

    const totalRaw = leads.length;
    const cancelledCount = leads.filter(l => this.isCancelledLikeStatus(getVal(l, 'Status'))).length;
    const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : "0.0";

    if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
    if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
    if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(currentIncentives);

    const hoursRange = (this.currentFilter === 'previous-week')
      ? this.getPreviousPayrollWeekRange()
      : this.getPayrollWeekRange();

    const workedHours = this.computeWorkedHoursFromWeeklyPayroll(hoursRange.start, hoursRange.end);

    const statHoursEl = document.getElementById('stat-hours');
    if (statHoursEl) statHoursEl.textContent = `${(workedHours || 0).toFixed(2)} hrs`;

    this.renderLeadsTable(leads);
  }

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

  renderTimeOffHistory(history) {
    const container = document.getElementById('timeoff-history-list');
    if (!container) return;

    const rows = Array.isArray(history) ? history : [];

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

  handleFilterChange(value) {
    this.currentFilter = value;
    const now = new Date();
    let filtered = this.leadsData;

    const getSubmittedDate = (l) => this.parseDateSafe(l['Date Submitted'] || this.normalizeKey(l, 'Date Submitted'));

    if (value === 'this-week') {
      const range = this.getPayrollWeekRange();
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= range.start && d <= range.end;
      });
    } else if (value === 'previous-week') {
      const range = this.getPreviousPayrollWeekRange();
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= range.start && d <= range.end;
      });
    } else if (value === '30-days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= thirtyDaysAgo;
      });
    } else if (value === '4-weeks') {
      const d0 = new Date();
      d0.setDate(now.getDate() - 28);
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= d0;
      });
    } else if (value === '6-weeks') {
      const d0 = new Date();
      d0.setDate(now.getDate() - 42);
      filtered = this.leadsData.filter(l => {
        const d = getSubmittedDate(l);
        return d && d >= d0;
      });
    } else if (value === 'all-time') {
      filtered = this.leadsData;
    }

    this.filteredLeads = filtered;
    this.updateDashboardUI(filtered);
    this.updateCharts();
  }

  // ------------------------
  // CHARTS
  // ------------------------
  updateCharts() {
    const chartA = document.getElementById('appointmentsChart');
    const chartI = document.getElementById('incentivesChart');
    if (!chartA || !chartI) return;

    if (!this.charts.appointments) this.charts.appointments = echarts.init(chartA);
    if (!this.charts.incentives) this.charts.incentives = echarts.init(chartI);

    const buckets = this.buildWeeklyBuckets(8);

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

    for (const k of Object.keys(buckets)) {
      const week = buckets[k];
      const cancelRate = week.submitted > 0 ? (week.cancelled / week.submitted) * 100 : 0;
      week.incentives = this.calculateIncentives(week.confirmed, cancelRate);
    }

    const labels = Object.keys(buckets).sort();
    const confirmedSeries = labels.map(k => buckets[k].confirmed);
    const submittedSeries = labels.map(k => buckets[k].submitted);
    const incentiveSeries = labels.map(k => buckets[k].incentives);

    this.charts.appointments.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [
        { name: 'Submitted', type: 'line', data: submittedSeries, smooth: true },
        { name: 'Confirmed', type: 'line', data: confirmedSeries, smooth: true }
      ]
    }, true);

    this.charts.incentives.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value' },
      series: [
        { name: 'Incentives', type: 'bar', data: incentiveSeries }
      ]
    }, true);

    window.addEventListener('resize', () => {
      this.charts?.appointments?.resize();
      this.charts?.incentives?.resize();
    });
  }

  buildWeeklyBuckets(weeksBack = 8) {
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
    return this.getPayrollWeekStart(d);
  }

  getWeekKey(d) {
    return this.getPayrollWeekKey(d);
  }

  // ------------------------
  // AUTH & EVENTS
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
      'profileHours': u.weeklyHours || 0,
      'profileStartDate': u.startDate || 'N/A'
    };

    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }
  }

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

  logout() {
    localStorage.removeItem('callHammerSession');
    window.location.href = 'index.html';
  }
}

const portal = new CallHammerPortal();
window.portal = portal;
