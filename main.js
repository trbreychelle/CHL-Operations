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
      clients: [],        
      leads: [],          
      agents: [],         
      rawStatuses: [],    
      rawPackages: [],
      clientCodeList: [] // ✅ Added storage for Master Code List
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
      setTimeout(() => this.fetchAdminData(true), 300);
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

  getAny(obj, keys, fallback = '') {
    if (!obj) return fallback;
    for (const k of keys) {
      const v = this.normalizeKey(obj, k);
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return fallback;
  }

  toNumberSafe(v, fallback = 0) {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'number') return isNaN(v) ? fallback : v;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? fallback : n;
  }

  normalizeCompanyKey(str) {
    if (!str) return 'unknown';
    // Remove punctuation, spaces, and make lowercase for matching
    return String(str).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, '').trim();
  }

  parseDateSafe(value) {
    if (!value) return null;
    const raw = value.toString().trim();
    if (!raw) return null;
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10) - 1;
      const d = parseInt(isoMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0); 
      return isNaN(dt.getTime()) ? null : dt;
    }
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const m = parseInt(slashMatch[1], 10) - 1;
      const d = parseInt(slashMatch[2], 10);
      const y = parseInt(slashMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0); 
      return isNaN(dt.getTime()) ? null : dt;
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // --- MST Clock Helpers ---
  toMST(date) {
    const d = new Date(date);
    const mstOffset = -7 * 60; 
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

      const dataRoot = result?.data || result || {};

      // 1. Master Lead Record (Client Code List)
      const rawClients =
        dataRoot.clients || dataRoot.Clients || dataRoot.CLIENTS ||
        result.clients || result.Clients || result.CLIENTS || [];

      // 2. Leads
      const rawLeads =
        dataRoot.leads || dataRoot.Leads || dataRoot.LEADS ||
        result.leads || result.Leads || result.LEADS || [];

      // 3. Agents
      const rawAgents =
        dataRoot.agents || dataRoot.Agents || dataRoot.AGENTS ||
        result.agents || result.Agents || result.AGENTS || [];

      // 4. Client Status Tracker (Delivery Tracker)
      const rawStatuses =
        dataRoot.clientStatuses || dataRoot.statuses || dataRoot.ClientStatuses ||
        result.clientStatuses || result.statuses || result.ClientStatuses || [];

      // 5. Packages
      const rawPackages =
        dataRoot.packages || dataRoot.leadPackages || dataRoot.Packages ||
        result.packages || result.leadPackages || result.Packages || [];

      this.normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages);

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
    if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
      window.adminDashboard.refreshDashboard();
    }
  }

  // ✅ THIS IS THE LOGIC FIX FOR MASTER RECORD <-> TRACKER CONNECTION
  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    this.adminState.clientCodeList = Array.isArray(rawClients) ? rawClients : [];
    this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];
    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];

    // 1. Create Lookup Map from MASTER LEAD RECORD (Company Name -> Code)
    const codeMap = {};
    this.adminState.clientCodeList.forEach(row => {
        // Col A: CODE NAME, Col B: COMPANY NAME
        const company = this.getAny(row, ['COMPANY NAME', 'Company Name', 'Company'], '');
        const code = this.getAny(row, ['CODE NAME', 'Code Name', 'CODE', 'Client Code'], '');
        
        const key = this.normalizeCompanyKey(company);
        if (key && key !== 'unknown' && code) {
            codeMap[key] = code;
        }
    });

    // 2. Create Lookup Map for Packages
    const packageMap = {};
    this.adminState.rawPackages.forEach(row => {
      const company = this.getAny(row, ['Roofing Company Name', 'Roofing Company', 'Company Name', 'COMPANY NAME'], '');
      const key = this.normalizeCompanyKey(company);
      if (!key || key === 'unknown') return;
      packageMap[key] = row;
    });

    // 3. Main Loop: Iterate over the DELIVERY TRACKER (Statuses)
    // We want the Dashboard to show the Status rows, but matched with the Code.
    this.adminState.clients = this.adminState.rawStatuses.map(sRow => {
      // Get Company Name from Tracker
      const companyName = this.getAny(sRow, ['Roofing Company', 'ROOFING COMPANY', 'Company Name'], 'Unnamed');
      const clientKey = this.normalizeCompanyKey(companyName);

      // LOOKUP CODE using the map
      const codeName = codeMap[clientKey] || 'N/A';

      const pRow = packageMap[clientKey] || {};

      return {
        roofing_company: companyName,
        code: codeName,
        status: this.getAny(sRow, ['Client Status', 'CLIENT STATUS', 'Status'], 'NOT STARTED'),
        location: this.getAny(sRow, ['CITY STATE', 'City State', 'Location'], 'Remote'),
        client_name: this.getAny(sRow, ['CLIENT NAME', 'Client Name'], '—'),
        last_lead_received: this.getAny(sRow, ['Last Lead Received'], ''),
        hours_since_last_lead: this.toNumberSafe(this.getAny(sRow, ['Hours Since Last Lead'], 0), 0),
        leads_today: this.toNumberSafe(this.getAny(sRow, ['Leads Today'], 0), 0),
        leads_yesterday: this.toNumberSafe(this.getAny(sRow, ['Leads Yesterday'], 0), 0),
        purchased_leads: this.toNumberSafe(this.getAny(pRow, ['Purchased Leads'], 0), 0),
        owed_leads: this.toNumberSafe(this.getAny(pRow, ['Owed Leads'], 0), 0)
      };
    });

    const agentsArr = Array.isArray(rawAgents) ? rawAgents : [];
    this.adminState.agents = agentsArr.map(a => ({
      employeeName: this.getAny(a, ['Employee Name', 'Name', 'AGENT NAME', 'Agent Name'], 'Unknown'),
      email: this.getAny(a, ['Email', 'Email Address'], ''),
      role: this.getAny(a, ['Role'], 'Agent'),
      position: this.getAny(a, ['Position'], ''),
      employmentStatus: this.getAny(a, ['Employment_Status', 'Employment Status', 'Status'], 'Active'),
      paymentStatus: this.getAny(a, ['Payment Status'], '')
    }));
  }

  // ------------------------
  // Payroll Week Helpers
  // ------------------------
  getPayrollWeekRangeFor(date) {
    const mstDate = this.toMST(date);
    const dayOfWeek = mstDate.getDay(); 
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

    const dayOfWeek = mstNow.getDay();
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
      if (mstK >= rangeStart && mstK <= rangeEnd) total += parseHours(v);
    }

    if (foundAnyDateColumns) return total;

    const totalHoursCandidate =
      myRow['Total Hours'] ?? myRow['TOTAL HOURS'] ?? myRow['TotalHours'] ??
      myRow['total_hours'] ?? myRow['Hours'] ?? myRow['hours'] ?? 0;

    return parseHours(totalHoursCandidate);
  }

  isConfirmedStatus(status) {
    const s = (status || '').toString().trim().toLowerCase();
    return s === 'confirmed';
  }

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
    if (typeof this.updateDashboardUI === 'function') this.updateDashboardUI(filtered);
    if (typeof this.updateCharts === 'function') this.updateCharts();
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
        if (typeof this.renderLeadsTable === 'function') this.renderLeadsTable(filtered);
      };
    }
  }

  formatCurrency(val) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
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
        body: JSON.stringify({ ...data, email: this.currentUser.email, name: this.currentUser.name })
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

  logout() {
    localStorage.removeItem('callHammerSession');
    window.location.href = 'index.html';
  }
}

const portal = new CallHammerPortal();
window.portal = portal;
