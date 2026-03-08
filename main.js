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
      weeklyPayroll: [],  // ✅ Added for Payroll
      payrollHistory: []  // ✅ Added for Payroll
    };

    // Cache to avoid Google Sheets quota/too-many-requests issues
    this.lastAdminFetch = 0;
    this.adminCacheMs = 60_000; // 60s

    this.webhooks = {
      login: 'https://automate.callhammerleads.com/webhook/agent-login',
      fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data',
      fetchTLData: 'https://automate.callhammerleads.com/webhook/fetch-tl-data',
      fetchAdminData: 'https://automate.callhammerleads.com/webhook/dashboard-data-v2',
      
      // ✅ PAYROLL
      payrollData: 'https://automate.callhammerleads.com/webhook/payroll-data',

      timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
      changePassword: 'https://automate.callhammerleads.com/webhook/change-password',
      manageEmployee: 'https://automate.callhammerleads.com/webhook/manage-employee',
      // ✅ PASSBOOK
      passbookClientsList: 'https://automate.callhammerleads.com/webhook/passbook-clients-list',
      passbookClientDetails: 'https://automate.callhammerleads.com/webhook/passbook-client',
      passbookClientUpdate: 'https://automate.callhammerleads.com/webhook/passbook-client-update',
      
      // ✅ ADD THESE TWO NEW WEBHOOKS FOR LEADS
      updateLead: 'https://automate.callhammerleads.com/webhook/update-lead',
      deleteLead: 'https://automate.callhammerleads.com/webhook/delete-lead',
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
    // FIXED: Properly sends Team Leaders to the Sales Dashboard
    if (role === 'team_leader' || role === 'team leader' || role === 'tl') return 'salesdashboard.html';
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

    if (onIndex && this.currentUser) {
      window.location.href = this.routeByRole(this.currentUser.role);
      return;
    }

    if (onIndex) {
      this.bindIndexLoginForm();
      this.tryLoginFromQueryParams();
    }

    this.enforceRoleRouting();
    this.bindEvents();
    this.bindPassbookUpdateButton();

    if (path.includes('passbook') || document.querySelector('[data-page="passbook-clients"]')) {
      setTimeout(() => this.loadPassbookClientsList(true), 300);
    }

    // 🔥 THE FIX: Make Javascript look at the HTML structure, NOT the file name!
    const isCommandCenter = document.getElementById('view-overview') !== null;
    const isOldAgentDash = document.getElementById('stat-appointments') !== null;

    // Load Agent Dashboard
    if (this.currentUser && isOldAgentDash && !isCommandCenter) {
      this.fetchAllData?.();
      this.updateProfileUI?.();
      this.startMSTClock();
    }

    // Load Admin OR Sales Dashboard
    if (isCommandCenter) {
      console.log("🟢 Command Center Detected! Fetching Master Data...");
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      
      setTimeout(() => {
        this.fetchAdminData(false);
        this.loadPayrollData(false); 
      }, 300);

      this.startAdminAutoRefresh();
    }
  }

  enforceRoleRouting() {
    if (!this.currentUser) return;

    const path = (window.location.pathname || '').toLowerCase();
    const role = (this.currentUser.role || 'agent').toLowerCase();

    // If we aren't on a dashboard page, don't do anything
    if (!path.includes('dashboard') && !path.includes('admin')) return;

    const onAdmin = path.includes('admin');
    const onAgent = path.includes('agent');
    const onSales = path.includes('sales');

    if (role === 'admin' && !onAdmin) window.location.href = 'admin-dashboard.html';
    else if ((role === 'team_leader' || role === 'team leader' || role === 'tl') && !onSales) window.location.href = 'salesdashboard.html';
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
  // ✅ AGENT DATA FETCHING & RENDERING (ADDED)
  // ------------------------

  async fetchAllData() {
    if (!this.currentUser || !this.currentUser.email) return;

    // 1. Setup UI for loading state
    const stats = ['stat-appointments', 'stat-cancel-rate', 'stat-incentives', 'stat-hours'];
    stats.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerText = '...';
    });

    try {
      console.log('📡 Fetching Agent Data for:', this.currentUser.email);
      
      // 2. Call the webhook
      const response = await fetch(this.webhooks.fetchData, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: this.currentUser.email,
          range: document.getElementById('timeframe-filter')?.value || 'this-week'
        })
      });

      if (!response.ok) throw new Error('Failed to fetch agent data');

      const result = await response.json();
      
      // Handle different n8n response structures
      const data = result.data || result; 

      // 3. Update the Dashboard
      this.updateAgentDashboard(data);
      this.renderLeadsTable(data.leads || []);
      this.renderCharts(data.charts || {});
      this.updateProfileUI(data.profile || this.currentUser);

    } catch (error) {
      console.error('❌ Error fetching agent data:', error);
    }
  }

  updateAgentDashboard(data) {
    // Helper to safely set text
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    };

    // 1. Top Cards
    setText('stat-appointments', data.totalAppointments || 0);
    setText('stat-cancel-rate', (data.cancellationRate || 0) + '%');
    setText('stat-incentives', this.formatCurrency(data.totalIncentives || 0));
    setText('stat-hours', data.weeklyHours || 0);

    // 2. Monthly Incentive Status
    setText('monthly-incentive-status-ov', data.monthlyIncentiveStatus || 'Not qualified yet');
    setText('monthly-raffle-status-ov', data.raffleStatus || '0 / 4 weeks qualified');

    // 3. Tier Progress Bar
    const tierCount = data.approvedAppointments || 0;
    const tierMax = 6; // Tier 1 goal
    const percentage = Math.min(100, (tierCount / tierMax) * 100);
      
    setText('tier-count-display', `${tierCount} / ${tierMax} approved appointments`);
    const progressBar = document.getElementById('tier-progress-bar');
    if (progressBar) progressBar.style.width = `${percentage}%`;
      
    // Handle loading text update
    const tierStatusText = document.getElementById('tier-status-text');
    if(tierStatusText) tierStatusText.innerText = 'Tier 1 Progress';
  }

  renderLeadsTable(leads) {
    const tbody = document.getElementById('leads-table-body');
    if (!tbody) return;

    if (leads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="px-6 py-4 text-center text-sm text-gray-500">No leads found for this period.</td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map(lead => {
      // Determine badge color based on status
      let badgeClass = 'bg-gray-100 text-gray-800';
      const status = (lead.status || 'Pending').toLowerCase();
      
      if (status.includes('confirm') || status.includes('approv')) badgeClass = 'bg-green-100 text-green-800';
      else if (status.includes('reject')) badgeClass = 'bg-red-100 text-red-800';
      else if (status.includes('pending')) badgeClass = 'bg-yellow-100 text-yellow-800';

      return `
        <tr>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.formatDate(lead.date)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${lead.homeowner || 'Unknown'}</td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${badgeClass}">
              ${lead.status || 'Pending'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderCharts(chartData) {
    // 1. Appointments Chart
    const aptChartDom = document.getElementById('appointmentsChart');
    if (aptChartDom && window.echarts) {
      if (!this.charts) this.charts = {};
      this.charts.appointments = echarts.init(aptChartDom);
      
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: chartData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { type: 'value' },
        series: [{
          data: chartData.appointments || [0, 0, 0, 0, 0],
          type: 'bar',
          itemStyle: { color: '#FBBF24' },
          barWidth: '40%'
        }]
      };
      this.charts.appointments.setOption(option);
    }

    // 2. Incentives Chart (Line Chart)
    const incChartDom = document.getElementById('incentivesChart');
    if (incChartDom && window.echarts) {
      this.charts.incentives = echarts.init(incChartDom);
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: chartData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { type: 'value' },
        series: [{
          data: chartData.earnings || [0, 0, 0, 0, 0],
          type: 'line',
          smooth: true,
          lineStyle: { color: '#D97706', width: 3 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{offset: 0, color: 'rgba(251, 191, 36, 0.5)'}, {offset: 1, color: 'rgba(251, 191, 36, 0.01)'}]) }
        }]
      };
      this.charts.incentives.setOption(option);
    }
  }

  updateProfileUI(profile) {
    if (!profile) return;
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      
    setText('nav-user-name', profile.name || this.currentUser.name || 'Agent');
    setText('profileName', profile.name || this.currentUser.name);
    setText('profileEmail', profile.email || this.currentUser.email);
    setText('profilePosition', profile.role || 'Agent');
    setText('profileRate', this.formatCurrency(profile.baseRate || 0));
    setText('profileHours', profile.weeklyHours || 0);

    // Also update monthly incentive snapshots in profile tab if they exist
    setText('monthly-incentive-status-prof', profile.monthlyIncentiveStatus || 'Not qualified yet');
    setText('monthly-raffle-status-prof', profile.raffleStatus || '0 / 4 weeks qualified');
      
    if (profile.hourlyIncrease) {
        setText('milestone-hourly-increase', this.formatCurrency(profile.hourlyIncrease));
        setText('effective-hourly-rate', this.formatCurrency((profile.baseRate || 0) + profile.hourlyIncrease));
    }
  }

  formatDate(dateString) {
    if(!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ------------------------
  // ✅ ADMIN: Fetch + Normalize
  // ------------------------
  async fetchAdminData(forceRefresh = false) {
    try {
      console.log('📡 Fetching Admin Dashboard Data...');
      const response = await fetch(this.webhooks.fetchAdminData, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error(`Admin Data Error: HTTP ${response.status}`);

      const result = await response.json();
      this.lastAdminFetch = Date.now();

      const dataRoot = result?.data || result || {};
      const rawHealthMonitor = dataRoot.healthMonitor || result.healthMonitor || [];
      const rawClients = dataRoot.clients || dataRoot.Clients || dataRoot.CLIENTS || result.clients || [];
      const rawAgents = dataRoot.agents || dataRoot.Agents || dataRoot.AGENTS || result.agents || [];
      const rawStatuses = dataRoot.clientStatuses || dataRoot.statuses || result.clientStatuses || [];
      const rawPackages = dataRoot.packages || dataRoot.leadPackages || result.packages || [];

      // 🔥 THE MAGIC FIX: Pull Leads DIRECTLY from Supabase to bypass Google Sheets API limits!
      let supaLeads = [];
      if (window.supaClient) {
          console.log("⚡ Fetching Leads directly from Supabase for unlimited speed...");
          const { data, error } = await window.supaClient.from('leads_raw').select('*');
          if (!error && data) {
              supaLeads = data;
          } else {
              console.error("Supabase leads fetch error:", error);
          }
      }
      
      // Use Supabase if available, otherwise fallback to n8n payload
      const rawLeads = supaLeads.length > 0 ? supaLeads : (dataRoot.leads || dataRoot.Leads || result.leads || []);

      if (Array.isArray(rawHealthMonitor) && rawHealthMonitor.length > 0) {
        this.normalizeAdminFromHealthMonitor(rawHealthMonitor);
        this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
        this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];
        this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
        this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];
      } else {
        this.normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages);
      }

      console.log('✅ Admin State Ready. Triggering render...');
      this.triggerAdminRefresh();

    } catch (err) {
      console.error('❌ fetchAdminData failed:', err);
      const tbody = document.getElementById("client-health-body");
      if (tbody) tbody.innerHTML = `<tr><td colspan="14" class="p-6 text-center text-red-500 font-bold">❌ Connection Error: Could not load data from n8n. Please check your webhook.</td></tr>`;
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

  // ============================================================
  // ✅ ADDED ONLY: PASSBOOK UPDATE → calls n8n webhook + refreshes UI
  // ============================================================

  // Step 3 — Add a function sa main.js to actually load the Passbook Clients List
  async loadPassbookClientsList(force = false) {
    try {
      const url = new URL(this.webhooks.passbookClientsList);

      // ✅ cache-bust para sure tatama sa n8n at hindi cached
      url.searchParams.set('ts', Date.now());

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Passbook list failed (HTTP ${res.status}).`);

      const data = await res.json();

      // support multiple response shapes
      const clients =
        data?.clients ||
        data?.data?.clients ||
        data?.data ||
        [];

      console.log('✅ Passbook clients list loaded:', clients.length);

      // TODO: dito mo i-render/update UI count + cards
      // Example: update count element if meron ka
      const countEl = document.querySelector('#passbookClientsCount');
      if (countEl) countEl.textContent = `Showing ${clients.length} clients`;

      // optional: store
      this.adminState.passbookClients = clients;

      return clients;
    } catch (e) {
      console.error('❌ loadPassbookClientsList error:', e);
      return [];
    }
  }
  
  // ✅ NEW METHOD: Load Payroll Data
  async loadPayrollData(force = false) {
    try {
      const url = new URL(this.webhooks.payrollData);

      // cache-bust
      url.searchParams.set('ts', Date.now());

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Payroll data failed (HTTP ${res.status}).`);

      const json = await res.json();

      // support multiple response shapes
      const root = json?.data || json || {};

      const weeklyPayroll =
        root.weeklyPayroll ||
        root.weekly_payroll ||
        root.weekly ||
        [];

      const payrollHistory =
        root.payrollHistory ||
        root.payroll_history ||
        root.history ||
        [];

      // Store on portal (so UI can read it)
      this.weeklyPayroll = Array.isArray(weeklyPayroll) ? weeklyPayroll : [];
      this.timeTracker = Array.isArray(root.timeTracker || root.time_tracker) ? (root.timeTracker || root.time_tracker) : [];

      // Also store in adminState (so admin dashboard can read it if needed)
      this.adminState.weeklyPayroll = this.weeklyPayroll;
      this.adminState.payrollHistory = Array.isArray(payrollHistory) ? payrollHistory : [];

      console.log('✅ Payroll data loaded:', {
        weeklyPayroll: this.adminState.weeklyPayroll.length,
        payrollHistory: this.adminState.payrollHistory.length,
      });

      return this.adminState;

    } catch (e) {
      console.error('❌ loadPayrollData error:', e);
      this.adminState.weeklyPayroll = [];
      this.adminState.payrollHistory = [];
      return this.adminState;
    }
  }

  bindPassbookUpdateButton() {
    // This safely does nothing on pages that don't have Passbook UI
    // We try multiple selectors so you don't have to rename HTML.
    const btn =
      document.querySelector('#passbookSaveButton') ||
      document.querySelector('#saveClientButton') ||
      document.querySelector('button[data-action="passbook-save"]') ||
      document.querySelector('button[data-action="save-client"]') ||
      document.querySelector('button[data-passbook-save="true"]');

    const form =
      document.querySelector('#passbookClientForm') ||
      document.querySelector('form[data-passbook-form="client"]') ||
      document.querySelector('form[data-form="passbook-client"]');

    if (!btn && !form) return;

    const handler = async (e) => {
      if (e) e.preventDefault();

      try {
        const payload = this.collectPassbookUpdatePayloadFromForm(form || document);
        if (!payload.codeName) {
          alert('Missing client code. Please reload the client details and try again.');
          return;
        }

        // Basic guard: don't spam webhook if no updates found
        if (!payload.updates || Object.keys(payload.updates).length === 0) {
          alert('No fields detected to update.');
          return;
        }

        await this.submitPassbookClientUpdate(payload);

        // refresh screen so user sees latest values
        await this.refreshPassbookClientDetails(payload.codeName);

        // optional success UX
        console.log('✅ Passbook client updated:', payload.codeName, payload.updates);
        alert('Client updated successfully.');
      } catch (err) {
        console.error('❌ Passbook update failed:', err);
        alert(err?.message || 'Update failed. Please try again.');
      }
    };

    if (btn) btn.addEventListener('click', handler);
    if (form) form.addEventListener('submit', handler);
  }

  async submitPassbookClientUpdate(payload) {
    const res = await fetch(this.webhooks.passbookClientUpdate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Passbook update failed (HTTP ${res.status}). ${txt}`);
    }

    // Some webhooks return JSON, some return text
    const out = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));
    return out;
  }

  async refreshPassbookClientDetails(codeName) {
    const baseUrl = this.webhooks.passbookClientDetails;
    if (!baseUrl) return;

    // Build URL with query param (GET)
    const u = new URL(baseUrl);
    u.searchParams.set('codeName', codeName);

    // IMPORTANT: No Content-Type header, no body → avoids preflight in most cases
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`Passbook details refresh failed (HTTP ${res.status}).`, txt);
      return;
    }

    const data = await res.json().catch(() => null);

    try {
      window.dispatchEvent(new CustomEvent('passbook:client-updated', { detail: { codeName, data } }));
    } catch (e) {}

    return data;
  }

  collectPassbookUpdatePayloadFromForm(rootEl) {
    // We try to find the client code from common places:
    // - hidden input name="codeName"/"CODE NAME"
    // - any element with data-code-name
    // - any input whose id includes "code"
    const root = rootEl || document;

    const codeFromData =
      (root.querySelector('[data-code-name]')?.getAttribute('data-code-name') || '').trim();

    const codeFromInput =
      (root.querySelector('input[name="codeName"]')?.value || '').trim() ||
      (root.querySelector('input[name="CODE NAME"]')?.value || '').trim() ||
      (root.querySelector('#codeName')?.value || '').trim() ||
      (root.querySelector('#CODE_NAME')?.value || '').trim();

    const codeName = codeFromInput || codeFromData;

    // Collect fields:
    // Priority:
    // 1) elements that explicitly opt-in via data-passbook-field="SHEET HEADER"
    // 2) inputs/selects/textarea that have "name" (we use it as the sheet column)
    const updates = {};

    const explicit = Array.from(root.querySelectorAll('[data-passbook-field]'));
    for (const el of explicit) {
      const key = (el.getAttribute('data-passbook-field') || '').trim();
      if (!key) continue;
      const val = (el.value ?? '').toString();
      updates[key] = val;
    }

    if (explicit.length === 0) {
      const fields = Array.from(root.querySelectorAll('input[name], select[name], textarea[name]'));
      for (const el of fields) {
        const name = (el.getAttribute('name') || '').trim();
        if (!name) continue;

        // avoid sending login/password/session fields if any exist on page
        if (/password|email|login/i.test(name)) continue;

        const val = (el.value ?? '').toString();
        updates[name] = val;
      }
    }

    // Always stamp metadata if you want (optional; safe if sheet has these columns)
    // If you don't want these, remove them here—nothing else depends on them.
    updates['LAST UPDATED'] = new Date().toISOString();
    updates['UPDATED BY'] = 'Passbook';

    return { codeName, updates };
  }

  // ✅ 1) ADDED: Admin Auto-Refresh Method
  startAdminAutoRefresh() {
    // Refresh every 20 seconds (polling)
    setInterval(() => {
        this.fetchAdminData(true);
    }, 20000);

    // Refresh immediately when you return to the tab
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.fetchAdminData(true);
    });
  }
}

