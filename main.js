// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
  constructor() {
    this.currentUser = null;

    // Agent/TL datasets
    this.leadsData = [];
    this.employeeList = [];
    this.filteredLeads = [];
    this.currentFilter = 'this-week';

    this.weeklyPayroll = [];
    this.timeTracker = [];

    // Admin datasets (normalized + raw)
    this.adminState = {
      clients: [],       // normalized for Client Health Monitor
      leads: [],         // raw leads (RAW LEADS tab)
      agents: [],        // normalized from AGENT_MASTER
      rawStatuses: [],   // raw client status rows (Client Lead Delivery Tracker)
      rawPackages: []    // raw package rows (Lead Package tab)
    };

    // Cache to avoid Google Sheets quota/too-many-requests issues
    this.lastAdminFetch = 0;
    this.adminCacheMs = 60_000; // 60s

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

  // ------------------------
  // Init / Routing
  // ------------------------
  init() {
    this.checkExistingSession();
    this.enforceRoleRouting();
    this.bindEvents();

    const path = (window.location.pathname || '').toLowerCase();
    const onAnyDashboard = path.includes('dashboard');
    const onAdminDashboard = path.includes('admin-dashboard');

    // Agent/TL dashboards
    if (this.currentUser && onAnyDashboard && !onAdminDashboard) {
      this.fetchAllData();
      this.updateProfileUI();
      this.startMSTClock();

      if ((this.currentUser.role || '').toLowerCase() === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      } else if ((this.currentUser.role || '').toLowerCase() === 'team_leader') {
        document.querySelectorAll('.tl-only').forEach(el => el.classList.remove('hidden'));
      }
    }

    // Admin dashboard (Mission Control / Overview)
    if (onAdminDashboard) {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      setTimeout(() => this.fetchAdminData(false), 300);
      // Manual refresh if needed: window.portal.fetchAdminData(true)
    }
  }

  enforceRoleRouting() {
    if (!this.currentUser) return;

    const path = (window.location.pathname || '').toLowerCase();
    const role = (this.currentUser.role || 'agent').toLowerCase();

    // only guard dashboard routes
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
    const foundKey = Object.keys(obj).find(k => (k || '').toLowerCase() === (key || '').toLowerCase());
    return foundKey ? obj[foundKey] : '';
  }

  // robust getter: try many header spellings
  getAny(obj, keys, fallback = '') {
    if (!obj) return fallback;
    for (const k of keys) {
      const v = this.normalizeKey(obj, k);
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return fallback;
  }

  // join key for company names (removes punctuation/spaces, case-insensitive)
  normalizeCompanyKey(str) {
    if (!str) return 'unknown';
    return String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  }

  // ✅ date-only parsing without timezone shifting (prevents wrong weekly counts)
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

    // Fallback
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  formatDateShort(d) {
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // --- MST Clock Helpers ---
  toMST(date) {
    const d = new Date(date);
    const mstOffset = -7 * 60; // MST offset minutes
    const localOffset = d.getTimezoneOffset();
    return new Date(d.getTime() + (mstOffset + localOffset) * 60000);
  }

  formatMSTTime(date = new Date()) {
    const mst = this.toMST(date);
    return mst.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  startMSTClock() {
    const el = document.getElementById('mst-clock');
    if (!el) return;

    const tick = () => { el.textContent = `${this.formatMSTTime()} MST`; };
    tick();

    clearInterval(this._mstClockInterval);
    this._mstClockInterval = setInterval(tick, 1000);
  }

  // ------------------------
  // ✅ ADMIN: Fetch + Normalize
  // ------------------------
  async fetchAdminData(forceRefresh = false) {
    try {
      // Cache guard to avoid quota
      const now = Date.now();
      if (!forceRefresh && this.adminState.clients.length > 0 && (now - this.lastAdminFetch) < this.adminCacheMs) {
        console.log('🧠 Using cached admin data (quota guard).');
        this.triggerAdminRefresh();
        return;
      }

      console.log('📡 Fetching Admin Dashboard Data...');
      const response = await fetch(this.webhooks.fetchAdminData, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error(`Admin Data Error: HTTP ${response.status}`);

      const result = await response.json();
      this.lastAdminFetch = Date.now();

      // ✅ IMPORTANT: your webhook may return { status:"success", healthMonitor:[...] }
      // so we MUST check both result and result.data
      const dataRoot = result?.data || result || {};

      // ✅ Prefer healthMonitor if present (this is what your Network tab shows)
      const rawHealthMonitor =
        dataRoot.healthMonitor ||
        result.healthMonitor ||
        [];

      // Other optional shapes (if you later add them back in n8n)
      const rawClients =
        dataRoot.clients || dataRoot.Clients || dataRoot.CLIENTS ||
        result.clients || result.Clients || result.CLIENTS || [];

      const rawLeads =
        dataRoot.leads || dataRoot.Leads || dataRoot.LEADS ||
        result.leads || result.Leads || result.LEADS || [];

      const rawAgents =
        dataRoot.agents || dataRoot.Agents || dataRoot.AGENTS ||
        result.agents || result.Agents || result.AGENTS || [];

      const rawStatuses =
        dataRoot.clientStatuses || dataRoot.statuses || dataRoot.ClientStatuses ||
        result.clientStatuses || result.statuses || result.ClientStatuses || [];

      const rawPackages =
        dataRoot.packages || dataRoot.leadPackages || dataRoot.Packages ||
        result.packages || result.leadPackages || result.Packages || [];

      // ✅ If healthMonitor exists, use it to populate Client Health Monitor immediately
      if (Array.isArray(rawHealthMonitor) && rawHealthMonitor.length > 0) {
        this.normalizeAdminFromHealthMonitor(rawHealthMonitor);

        // Still store these if present (won't break anything)
        this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
        this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];
        this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
        this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];

      } else {
        // Fallback to your previous join-based normalization
        this.normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages);
      }

      console.log('✅ Admin State Ready:', {
        clients: this.adminState.clients.length,
        leads: this.adminState.leads.length,
        agents: this.adminState.agents.length
      });

      this.triggerAdminRefresh();
    } catch (err) {
      console.error('❌ fetchAdminData failed:', err);
      this.triggerAdminRefresh();
    }
  }

  triggerAdminRefresh() {
    // Admin dashboard UI script should read from window.portal.adminState
    if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
      window.adminDashboard.refreshDashboard();
    } else {
      console.warn('⚠️ adminDashboard.refreshDashboard not found (OK if your admin UI uses a different function).');
    }
  }

  // ✅ NEW: normalize directly from webhook `healthMonitor`
  normalizeAdminFromHealthMonitor(rows) {
    const list = Array.isArray(rows) ? rows : [];

    this.adminState.clients = list.map(r => {
      const clientName = this.getAny(r, ['client_name', 'clientName', 'CLIENT NAME', 'Company Name', 'Roofing Company'], 'Unnamed');
      const codeName = this.getAny(r, ['code', 'code_name', 'CODE', 'CODE NAME'], 'N/A');
      const location = this.getAny(r, ['location', 'CITY STATE', 'Location'], 'Remote');
      const status = this.getAny(r, ['status', 'Client Status', 'CLIENT STATUS'], 'NOT STARTED');
      const pkg = this.getAny(r, ['package', 'Package', 'Lead Package'], '');

      const lastLeadReceived = this.getAny(r, ['last_lead_received', 'Last Lead Received'], '');
      const hoursSinceLastLead = this.getAny(r, ['hours_since_last_lead', 'Hours Since Last Lead'], '');
      const leadsToday = this.getAny(r, ['leads_today', 'Leads Today'], 0);
      const leadsYesterday = this.getAny(r, ['leads_yesterday', 'Leads Yesterday'], 0);

      return {
        clientName,
        codeName,
        // ✅ this gives you "Company (Client 007)" style for UI if you want it
        clientNameWithCode: (codeName && codeName !== 'N/A') ? `${clientName} (${codeName})` : clientName,
        location,
        status,
        package: pkg,

        // extra fields (safe)
        lastLeadReceived,
        hoursSinceLastLead,
        leadsToday,
        leadsYesterday
      };
    });
  }

  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    // Keep raw for debugging
    this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];

    // --- Build lookup maps for joins (Status + Package) ---
    const statusMap = {};
    (Array.isArray(rawStatuses) ? rawStatuses : []).forEach(row => {
      const company = this.getAny(row, ['Roofing Company', 'Company Name', 'COMPANY NAME', 'Client', 'CLIENT NAME'], '');
      const key = this.normalizeCompanyKey(company);
      if (!key || key === 'unknown') return;
      statusMap[key] = row;
    });

    const packageMap = {};
    (Array.isArray(rawPackages) ? rawPackages : []).forEach(row => {
      const company = this.getAny(row, ['Roofing Company Name', 'Roofing Company', 'Company Name', 'COMPANY NAME'], '');
      const key = this.normalizeCompanyKey(company);
      if (!key || key === 'unknown') return;
      packageMap[key] = row;
    });

    // --- Normalize Clients (from CLIENT CODE LIST) ---
    const clientsArr = Array.isArray(rawClients) ? rawClients : [];
    this.adminState.clients = clientsArr.map(c => {
      const companyName = this.getAny(c, ['COMPANY NAME', 'Company Name', 'Company', 'Roofing Company'], 'Unnamed');
      const codeName = this.getAny(c, ['CODE NAME', 'Code Name', 'CODE', 'Client Code'], 'N/A');
      const location = this.getAny(c, ['Add location here', 'Location', 'CITY STATE', 'City State'], 'Remote');
      const clientKey = this.normalizeCompanyKey(companyName);

      const sRow = statusMap[clientKey] || {};
      const pRow = packageMap[clientKey] || {};

      const joinedStatus = this.getAny(
        sRow,
        ['Client Status', 'CLIENT STATUS', 'Status'],
        this.getAny(c, ['STATUS', 'Status'], 'NOT STARTED')
      );

      const joinedPackage = this.getAny(pRow, ['Package', 'Lead Package', 'PACKAGE'], '');

      const lastLeadReceived = this.getAny(sRow, ['Last Lead Received'], '');
      const hoursSinceLastLead = this.getAny(sRow, ['Hours Since Last Lead'], '');
      const leadsToday = this.getAny(sRow, ['Leads Today'], '');
      const leadsYesterday = this.getAny(sRow, ['Leads Yesterday'], '');

      return {
        clientName: companyName,
        codeName,
        clientNameWithCode: codeName && codeName !== 'N/A' ? `${companyName} (${codeName})` : companyName,
        location,
        status: joinedStatus || 'NOT STARTED',
        package: joinedPackage || '',
        lastLeadReceived,
        hoursSinceLastLead,
        leadsToday,
        leadsYesterday
      };
    });

    // --- Normalize Agents (from AGENT_MASTER) ---
    const agentsArr = Array.isArray(rawAgents) ? rawAgents : [];
    this.adminState.agents = agentsArr.map(a => ({
      employeeName: this.getAny(a, ['Employee Name', 'Name', 'AGENT NAME', 'Agent Name'], 'Unknown'),
      email: this.getAny(a, ['Email', 'Email Address'], ''),
      role: this.getAny(a, ['Role'], 'Agent'),
      position: this.getAny(a, ['Position'], ''),
      employmentStatus: this.getAny(a, ['Employment_Status', 'Employment Status', 'Status'], 'Active'),
      paymentStatus: this.getAny(a, ['Payment Status'], '')
    }));

    // --- Raw Leads (from RAW LEADS tab) ---
    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
  }

  // ✅ ADMIN: compute Team Performance from RAW LEADS + Agent Master
  // timeFilter: 'today' | 'this-week' | '30-days' | 'all'
  calculateAdminTeamStats(timeFilter = 'today') {
    const stats = {};

    (this.adminState.agents || []).forEach(a => {
      const name = (a.employeeName || '').trim() || 'Unknown';
      const emp = (a.employmentStatus || '').toLowerCase();
      if (emp && emp.includes('offboard')) return;

      stats[name] = { name, total: 0, confirmed: 0, rejected: 0, pending: 0 };
    });

    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];
    if (!leads.length) return Object.values(stats);

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const startOf30 = new Date(now);
    startOf30.setDate(now.getDate() - 30);
    startOf30.setHours(0, 0, 0, 0);

    for (const lead of leads) {
      const coordinator = String(
        this.getAny(lead, ['Appointment Coordinator Name', 'Setter', 'Agent', 'Agent Name'], 'Unknown')
      ).trim() || 'Unknown';

      const dateStr = this.getAny(lead, ['Date Submitted', 'Date', 'Submitted Date'], '');
      const leadDate = this.parseDateSafe(dateStr);
      if (!leadDate) continue;

      let include = false;
      if (timeFilter === 'today') include = leadDate >= startOfDay;
      else if (timeFilter === 'this-week') include = leadDate >= startOfWeek;
      else if (timeFilter === '30-days') include = leadDate >= startOf30;
      else if (timeFilter === 'all') include = true;

      if (!include) continue;

      if (!stats[coordinator]) {
        stats[coordinator] = { name: coordinator, total: 0, confirmed: 0, rejected: 0, pending: 0 };
      }

      const status = String(this.getAny(lead, ['Status'], '')).toLowerCase();
      stats[coordinator].total += 1;

      if (status === 'confirmed' || status === 'approved') stats[coordinator].confirmed += 1;
      else if (status.includes('reject') || status.includes('decline') || status.includes('cancel') || status.includes('credit')) stats[coordinator].rejected += 1;
      else stats[coordinator].pending += 1;
    }

    return Object.values(stats).map(a => {
      const efficiency = a.total > 0 ? (a.confirmed / a.total) * 100 : 0;
      return { ...a, efficiency: `${efficiency.toFixed(0)}%` };
    });
  }

  // ------------------------
  // Payroll Week Helpers (Agent/TL)
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
      if (mstK >= rangeStart && mstK <= rangeEnd) total += parseHours(v);
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

    return parseHours(totalHoursCandidate);
  }

  // ------------------------
  // Status helpers
  // ------------------------
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

        if (result.timeOffHistory) this.renderTimeOffHistory(result.timeOffHistory);

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

  // Team Leader dashboard fetch (does not affect agent dashboard)
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

  // ------------------------
  // Agent Dashboard UI
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

    const elA = document.getElementById('stat-appointments');
    const elR = document.getElementById('stat-cancel-rate');
    const elI = document.getElementById('stat-incentives');

    if (elA) elA.textContent = totalRaw;
    if (elR) elR.textContent = `${rate}%`;
    if (elI) elI.textContent = this.formatCurrency(currentIncentives);

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

  getWeekStart(d) { return this.getPayrollWeekStart(d); }
  getWeekKey(d) { return this.getPayrollWeekKey(d); }

  // ------------------------
  // Profile / Auth / Session
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
