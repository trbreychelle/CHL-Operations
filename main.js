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
  // ✅ LOGIN + SESSION
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

    if (!cleanEmail || !cleanPassword) {
      throw new Error('Missing email or password.');
    }

    const res = await fetch(this.webhooks.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPassword })
    });

    if (!res.ok) {
      throw new Error(`Login failed (HTTP ${res.status}).`);
    }

    const result = await res.json();

    // Support multiple response shapes
    const user =
      result?.user ||
      result?.data?.user ||
      result?.data?.profile ||
      result?.profile ||
      result?.data ||
      null;

    if (!user || typeof user !== 'object') {
      console.error('Login response:', result);
      throw new Error('Login failed: user record missing in response.');
    }

    user.role = user.role || user.Role || user.position || user.Position || 'agent';
    user.email = user.email || cleanEmail;

    this.saveSession(user);

    window.location.href = this.routeByRole(user.role);
  }

  async tryLoginFromQueryParams() {
    const params = new URLSearchParams(window.location.search || '');
    const email = params.get('email');
    const password = params.get('password');

    if (!email || !password) return false;

    try {
      await this.loginWithCredentials(email, password);
      return true;
    } catch (err) {
      console.error('Query param login failed:', err);
      return false;
    }
  }

  // ✅ Binds to YOUR index.html IDs: loginForm/email/password/loginButton/loginError/loginSpinner/loginText
  bindIndexLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    const emailEl = document.getElementById('email');
    const passEl = document.getElementById('password');
    const btn = document.getElementById('loginButton');

    const errWrap = document.getElementById('loginError');
    const errText = errWrap ? errWrap.querySelector('p') : null;

    const spinner = document.getElementById('loginSpinner');
    const loginText = document.getElementById('loginText');

    const setLoading = (isLoading) => {
      if (btn) btn.disabled = !!isLoading;
      if (spinner) spinner.classList.toggle('hidden', !isLoading);
      if (loginText) loginText.classList.toggle('hidden', !!isLoading);
    };

    const showError = (msg) => {
      if (!errWrap) return;
      errWrap.classList.remove('hidden');
      if (errText) errText.textContent = msg || 'Login failed. Please try again.';
      errWrap.classList.add('error-shake');
      setTimeout(() => errWrap.classList.remove('error-shake'), 600);
    };

    const clearError = () => {
      if (!errWrap) return;
      errWrap.classList.add('hidden');
      if (errText) errText.textContent = '';
    };

    const run = async (e) => {
      if (e) e.preventDefault();
      clearError();

      const email = emailEl ? emailEl.value : '';
      const password = passEl ? passEl.value : '';

      try {
        setLoading(true);
        await this.loginWithCredentials(email, password);
      } catch (err) {
        console.error(err);
        showError(err?.message || 'Login failed. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    form.addEventListener('submit', run);
    if (btn) btn.addEventListener('click', run);
  }

  // Override logout: clear session then go to index
  logout() {
    this.clearSession();
    window.location.href = 'index.html';
  }

  // ------------------------
  // Init / Routing
  // ------------------------
  init() {
    this.checkExistingSession();

    const path = (window.location.pathname || '').toLowerCase();
    const onIndex =
      path.endsWith('index.html') ||
      path === '/' ||
      path === '' ||
      path.endsWith('/index') ||
      path.endsWith('/index.html');

    // ✅ If already logged in and on index, route immediately
    if (onIndex && this.currentUser) {
      window.location.href = this.routeByRole(this.currentUser.role);
      return;
    }

    // ✅ If on index, bind form + allow URL param login
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

  // ✅ date-only parsing without timezone shifting + supports Sheets serial numbers
  parseDateSafe(value) {
    if (value === null || value === undefined || value === '') return null;

    // ✅ Google Sheets serial date support
    if (typeof value === 'number' && isFinite(value)) {
      // serial dates are usually > 20000
      if (value > 20000) {
        const base = new Date(Date.UTC(1899, 11, 30));
        const ms = base.getTime() + value * 24 * 60 * 60 * 1000;
        const dt = new Date(ms);
        return isNaN(dt.getTime()) ? null : dt;
      }
      // epoch ms/seconds
      if (value > 1e12) {
        const dt = new Date(value);
        return isNaN(dt.getTime()) ? null : dt;
      }
      if (value > 1e9) {
        const dt = new Date(value * 1000);
        return isNaN(dt.getTime()) ? null : dt;
      }
    }

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
      const dt = new Date(y, m, d, 12, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Fallback
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // ------------------------
  // ✅ Status Helpers (UPDATED FOR NEW DASHBOARD LOGIC)
  // ------------------------
  // Qualified = Confirmed / Approved
  isQualifiedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CONFIRM') || s.includes('APPROV');
  }

  // ✅ NEW: QC Rejected = Rejected only
  isRejectedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('REJECT');
  }

  // ✅ NEW: Credited only (this is your "Unqualified" in the UI now)
  isCreditedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CREDIT');
  }

  // Pending review
  isPendingStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('PENDING');
  }

  formatCurrency(v) {
    const n = this.toNumberSafe(v, 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  // ------------------------
  // ✅ MST + Payroll week helpers (SAT → FRI)
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

    const day = d.getDay(); // Sun=0 ... Sat=6
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
  // ✅ ADMIN ANALYTICS FROM RAW LEADS (UPDATED)
  // ------------------------
  getLeadDateValue(lead) {
    return this.getAny(lead, [
      'lead_date', 'Lead Date', 'DATE', 'Date',
      'created_at', 'Created At', 'timestamp', 'Timestamp',
      'TimeStamp', 'Submitted At', 'submitted_at',
      'Appointment Date', 'appointment_date',
      'Date Submitted', 'date_submitted',
      'Submission Date', 'submission_date'
    ], '');
  }

  getLeadStatusValue(lead) {
    return this.getAny(lead, [
      'status', 'Status',
      'Lead Status', 'LEAD STATUS', 'lead_status',
      'Disposition', 'disposition'
    ], '');
  }

  // which range button is selected on admin dashboard
  getSelectedAdminRangeKey() {
    const candidates = Array.from(document.querySelectorAll('button, a'))
      .filter(el => /today|this week|previous week|4 weeks|6 weeks|all-time/i.test(el.textContent || ''))
      .filter(el => el.classList.contains('active') || el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-selected') === 'true');

    const text = (candidates[0]?.textContent || 'today').toLowerCase();
    if (text.includes('all')) return 'all-time';
    if (text.includes('previous')) return 'previous-week';
    if (text.includes('6')) return '6-weeks';
    if (text.includes('4')) return '4-weeks';
    if (text.includes('this week')) return 'this-week';
    return 'today';
  }

  computeAdminDateRange(rangeKey) {
    const now = new Date();

    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };

    const day = now.getDay(); // Sun=0..Sat=6
    const monday = addDays(startOfDay(now), (day === 0 ? -6 : 1 - day)); // Monday start

    if (rangeKey === 'all-time') return { start: new Date(2000,0,1), end: endOfDay(now) };
    if (rangeKey === 'today') return { start: startOfDay(now), end: endOfDay(now) };
    if (rangeKey === 'this-week') return { start: monday, end: endOfDay(now) };
    if (rangeKey === 'previous-week') {
      const prevMon = addDays(monday, -7);
      const prevSun = addDays(prevMon, 6);
      return { start: prevMon, end: endOfDay(prevSun) };
    }
    if (rangeKey === '4-weeks') return { start: addDays(startOfDay(now), -28), end: endOfDay(now) };
    if (rangeKey === '6-weeks') return { start: addDays(startOfDay(now), -42), end: endOfDay(now) };

    return { start: startOfDay(now), end: endOfDay(now) };
  }

  setMetricByLabel(labelText, valueText) {
    const label = String(labelText || '').toLowerCase();
    const all = Array.from(document.querySelectorAll('*'))
      .filter(el => (el.textContent || '').trim().toLowerCase() === label);

    for (const lbl of all) {
      let card = lbl.closest('div');
      for (let i = 0; i < 6 && card; i++) {
        const candidates = Array.from(card.querySelectorAll('div,span,p,h1,h2,h3'))
          .filter(x => /\d|%/.test((x.textContent || '').trim()))
          .sort((a,b) => (b.textContent || '').trim().length - (a.textContent || '').trim().length);

        const big = candidates.find(x => /^[\d,]+(\.\d+)?%?$/.test((x.textContent || '').trim()));
        if (big) { big.textContent = valueText; return true; }

        card = card.parentElement;
      }
    }
    return false;
  }

  // ✅ UPDATED to support QC Rejected + Credited split + new KPI labels
  refreshAdminAnalyticsFromRawLeads() {
    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];
    if (!leads.length) {
      console.warn('⚠️ No raw leads found in adminState.leads. Check n8n response includes "leads".');
      return;
    }

    const rangeKey = this.getSelectedAdminRangeKey();
    const { start, end } = this.computeAdminDateRange(rangeKey);

    const inRange = leads.filter(l => {
      const dt = this.parseDateSafe(this.getLeadDateValue(l));
      if (!dt) return false;
      return dt >= start && dt <= end;
    });

    const total = inRange.length;
    let qualified = 0;
    let qcRejected = 0;
    let credited = 0;
    let pending = 0;

    for (const l of inRange) {
      const status = this.getLeadStatusValue(l);
      if (this.isQualifiedStatus(status)) qualified++;
      else if (this.isRejectedStatus(status)) qcRejected++;
      else if (this.isCreditedStatus(status)) credited++;
      else if (this.isPendingStatus(status)) pending++;
      else pending++; // unknown -> treat as pending
    }

    // ✅ Cancellation Rate = Credited / (Qualified + Credited)
    const denom = qualified + credited;
    const cancelRate = denom > 0 ? Math.round((credited / denom) * 100) : 0;

    // ✅ Update metric cards (best-effort by labels)
    // Note: your new HTML uses "QC REJECTED" and "CREDITED" KPI tiles
    this.setMetricByLabel('TOTAL LEADS', String(total));
    this.setMetricByLabel('QUALIFIED', String(qualified));
    this.setMetricByLabel('QC REJECTED', String(qcRejected));
    this.setMetricByLabel('CREDITED', String(credited));
    this.setMetricByLabel('PENDING', String(pending));
    this.setMetricByLabel('CANCELLATION RATE', `${cancelRate}%`);

    console.log('✅ Admin analytics computed from RAW leads:', {
      rangeKey, start, end, total, qualified, qcRejected, credited, pending, cancelRate
    });
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

      const rawHealthMonitor =
        dataRoot.healthMonitor ||
        result.healthMonitor ||
        [];

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

      if (Array.isArray(rawHealthMonitor) && rawHealthMonitor.length > 0) {
        this.normalizeAdminFromHealthMonitor(rawHealthMonitor);

        this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
        this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];
        this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
        this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];
      } else {
        this.normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages);
      }

      console.log('✅ Admin State Ready:', {
        clients: this.adminState.clients.length,
        leads: this.adminState.leads.length,
        agents: this.adminState.agents.length
      });

      this.triggerAdminRefresh();

            setTimeout(() => {
        try {
          // ✅ IMPORTANT:
          // If the admin dashboard already computes KPIs + tables + chart (AdminDashboard.updateAnalytics),
          // do NOT overwrite KPI tiles using DOM label search.
          if (window.Admin && typeof window.Admin.updateAnalytics === 'function') {
            // ensure analytics stays consistent after data refresh
            window.Admin.updateAnalytics(window.Admin.analyticsPeriod || 'today');
            return;
          }

          // fallback only (if admin dashboard script isn't present)
          this.refreshAdminAnalyticsFromRawLeads();
        } catch (e) {
          console.error(e);
        }
      }, 150);

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

      // ✅ keep these, admin-dashboard now shows them
      const packageStatus = this.getAny(r, ['package_status', 'Package Status'], '');
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

    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
    this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];

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
}

// Make sure the Admin Dashboard finds `window.portal`
window.portal = window.portal || new CallHammerPortal();