// Make sure the Admin Dashboard finds `window.portal`
window.portal = window.portal || new CallHammerPortal();

// ==========================================
// SUPABASE CLIENT INITIALIZATION
// ==========================================
const supabaseUrl = 'https://api.supabase.callhammerleads.com';
const supabaseKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTcwMjI2MCwiZXhwIjo0OTI3Mzc1ODYwLCJyb2xlIjoiYW5vbiJ9.XuWCdGs0XSSSlWhsF6gR4gHMp50C-v6xra9ABgSVRoU';

// THE FIX: Renamed from 'supabase' to 'supaClient' to avoid crashing Javascript
const supaClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// ==========================================
// PASSBOOK CONTROLS (ADMIN & SALES)
// ==========================================
async function fetchAdminClients(status = 'Active') {
    if (!supaClient) return;
    let query = supaClient.from('clients').select('*');
    if (status !== 'All') query = query.eq('client_status', status);
    const { data: clients, error } = await query;
    if (!error && window.Admin && typeof window.Admin.applyPassbookFilters === 'function') {
        window.Admin.applyPassbookFilters(clients);
    }
}

async function fetchSalesClients(status = 'Active') {
    if (!supaClient) return;
    let query = supaClient.from('clients').select('*').eq('shared_with_sales', true);
    if (status !== 'All') query = query.eq('client_status', status);
    const { data: clients, error } = await query;
    if (!error && window.Admin && typeof window.Admin.applyPassbookFilters === 'function') {
        window.Admin.applyPassbookFilters(clients);
    }
}

