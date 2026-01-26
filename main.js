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
      clients: [],        // normalized for Client Health Monitor
      leads: [],          // raw leads (RAW LEADS tab)
      agents: [],         // normalized from AGENT_MASTER
      rawStatuses: [],    // raw client status rows (Client Lead Delivery Tracker)
      rawPackages: [],    // raw package rows (Lead Package tab)
      statusOptions: ['CRITICAL', 'AT RISK', 'HEALTHY', 'NOT STARTED'],
      performance: null   // computed team performance payload
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

      const role = (this.currentUser.role || '').toLowerCase();
      if (role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      } else if (role === 'team_leader') {
        document.querySelectorAll('.tl-only').forEach(el => el.classList.remove('hidden'));
      }
    }

    // Admin dashboard (Mission Control / Overview)
    if (onAdminDashboard) {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      setTimeout(() => this.fetchAdminData(false), 300);
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
  // Basic Session / Events (safe defaults)
  // ------------------------
  checkExistingSession() {
    try {
      const raw = localStorage.getItem('ch_session');
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session && session.user) this.currentUser = session.user;
    } catch (e) {
      console.warn('Session parse failed:', e);
    }
  }

  bindEvents() {
    // Optional hooks if you already have buttons wired in HTML
    // (safe: no errors if elements don’t exist)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('ch_session');
        window.location.href = 'index.html';
      });
    }

    // Admin performance period selector (optional)
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'admin-performance-period') {
        this.setAdminPerformancePeriod(t.value);
      }
    });
  }

  async fetchAllData() {
    // Placeholder: keep your existing logic if you already had it.
    // This won’t break the admin dashboard features.
    try {
      // Agent/TL data endpoints were not included in your paste
      // so this is intentionally minimal.
      console.log('fetchAllData(): (no-op safe default)');
    } catch (e) {
      console.warn('fetchAllData failed:', e);
    }
  }

  updateProfileUI() {
    // safe default
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

  // numbers that might come as strings
  toNumberSafe(v, fallback = 0) {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'number') return isNaN(v) ? fallback : v;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? fallback : n;
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
      const dt = new Date(y, m, d, 12, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // M/D/YYYY or MM/DD/YYYY
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const m = parseInt(slashMatch[1], 10) - 1;
      const d = parseInt(slashMatch[2], 10);
      const y = parseInt(slashMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Fallback
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
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

      // ✅ support {data:{...}} and direct root
      const dataRoot = result?.data || result || {};

      const rawHealthMonitor = dataRoot.healthMonitor || result.healthMonitor || [];

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

      // ✅ If healthMonitor exists, use it
      if (Array.isArray(rawHealthMonitor) && rawHealthMonitor.length > 0) {
        this.normalizeAdminFromHealthMonitor(rawHealthMonitor);
        this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
        this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];
        this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
        this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];
      } else {
        // fallback join-based
        this.normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages);
      }

      // ✅ Always rebuild status options + performance payload after load
      this.adminState.statusOptions = this.getAdminStatusOptions();
      this.adminState.performance = this.buildAdminPerformance(this.currentFilter || 'this-week');

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
    } else {
      console.warn('⚠️ adminDashboard.refreshDashboard not found (OK if your admin UI uses a different function).');
    }
  }

  // ✅ ADMIN: normalize from healthMonitor (includes code_name + roofing_company + city_state + package stats)
  normalizeAdminFromHealthMonitor(rows) {
    const list = Array.isArray(rows) ? rows : [];

    this.adminState.clients = list.map(r => {
      const status = this.getAny(r, ['status', 'Client Status', 'CLIENT STATUS'], 'NOT STARTED');
      const codeName = this.getAny(r, ['code_name', 'codeName', 'CODE NAME', 'CODE', 'code'], 'N/A');

      const roofingCompany = this.getAny(
        r,
        ['roofing_company', 'Roofing Company', 'Roofing Company Name', 'Company Name', 'COMPANY NAME'],
        '—'
      );

      const cityState = this.getAny(
        r,
        ['city_state', 'CITY STATE', 'City State', 'CITY STATE ', 'City State ', 'location', 'Location'],
        'Remote'
      );

      const clientName = this.getAny(
        r,
        ['client_name', 'CLIENT NAME', 'Client Name', 'CLIENT NAME ', 'Client Name '],
        '—'
      );

      const lastLeadReceived = this.getAny(r, ['last_lead_received', 'Last Lead Received'], '');
      const hoursSinceLastLead = this.toNumberSafe(this.getAny(r, ['hours_since_last_lead', 'Hours Since Last Lead'], 0), 0);
      const leadsToday = this.toNumberSafe(this.getAny(r, ['leads_today', 'Leads Today'], 0), 0);
      const leadsYesterday = this.toNumberSafe(this.getAny(r, ['leads_yesterday', 'Leads Yesterday'], 0), 0);

      const purchasedLeads = this.toNumberSafe(this.getAny(r, ['purchased_leads', 'Purchased Leads'], 0), 0);
      const owedLeads = this.toNumberSafe(this.getAny(r, ['owed_leads', 'Owed Leads'], 0), 0);
      const packageStatus = this.getAny(r, ['package_status', 'Package Status', 'Status'], '');
      const purchaseDate = this.getAny(r, ['purchase_date', 'Purchase Date'], '');

      return {
        status,
        code_name: codeName,
        roofing_company: roofingCompany,
        city_state: cityState,
        client_name: clientName,

        last_lead_received: lastLeadReceived,
        hours_since_last_lead: hoursSinceLastLead,
        leads_today: leadsToday,
        leads_yesterday: leadsYesterday,

        purchased_leads: purchasedLeads,
        owed_leads: owedLeads,
        package_status: packageStatus,
        purchase_date: purchaseDate
      };
    });
  }

  // Fallback join-based normalization (kept safe)
  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];

    const statusMap = {};
    (Array.isArray(rawStatuses) ? rawStatuses : []).forEach(row => {
      const company = this.getAny(row, ['Roofing Company', 'Company Name', 'COMPANY NAME'], '');
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

    const clientsArr = Array.isArray(rawClients) ? rawClients : [];
    this.adminState.clients = clientsArr.map(c => {
      const roofingCompany = this.getAny(c, ['COMPANY NAME', 'Company Name', 'Company', 'Roofing Company'], 'Unnamed');
      const codeName = this.getAny(c, ['CODE NAME', 'Code Name', 'CODE', 'Client Code'], 'N/A');

      const clientKey = this.normalizeCompanyKey(roofingCompany);

      const sRow = statusMap[clientKey] || {};
      const pRow = packageMap[clientKey] || {};

      const status = this.getAny(sRow, ['Client Status', 'CLIENT STATUS', 'Status'], this.getAny(c, ['STATUS', 'Status'], 'NOT STARTED'));

      const lastLeadReceived = this.getAny(sRow, ['Last Lead Received'], '');
      const hoursSinceLastLead = this.toNumberSafe(this.getAny(sRow, ['Hours Since Last Lead'], 0), 0);
      const leadsToday = this.toNumberSafe(this.getAny(sRow, ['Leads Today'], 0), 0);
      const leadsYesterday = this.toNumberSafe(this.getAny(sRow, ['Leads Yesterday'], 0), 0);

      const purchasedLeads = this.toNumberSafe(this.getAny(pRow, ['Purchased Leads', 'PURCHASED LEADS'], 0), 0);
      const owedLeads = this.toNumberSafe(this.getAny(pRow, ['Owed Leads', 'OWED LEADS'], 0), 0);
      const packageStatus = this.getAny(pRow, ['Status', 'STATUS'], '');
      const purchaseDate = this.getAny(pRow, ['Purchase Date', 'PURCHASE DATE'], '');

      return {
        status,
        code_name: codeName,
        roofing_company: roofingCompany,
        city_state: this.getAny(sRow, ['CITY STATE', 'City State'], this.getAny(c, ['CITY STATE', 'City State'], 'Remote')),
        client_name: this.getAny(sRow, ['CLIENT NAME', 'Client Name'], '—'),

        last_lead_received: lastLeadReceived,
        hours_since_last_lead: hoursSinceLastLead,
        leads_today: leadsToday,
        leads_yesterday: leadsYesterday,

        purchased_leads: purchasedLeads,
        owed_leads: owedLeads,
        package_status: packageStatus,
        purchase_date: purchaseDate
      };
    });

    // store raw leads/agents too
    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
    this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];
  }

  // ------------------------
  // ✅ ADMIN: Status Options (always include all statuses)
  // ------------------------
  getAdminStatusOptions() {
    const required = ['CRITICAL', 'AT RISK', 'HEALTHY', 'NOT STARTED'];
    const found = new Set();

    (this.adminState.clients || []).forEach(c => {
      const s = (c?.status || '').toString().trim();
      if (s) found.add(s.toUpperCase());
    });

    const all = new Set([...required, ...found]);

    const ordered = [];
    required.forEach(r => { if (all.has(r)) ordered.push(r); all.delete(r); });
    [...all].sort().forEach(x => ordered.push(x));
    return ordered;
  }

  // ------------------------
  // ✅ ADMIN: Performance Builder
  // - totals: total / qualified(confirmed+approved) / unqualified(rejected+credited)
  // - top10Qualified: ranked by qualified only
  // - bottom5: lowest total submitted (includes 0)
  // ------------------------
  buildAdminPerformance(periodKey = 'this-week') {
    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];

    const { start, end } = this.getPeriodRange(periodKey);

    // RAW LEADS mapping based on your sheet screenshot:
    // Date Submitted | Appointment Coordinator Name | Status
    const getLeadDate = (lead) => {
      const v = this.getAny(lead, [
        'Date Submitted', 'DATE SUBMITTED', 'date_submitted',
        'Submitted Date', 'SUBMITTED DATE', 'Date', 'DATE', 'Timestamp', 'TIMESTAMP'
      ], '');
      return this.parseDateSafe(v);
    };

    const getLeadAgentName = (lead) => {
      return this.getAny(lead, [
        'Appointment Coordinator Name', 'APPOINTMENT COORDINATOR NAME',
        'Agent Name', 'AGENT NAME', 'Submitted By', 'SUBMITTED BY', 'agent_name'
      ], 'Unknown').toString().trim();
    };

    const getLeadStatus = (lead) => {
      return this.getAny(lead, ['Status', 'STATUS', 'Lead Status', 'LEAD STATUS'], '')
        .toString()
        .trim()
        .toUpperCase();
    };

    const classifyDecision = (statusUpper) => {
      // qualified
      if (statusUpper.includes('CONFIRM') || statusUpper.includes('APPROV')) return 'QUALIFIED';
      // unqualified
      if (statusUpper.includes('REJECT') || statusUpper.includes('CREDIT')) return 'UNQUALIFIED';
      return 'UNKNOWN';
    };

    // filter in range
    const inRange = [];
    for (const lead of leads) {
      const dt = getLeadDate(lead);
      if (!dt) continue;
      if (dt >= start && dt < end) inRange.push({ lead, dt });
    }

    // aggregate
    const perAgent = {};
    const teamTotals = { total: 0, qualified: 0, unqualified: 0 };

    const ensureAgent = (name) => {
      const key = name || 'Unknown';
      if (!perAgent[key]) perAgent[key] = { name: key, total: 0, qualified: 0, unqualified: 0 };
      return perAgent[key];
    };

    inRange.forEach(({ lead }) => {
      const name = getLeadAgentName(lead);
      const decision = classifyDecision(getLeadStatus(lead));

      const bucket = ensureAgent(name);
      bucket.total += 1;
      teamTotals.total += 1;

      if (decision === 'QUALIFIED') {
        bucket.qualified += 1;
        teamTotals.qualified += 1;
      } else if (decision === 'UNQUALIFIED') {
        bucket.unqualified += 1;
        teamTotals.unqualified += 1;
      }
    });

    const agentsArr = Object.values(perAgent);

    // ✅ Top 10 by QUALIFIED only (confirmed/approved)
    const top10Qualified = agentsArr
      .slice()
      .sort((a, b) => (b.qualified - a.qualified) || (b.total - a.total))
      .slice(0, 10);

    // ✅ Bottom 5 by LOWEST total submitted
    // (includes 0; if you want "only active agents", tell me and I’ll adjust)
    const bottom5 = agentsArr
      .slice()
      .sort((a, b) => (a.total - b.total) || (a.qualified - b.qualified))
      .slice(0, 5);

    // series for chart rendering
    const series = this.buildPerformanceSeries(inRange, periodKey);

    return {
      period: periodKey,
      range: { start: start.toISOString(), end: end.toISOString() },
      totals: teamTotals,
      top10Qualified,
      bottom5,
      series
    };
  }

  // ------------------------
  // ✅ Period Ranges
  // ------------------------
  getPeriodRange(periodKey) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);

    const startOfWeek = (d) => {
      // Monday start
      const day = d.getDay(); // 0..6 (Sun..Sat)
      const diff = (day === 0 ? -6 : 1) - day;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff, 12, 0, 0);
    };

    const tomorrow = addDays(today, 1);

    if (periodKey === 'today') return { start: today, end: tomorrow };

    if (periodKey === 'this-week' || periodKey === 'current-week') {
      const sow = startOfWeek(today);
      return { start: sow, end: addDays(sow, 7) };
    }

    if (periodKey === 'prev-week' || periodKey === 'previous-week') {
      const sow = startOfWeek(today);
      return { start: addDays(sow, -7), end: sow };
    }

    if (periodKey === 'last-4-weeks') {
      const sow = startOfWeek(today);
      return { start: addDays(sow, -28), end: addDays(sow, 7) };
    }

    if (periodKey === 'last-6-weeks') {
      const sow = startOfWeek(today);
      return { start: addDays(sow, -42), end: addDays(sow, 7) };
    }

    if (periodKey === 'all-time') {
      // safe range: last 5 years
      return { start: new Date(today.getFullYear() - 5, 0, 1, 12, 0, 0), end: tomorrow };
    }

    // fallback
    const sow = startOfWeek(today);
    return { start: sow, end: addDays(sow, 7) };
  }

  // ------------------------
  // ✅ Chart-ready series per bucket
  // (total / qualified / unqualified)
  // ------------------------
  buildPerformanceSeries(inRange, periodKey) {
    const buckets = {};
    const pad2 = (n) => String(n).padStart(2, '0');

    const classifyDecision = (statusUpper) => {
      if (statusUpper.includes('CONFIRM') || statusUpper.includes('APPROV')) return 'QUALIFIED';
      if (statusUpper.includes('REJECT') || statusUpper.includes('CREDIT')) return 'UNQUALIFIED';
      return 'UNKNOWN';
    };

    const getStatusUpper = (lead) => {
      return this.getAny(lead, ['Status', 'STATUS', 'Lead Status', 'LEAD STATUS'], '')
        .toString()
        .trim()
        .toUpperCase();
    };

    const addBucket = (key, label, decision) => {
      if (!buckets[key]) buckets[key] = { label, total: 0, qualified: 0, unqualified: 0 };
      buckets[key].total += 1;
      if (decision === 'QUALIFIED') buckets[key].qualified += 1;
      if (decision === 'UNQUALIFIED') buckets[key].unqualified += 1;
    };

    for (const { lead, dt } of inRange) {
      const decision = classifyDecision(getStatusUpper(lead));

      if (periodKey === 'today') {
        const key = `${pad2(dt.getHours())}:00`;
        addBucket(key, key, decision);
      } else if (periodKey === 'this-week' || periodKey === 'prev-week' || periodKey === 'current-week' || periodKey === 'previous-week') {
        const key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
        addBucket(key, key, decision);
      } else if (periodKey === 'last-4-weeks' || periodKey === 'last-6-weeks') {
        const onejan = new Date(dt.getFullYear(), 0, 1, 12, 0, 0);
        const week = Math.ceil((((dt - onejan) / 86400000) + onejan.getDay() + 1) / 7);
        const key = `${dt.getFullYear()}-W${pad2(week)}`;
        addBucket(key, key, decision);
      } else {
        const key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;
        addBucket(key, key, decision);
      }
    }

    return Object.keys(buckets).sort().map(k => ({ key: k, ...buckets[k] }));
  }

  // ------------------------
  // ✅ ADMIN: Set performance period + refresh dashboard
  // ------------------------
  setAdminPerformancePeriod(periodKey) {
    this.currentFilter = periodKey;
    this.adminState.performance = this.buildAdminPerformance(periodKey);
    this.triggerAdminRefresh();
  }
}

// expose instance globally if needed
window.callHammerPortal = window.callHammerPortal || new CallHammerPortal();
