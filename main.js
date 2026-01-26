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
  // ✅ LOGIN + SESSION (ADDED)
  // ------------------------
  saveSession(user) {
    try {
      localStorage.setItem('ch_session', JSON.stringify({ user }));
      this.currentUser = user;
    } catch (e) {
      console.warn('Failed to save session:', e);
    }
  }

  clearSession() {
    try { localStorage.removeItem('ch_session'); } catch (e) {}
    this.currentUser = null;
  }

  routeByRole(roleRaw) {
    const role = String(roleRaw || '').toLowerCase();
    if (role === 'admin') return 'admin-dashboard.html';
    if (role === 'team_leader' || role === 'team leader' || role === 'tl') return 'team-leader-dashboard.html';
    return 'agent-dashboard.html';
  }

  async loginWithCredentials(email, password) {
    const cleanEmail = String(email || '').trim();
    const cleanPassword = String(password || '').trim();

    if (!cleanEmail || !cleanPassword) throw new Error('Missing email or password.');

    const res = await fetch(this.webhooks.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPassword })
    });

    if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}).`);

    const result = await res.json();

    // Support multiple response shapes
    const user =
      result?.user ||
      result?.data?.user ||
      result?.data?.profile ||
      result?.profile ||
      (result?.data && typeof result.data === 'object' ? result.data : null) ||
      (typeof result === 'object' ? result : null);

    if (!user || typeof user !== 'object') {
      console.error('Login response:', result);
      throw new Error('Login failed: user record missing in response.');
    }

    user.role = user.role || user.Role || user.position || user.Position || 'agent';
    user.email = user.email || cleanEmail;

    this.saveSession(user);

    window.location.href = this.routeByRole(user.role);
  }

  tryLoginFromQueryParams() {
    const params = new URLSearchParams(window.location.search || '');
    const email = params.get('email');
    const password = params.get('password');
    if (!email || !password) return;

    // fire and forget (it will redirect on success)
    this.loginWithCredentials(email, password).catch(err => {
      console.error('Query param login failed:', err);
    });
  }

  bindIndexLoginForm() {
    // ✅ matches YOUR index.html IDs
    const form = document.getElementById('loginForm');
    const emailEl = document.getElementById('email');
    const passEl = document.getElementById('password');

    const errorBox = document.getElementById('loginError');
    const errorText = errorBox ? errorBox.querySelector('p') : null;

    const btn = document.getElementById('loginButton');
    const spinner = document.getElementById('loginSpinner');
    const loginText = document.getElementById('loginText');

    if (!form || !emailEl || !passEl) return;

    const setLoading = (on) => {
      if (btn) btn.disabled = !!on;
      if (spinner) spinner.classList.toggle('hidden', !on);
      if (loginText) loginText.classList.toggle('hidden', !!on);
    };

    const showError = (msg) => {
      if (!errorBox) return;
      errorBox.classList.remove('hidden');
      if (errorText) errorText.textContent = msg || 'Login failed.';
      errorBox.classList.add('error-shake');
      setTimeout(() => errorBox.classList.remove('error-shake'), 600);
    };

    const clearError = () => {
      if (!errorBox) return;
      errorBox.classList.add('hidden');
      if (errorText) errorText.textContent = '';
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      setLoading(true);
      try {
        await this.loginWithCredentials(emailEl.value, passEl.value);
      } catch (err) {
        console.error(err);
        showError(err.message || 'Login failed. Please try again.');
        setLoading(false);
      }
    });
  }

  // ------------------------
  // Init / Routing
  // ------------------------
  init() {
    this.checkExistingSession();

    const path = (window.location.pathname || '').toLowerCase();
    const onIndex =
      path.endsWith('index.html') ||
      path.endsWith('/') ||
      path === '' ||
      path.endsWith('/index');

    // ✅ If on index and already logged in, route away immediately
    if (onIndex && this.currentUser) {
      window.location.href = this.routeByRole(this.currentUser.role);
      return;
    }

    // ✅ If on index, bind form + support queryparam login
    if (onIndex) {
      this.bindIndexLoginForm();
      this.tryLoginFromQueryParams();
    }

    this.enforceRoleRouting();
    this.bindEvents();

    const onAnyDashboard = path.includes('dashboard');
    const onAdminDashboard = path.includes('admin-dashboard');

    // Agent/TL dashboards
    if (this.currentUser && onAnyDashboard && !onAdminDashboard) {
      this.fetchAllData?.();
      this.updateProfileUI?.();
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

      // ✅ Ensure a refresh function exists (fallback uses RAW LEADS)
      window.adminDashboard = window.adminDashboard || {};
      if (typeof window.adminDashboard.refreshDashboard !== 'function') {
        window.adminDashboard.refreshDashboard = () => this.refreshAdminAnalyticsFromRawLeads();
      }

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
  // Session / Events (safe)
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
    // keep safe – admin dashboard HTML uses portal.logout()
  }

  // ✅ logout: clear session then go home
  logout() {
    this.clearSession();
    window.location.href = 'index.html';
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

  // ------------------------
  // ✅ Status Helpers used by admin-dashboard.html
  // ------------------------
  isQualifiedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CONFIRM') || s.includes('APPROV') || s.includes('QUALIF');
  }

  isUnqualifiedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('REJECT') || s.includes('CREDIT') || s.includes('DECLIN') || s.includes('CANCEL') || s.includes('UNQUAL');
  }

  formatCurrency(v) {
    const n = this.toNumberSafe(v, 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  // ------------------------
  // ✅ MST + Payroll week helpers (SAT → FRI) used by admin-dashboard.html
  // ------------------------
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

  // Payroll week start = Saturday (MST)
  getPayrollWeekStart(date = new Date()) {
    const mst = this.toMST(date);
    const d = new Date(mst);
    d.setHours(0, 0, 0, 0);

    // JS getDay(): Sun=0 ... Sat=6
    // We want Saturday start -> 6
    const day = d.getDay();
    const diffToSat = (day - 6 + 7) % 7; // days since last Saturday
    d.setDate(d.getDate() - diffToSat);
    return d;
  }

  // payroll week range: Sat 00:00:00 → Fri 23:59:59.999
  getPayrollWeekRange(date = new Date()) {
    const start = this.getPayrollWeekStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  getPreviousPayrollWeekRange(date = new Date()) {
    const thisWeek = this.getPayrollWeekRange(date);
    const prevStart = new Date(thisWeek.start);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(thisWeek.end);
    prevEnd.setDate(prevEnd.getDate() - 7);
    return { start: prevStart, end: prevEnd };
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

      // ✅ IMPORTANT: support {status:"success", healthMonitor:[...]} AND {data:{...}}
      const dataRoot = result?.data || result || {};

      const rawHealthMonitor =
        dataRoot.healthMonitor ||
        result.healthMonitor ||
        [];

      const rawClients =
        dataRoot.clients || dataRoot.Clients || dataRoot.CLIENTS ||
        result.clients || result.Clients || result.CLIENTS || [];

      const rawLeads =
        dataRoot.leads || dataRoot.Leads || dataRoot.LEADS ||
        dataRoot.rawLeads || dataRoot['RAW LEADS'] ||
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

      // ✅ If healthMonitor exists, use it for Client Health Monitor
      if (Array.isArray(rawHealthMonitor) && rawHealthMonitor.length > 0) {
        this.normalizeAdminFromHealthMonitor(rawHealthMonitor);

        // still store these if present
        this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
        this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];
        this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
        this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];
      } else {
        // fallback join-based
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
    if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
      window.adminDashboard.refreshDashboard();
    } else {
      // ✅ fallback: still try to compute from raw leads
      try { this.refreshAdminAnalyticsFromRawLeads(); } catch (e) {}
      console.warn('⚠️ adminDashboard.refreshDashboard not found.');
    }
  }

  // ✅ ADMIN: normalize from healthMonitor
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

      const cityState = this.getAny(r, ['city_state', 'CITY STATE', 'City State', 'location', 'Location'], 'Remote');

      const clientName = this.getAny(r, ['client_name', 'CLIENT NAME', 'Client Name'], '—');

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
        purchase_date: purchaseDate,
      };
    });
  }

  // Fallback join-based normalization
  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];

    // store raw leads/agents too
    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
    this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];

    // basic fallback: keep clients as-is but normalize minimal fields if needed
    const clientsArr = Array.isArray(rawClients) ? rawClients : [];
    this.adminState.clients = clientsArr.map(c => ({
      status: this.getAny(c, ['STATUS', 'Status', 'Client Status', 'CLIENT STATUS'], 'NOT STARTED'),
      code_name: this.getAny(c, ['CODE NAME', 'Code Name', 'CODE', 'Client Code'], 'N/A'),
      roofing_company: this.getAny(c, ['COMPANY NAME', 'Company Name', 'Roofing Company'], '—'),
      city_state: this.getAny(c, ['CITY STATE', 'City State', 'Location'], 'Remote'),
      client_name: this.getAny(c, ['CLIENT NAME', 'Client Name'], '—'),
      last_lead_received: '',
      hours_since_last_lead: 0,
      leads_today: 0,
      leads_yesterday: 0,
      purchased_leads: 0,
      owed_leads: 0,
      package_status: '',
      purchase_date: ''
    }));
  }

  // ------------------------
  // ✅ ADMIN ANALYTICS FROM RAW LEADS (ADDED)
  // ------------------------
  refreshAdminAnalyticsFromRawLeads() {
    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];
    if (!leads.length) {
      console.warn('⚠️ RAW LEADS is empty (adminState.leads). If this is wrong, webhook/dashboard-data is not returning leads.');
      return;
    }

    // Range selector: tries to find active pill (Today / This Week / Previous Week / 4 Weeks / 6 Weeks / All-Time)
    const rangeKey = (() => {
      const btns = Array.from(document.querySelectorAll('button, a'))
        .filter(el => /today|this week|previous week|4 weeks|6 weeks|all-time/i.test(el.textContent || ''));
      const active = btns.find(el =>
        el.classList.contains('active') ||
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-current') === 'true'
      );
      const t = (active?.textContent || '').toLowerCase();
      if (t.includes('all')) return 'all-time';
      if (t.includes('previous')) return 'previous-week';
      if (t.includes('6')) return '6-weeks';
      if (t.includes('4')) return '4-weeks';
      if (t.includes('this week')) return 'this-week';
      return 'today';
    })();

    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

    const computeRange = () => {
      const now = new Date();
      if (rangeKey === 'all-time') return { start: new Date(2000,0,1), end: endOfDay(now) };
      if (rangeKey === 'today') return { start: startOfDay(now), end: endOfDay(now) };

      // week Mon..Sun
      const day = now.getDay(); // Sun=0
      const diffToMon = (day + 6) % 7;
      const mon = startOfDay(addDays(now, -diffToMon));
      const sun = endOfDay(addDays(mon, 6));

      if (rangeKey === 'this-week') return { start: mon, end: sun };
      if (rangeKey === 'previous-week') {
        const prevMon = addDays(mon, -7);
        return { start: prevMon, end: endOfDay(addDays(prevMon, 6)) };
      }
      if (rangeKey === '4-weeks') return { start: startOfDay(addDays(now, -28)), end: endOfDay(now) };
      if (rangeKey === '6-weeks') return { start: startOfDay(addDays(now, -42)), end: endOfDay(now) };

      return { start: startOfDay(now), end: endOfDay(now) };
    };

    const { start, end } = computeRange();

    const getLeadDate = (lead) => this.getAny(lead, [
      'lead_date', 'Lead Date', 'DATE', 'Date',
      'created_at', 'Created At', 'timestamp', 'Timestamp',
      'appointment_date', 'Appointment Date'
    ], '');

    const getLeadStatus = (lead) => this.getAny(lead, [
      'status', 'Status', 'LEAD STATUS', 'Lead Status',
      'disposition', 'Disposition', 'result', 'Result'
    ], '');

    const getLeadAgent = (lead) => this.getAny(lead, [
      'agent', 'Agent', 'AGENT NAME', 'Agent Name',
      'set_by', 'Set By', 'setter', 'Setter',
      'agent_email', 'Agent Email', 'email', 'Email'
    ], 'Unknown');

    const inRange = leads.filter(l => {
      const dt = this.parseDateSafe(getLeadDate(l));
      if (!dt) return false;
      return dt >= start && dt <= end;
    });

    let total = inRange.length;
    let qualified = 0;
    let unqualified = 0;
    let pending = 0;

    const agentQualified = new Map();

    for (const l of inRange) {
      const status = getLeadStatus(l);
      if (this.isQualifiedStatus(status)) {
        qualified++;
        const a = String(getLeadAgent(l) || 'Unknown').trim() || 'Unknown';
        agentQualified.set(a, (agentQualified.get(a) || 0) + 1);
      } else if (this.isUnqualifiedStatus(status)) {
        unqualified++;
      } else {
        pending++;
      }
    }

    const denom = qualified + unqualified;
    const cancelRate = denom === 0 ? 0 : (unqualified / denom);
    const cancelPct = `${Math.round(cancelRate * 100)}%`;

    // ✅ Set KPI numbers by finding the label text and updating a nearby number
    const setKpiByLabel = (labelText, valueText) => {
      const label = String(labelText).trim().toLowerCase();
      const els = Array.from(document.querySelectorAll('*'))
        .filter(el => (el.textContent || '').trim().toLowerCase() === label);

      for (const el of els) {
        const card = el.closest('div') || el.parentElement;
        if (!card) continue;

        const candidates = Array.from(card.querySelectorAll('div, span, p, h1, h2, h3'))
          .filter(x => x !== el)
          .map(x => ({ el: x, txt: (x.textContent || '').trim() }))
          .filter(x => x.txt.length <= 20); // avoid big paragraphs

        const num = candidates.find(x => /^[\d,$.%]+$/.test(x.txt));
        if (num) { num.el.textContent = valueText; return true; }
      }
      return false;
    };

    setKpiByLabel('TOTAL LEADS', String(total));
    setKpiByLabel('QUALIFIED', String(qualified));
    setKpiByLabel('UNQUALIFIED', String(unqualified));
    setKpiByLabel('PENDING', String(pending));
    setKpiByLabel('CANCELLATION RATE', cancelPct);

    // ✅ Fill Top/Bottom tables if present
    const fillTableByHeader = (headerContains, rowsHtml) => {
      const titleEls = Array.from(document.querySelectorAll('*'))
        .filter(el => (el.textContent || '').toLowerCase().includes(String(headerContains).toLowerCase()))
        .slice(0, 5);

      for (const t of titleEls) {
        const block = t.closest('div');
        const table = block ? block.querySelector('table') : null;
        const tbody = table ? table.querySelector('tbody') : null;
        if (tbody) {
          tbody.innerHTML = rowsHtml;
          return true;
        }
      }
      return false;
    };

    const top10 = Array.from(agentQualified.entries())
      .sort((a,b) => b[1] - a[1])
      .slice(0, 10);

    const topRows = top10.length ? top10.map(([agent, cnt]) => `
      <tr class="border-t">
        <td class="py-3 px-4 text-sm text-gray-900">${agent}</td>
        <td class="py-3 px-4 text-sm text-gray-900">${cnt}</td>
        <td class="py-3 px-4 text-sm text-green-600">${cnt}</td>
        <td class="py-3 px-4 text-sm text-red-600">0</td>
        <td class="py-3 px-4 text-sm text-gray-600">0%</td>
      </tr>
    `).join('') : `<tr><td colspan="5" class="py-6 text-center text-sm text-gray-500">No leads in this period.</td></tr>`;

    const bottom5 = Array.from(agentQualified.entries())
      .sort((a,b) => a[1] - b[1])
      .slice(0, 5);

    const bottomRows = bottom5.length ? bottom5.map(([agent, cnt]) => `
      <tr class="border-t">
        <td class="py-3 px-4 text-sm text-gray-900">${agent}</td>
        <td class="py-3 px-4 text-sm text-gray-900">${cnt}</td>
        <td class="py-3 px-4 text-sm text-green-600">${cnt}</td>
        <td class="py-3 px-4 text-sm text-red-600">0</td>
        <td class="py-3 px-4 text-sm text-gray-600">0%</td>
      </tr>
    `).join('') : `<tr><td colspan="5" class="py-6 text-center text-sm text-gray-500">No leads in this period.</td></tr>`;

    fillTableByHeader('Top 10 Agents', topRows);
    fillTableByHeader('Bottom 5 Agents', bottomRows);

    console.log('✅ Admin analytics updated from RAW LEADS', {
      rangeKey, total, qualified, unqualified, pending, cancelPct
    });
  }
}

// Make sure the Admin Dashboard finds `window.portal`
window.portal = window.portal || new CallHammerPortal();