async function toggleShareWithSales(codeName, checkboxElement) {
    if (!supaClient) { checkboxElement.checked = !checkboxElement.checked; return; }
    const isShared = checkboxElement.checked;
    const { error } = await supaClient.from('clients').update({ shared_with_sales: isShared }).eq('code_name', codeName); 
    if (error) {
        alert('Database error. Check the console.');
        checkboxElement.checked = !isShared; 
    }
}

// ==========================================
// SALES PIPELINE CONTROLS (UPGRADED HYBRID LEDGER)
// ==========================================
async function fetchSalesPipeline() {
    if (!supaClient) return;
    
    const isSalesDash = document.getElementById('salesClientStatusFilter') !== null;
    const isAdminDash = document.getElementById('admin-sales-category-filter') !== null;

    if (!isSalesDash && !isAdminDash) return;
    
    let { data: sales, error } = await supaClient.from('sales_pipeline').select('*').order('created_at', { ascending: false });
    
    if (error) {
        console.error("Error fetching sales:", error);
        return;
    }

    let filteredSales = sales || [];

    if (isSalesDash) {
        const currentUser = window.portal?.currentUser?.name || "Unknown";
        filteredSales = filteredSales.filter(s => s.sold_by_name === currentUser);
        const statFilter = document.getElementById('sales-status-filter')?.value || 'all';
        if (statFilter !== 'all') filteredSales = filteredSales.filter(s => s.status === statFilter);
    } else {
        const catFilter = document.getElementById('admin-sales-category-filter')?.value || 'All';
        const statFilter = document.getElementById('admin-sales-status-filter')?.value || 'all';
        if (catFilter !== 'All') filteredSales = filteredSales.filter(s => s.sales_category === catFilter);
        if (statFilter !== 'all') filteredSales = filteredSales.filter(s => s.status === statFilter);
    }

    const tbodyId = isSalesDash ? 'sales-table-body' : 'admin-sales-table-body';
    const tbody = document.getElementById(tbodyId);
    const thead = tbody?.previousElementSibling;
    if (!tbody) return;

    // Render Headers (Added TXN # and Pkg Status)
    if (thead) {
        thead.innerHTML = `
            <tr class="text-left text-xs font-bold text-gray-500 uppercase tracking-wider border-b">
                <th class="p-4">Date</th>
                <th class="p-4">TXN #</th>
                <th class="p-4">Client Name</th>
                <th class="p-4">Package</th>
                <th class="p-4">Deal Value</th>
                <th class="p-4">Deal Status</th>
                <th class="p-4">Pkg Status</th>
                <th class="p-4">Sold By</th>
                ${!isSalesDash ? `<th class="p-4">Category</th>` : ''}
            </tr>
        `;
    }

    if (filteredSales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-gray-400 italic">No deals found.</td></tr>`;
        return;
    }

    // Render Rows
    tbody.innerHTML = filteredSales.map(s => {
        const d = new Date(s.created_at).toLocaleDateString();
        const val = parseFloat(s.deal_value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        
        let stColor = "bg-gray-100 text-gray-700";
        if (s.status === 'Closed Won') stColor = "bg-emerald-100 text-emerald-800";
        if (s.status === 'Closed Lost') stColor = "bg-red-100 text-red-800";
        if (s.status === 'Negotiating') stColor = "bg-yellow-100 text-yellow-800";
        if (s.status === 'Prospecting') stColor = "bg-blue-100 text-blue-800";

        let pkgColor = "bg-gray-100 text-gray-700";
        if (s.package_status === 'Active') pkgColor = "bg-blue-100 text-blue-800";
        if (s.package_status === 'Completed') pkgColor = "bg-purple-100 text-purple-800";
        if (s.package_status === 'Refunded') pkgColor = "bg-orange-100 text-orange-800";

        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50">
            <td class="p-4 text-sm text-gray-500">${d}</td>
            <td class="p-4 text-xs font-mono text-gray-400 font-bold">${s.transaction_number || '—'}</td>
            <td class="p-4 font-bold text-gray-900">${s.client_name}</td>
            <td class="p-4 text-sm text-gray-600">${s.package_sold || '—'}</td>
            <td class="p-4 font-bold text-emerald-600">${val}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-extrabold uppercase ${stColor}">${s.status}</span></td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-extrabold uppercase ${pkgColor}">${s.package_status || 'ACTIVE'}</span></td>
            <td class="p-4 text-sm text-gray-600">${s.sold_by_name}</td>
            ${!isSalesDash ? `<td class="p-4 text-sm text-gray-500">${s.sales_category}</td>` : ''}
        </tr>
        `;
    }).join('');
}

async function submitNewSale(e) {
    e.preventDefault();
    if (!supaClient) return alert("Database connection missing.");
    
    const isSalesDash = document.getElementById('salesClientStatusFilter') !== null;
    const currentUser = window.portal?.currentUser?.name || "Unknown User";
    const category = isSalesDash ? 'Sales Team' : document.getElementById('sale-category').value;

    const payload = {
        client_name: document.getElementById('sale-client-name').value,
        package_sold: document.getElementById('sale-package').value,
        deal_value: parseFloat(document.getElementById('sale-value').value) || 0,
        status: document.getElementById('sale-status').value,
        sold_by_name: currentUser,
        sales_category: category,
        transaction_number: document.getElementById('sale-transaction-id')?.value || '',
        package_status: document.getElementById('sale-package-status')?.value || 'Active'
    };

    const btn = document.getElementById('save-sale-btn');
    btn.innerText = "Saving...";

    const { error } = await supaClient.from('sales_pipeline').insert([payload]);
    
    if (error) {
        console.error("Sale Save Error:", error);
        alert("Failed to save deal.");
    } else {
        document.getElementById('add-sale-modal').classList.add('hidden');
        document.getElementById('add-sale-form').reset();
        fetchSalesPipeline();
    }
    btn.innerText = "Save Deal";
}

// ==========================================
// GLOBAL EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('clientStatusFilter') && !document.getElementById('salesClientStatusFilter')) {
        fetchAdminClients('Active');
    }
    if (document.getElementById('salesClientStatusFilter')) {
        fetchSalesClients('Active');
    }
    document.getElementById('admin-sales-category-filter')?.addEventListener('change', fetchSalesPipeline);
    document.getElementById('admin-sales-status-filter')?.addEventListener('change', fetchSalesPipeline);
    document.getElementById('sales-status-filter')?.addEventListener('change', fetchSalesPipeline);
    
    if (document.getElementById('view-sales')) fetchSalesPipeline();
});

// ==========================================
// INTERACTIVE LEADS TRACKER (SUPABASE DIRECT)
// ==========================================

async function updateLeadStatus(leadId, newStatus) {
    if (!supaClient) return alert("Database connection missing.");
    if (!leadId || leadId === "unknown") return alert("Cannot update: Lead ID is missing.");

    console.log(`Updating Supabase: Lead ${leadId} -> ${newStatus}`);

    const { error } = await supaClient
        .from('leads_raw') 
        .update({ status: newStatus })
        .eq('lead_id', leadId);

    if (error) {
        console.error("Failed to update lead status:", error);
        alert("Failed to update status in Supabase.");
    } else {
        console.log(`Success! Lead ${leadId} is now ${newStatus}`);
        window.portal.fetchAdminData(true); 
    }
}

async function deleteLead(leadId) {
    if (!supaClient) return alert("Database connection missing.");
    if (!leadId || leadId === "unknown") return alert("Cannot delete: Lead ID is missing.");

    const confirmDelete = confirm(`Are you sure you want to permanently delete Lead ID: ${leadId}?`);
    if (!confirmDelete) return;

    console.log(`Deleting Lead ${leadId} from Supabase...`);

    const { error } = await supaClient
        .from('leads_raw')
        .delete()
        .eq('lead_id', leadId);

    if (error) {
        console.error("Failed to delete lead:", error);
        alert("Failed to delete lead from Supabase.");
    } else {
        console.log(`Success! Lead ${leadId} deleted.`);
        window.portal.fetchAdminData(true);
    }
}

// ==========================================
// PASSBOOK CLIENT MANAGEMENT
// ==========================================

// 1. Helper Function: Get colors based on status
function getClientStatusColor(status) {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'ACTIVE') return 'bg-green-100 text-green-800 border-green-200';
    if (s === 'PAUSE') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (s === 'BLACKLISTED') return 'bg-red-100 text-red-800 border-red-200';
    if (s === 'INACTIVE') return 'bg-gray-100 text-gray-800 border-gray-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

// 2. Update Status Directly from Dropdown
async function updateClientStatus(clientId, newStatus) {
    if (!supaClient) return alert("Database connection missing.");
    
    // Update the dropdown color immediately on the screen for a snappy UI
    const selectEl = document.getElementById(`status-select-${clientId}`);
    if (selectEl) {
        selectEl.className = `px-2 py-1 rounded-full text-xs font-extrabold border outline-none cursor-pointer transition-all shadow-sm ${getClientStatusColor(newStatus)}`;
    }

    const { error } = await supaClient.from('clients').update({ client_status: newStatus }).eq('id', clientId);
    
    if (error) {
        console.error("Failed to update status:", error);
        alert("Failed to update client status in database.");
    }
}

// 3. Delete a Client safely
async function deletePassbookClient(clientId, companyName) {
    if (!supaClient) return;
    
    const confirmDelete = confirm(`⚠️ WARNING: Are you absolutely sure you want to permanently delete ${companyName}?\nThis action cannot be undone.`);
    if (!confirmDelete) return;

    const { error } = await supaClient.from('clients').delete().eq('id', clientId);
    
    if (error) {
        console.error("Delete Error:", error);
        alert("Failed to delete client.");
    } else {
        alert(`${companyName} has been deleted successfully.`);
        // Refresh the Passbook screen
        fetchAdminClients('All'); 
    }
}

// 4. Add a New Client via Modal
async function submitNewClient(e) {
    e.preventDefault();
    if (!supaClient) return;

    const btn = document.getElementById('save-client-btn');
    btn.innerText = "Saving...";
    btn.disabled = true;

    const payload = {
        code_name: document.getElementById('new-client-code').value,
        company_name: document.getElementById('new-client-name').value,
        client_status: document.getElementById('new-client-status').value
    };

    const { error } = await supaClient.from('clients').insert([payload]);

    if (error) {
        console.error("Add Client Error:", error);
        alert("Failed to add new client.");
    } else {
        document.getElementById('add-client-modal').classList.add('hidden');
        document.getElementById('add-client-form').reset();
        fetchAdminClients('All'); // Refresh the Passbook screen
    }

    btn.innerText = "Add Client";
    btn.disabled = false;
}
