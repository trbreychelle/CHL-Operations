// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
  constructor() {
    this.currentUser = null;
    
    this.supabase = window.supabase
  ? window.supabase.createClient(
      'https://api.supabase.callhammerleads.com',
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTcwMjI2MCwiZXhwIjo0OTI3Mzc1ODYwLCJyb2xlIjoiYW5vbiJ9.XuWCdGs0XSSSlWhsF6gR4gHMp50C-v6xra9ABgSVRoU'
    )
  : null;

    // Agent/TL datasets
    this.leadsData = [];
    this.employeeList = [];
    this.filteredLeads = [];
    this.currentFilter = 'this-week';

    this.weeklyPayroll = [];
    this.timeTracker = [];

    // Admin datasets (normalized + raw)
    this.adminState = {
  rawClients: [],
clients: [],
leads: [],
agents: [],
rawStatuses: [],
rawPackages: [],
weeklyPayroll: [],
payrollHistory: [],
clientHealthView: [],
agentPerformanceView: [],
clientPackageAllocationView: [],
clientPackageStatusView: []
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
    if (role === 'sales' || role === 'team_leader' || role === 'team leader' || role === 'tl') return 'salesdashboard.html';
    return 'agent-dashboard.html';
  }

  async loginWithCredentials(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();

  if (!cleanEmail || !cleanPassword) {
    throw new Error('Missing email or password.');
  }

  if (!this.supabase) {
    throw new Error('Supabase client not initialized.');
  }

  try {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword
    });

    if (error) {
      throw new Error(error.message || 'Supabase login failed.');
    }

    const authUser = data?.user;
    if (!authUser) {
      throw new Error('Supabase login failed: user missing.');
    }

    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('id, auth_user_id, organization_id, email, full_name, display_name, role, is_active')
      .eq('auth_user_id', authUser.id)
      .single();

    if (profileError) {
      throw new Error(profileError.message || 'Failed to load profile.');
    }

    if (!profile) {
      throw new Error('No profile found for this user.');
    }

    if (!profile.is_active) {
      throw new Error('This account is inactive.');
    }

    const user = {
      id: profile.id,
      auth_user_id: profile.auth_user_id,
      organization_id: profile.organization_id,
      email: profile.email,
      name: profile.display_name || profile.full_name || profile.email,
      full_name: profile.full_name,
      display_name: profile.display_name,
      role: profile.role
    };

    this.saveSession(user);
    window.location.href = this.routeByRole(user.role);
  } catch (supabaseErr) {
    console.error('Supabase login failed:', supabaseErr);
    throw supabaseErr;
  }
}
  
  async tryLoginFromQueryParams() {
  return false;
}

  // ✅ Binds to YOUR index.html IDs
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

  logout() {
    this.clearSession();
    window.location.href = 'index.html';
  }

  // ------------------------
  // Init / Routing
  // ------------------------
  async init() {
    await this.checkExistingSession();

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
}

    this.enforceRoleRouting();
    this.bindEvents();
    this.bindPassbookUpdateButton();

    if (path.includes('passbook') || document.querySelector('[data-page="passbook-clients"]')) {
      setTimeout(() => this.loadPassbookClientsList(true), 300);
    }

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
        // this.loadPayrollData(false); 
      }, 300);

      this.startAdminAutoRefresh();
    }
  }

  enforceRoleRouting() {
    if (!this.currentUser) return;

    const path = (window.location.pathname || '').toLowerCase();
    const role = (this.currentUser.role || 'agent').toLowerCase();

    if (!path.includes('dashboard') && !path.includes('admin')) return;

    const onAdmin = path.includes('admin');
    const onAgent = path.includes('agent');
    const onSales = path.includes('sales');

    if (role === 'admin' && !onAdmin) window.location.href = 'admin-dashboard.html';
    else if ((role === 'sales' || role === 'team_leader' || role === 'team leader' || role === 'tl') && !onSales) window.location.href = 'salesdashboard.html';
    else if (role === 'agent' && !onAgent) window.location.href = 'agent-dashboard.html';
  }
  
  // ------------------------
  // Session / Events (safe)
  // ------------------------
  async checkExistingSession() {
  try {
    if (!this.supabase) return;

    const { data, error } = await this.supabase.auth.getSession();

    if (error || !data?.session) {
      this.clearSession();
      return;
    }

    const authUser = data.session.user;

    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('id, auth_user_id, organization_id, email, full_name, display_name, role, is_active')
      .eq('auth_user_id', authUser.id)
      .single();

    if (profileError || !profile || !profile.is_active) {
      this.clearSession();
      return;
    }

    const user = {
      id: profile.id,
      auth_user_id: profile.auth_user_id,
      organization_id: profile.organization_id,
      email: profile.email,
      name: profile.display_name || profile.full_name || profile.email,
      role: profile.role
    };

    this.saveSession(user);

  } catch (e) {
    console.warn('Session validation failed:', e);
    this.clearSession();
  }
}

  bindEvents() {}

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
    return String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  }

  parseDateSafe(value) {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number' && isFinite(value)) {
      if (value > 20000) {
        const base = new Date(Date.UTC(1899, 11, 30));
        const ms = base.getTime() + value * 24 * 60 * 60 * 1000;
        const dt = new Date(ms);
        return isNaN(dt.getTime()) ? null : dt;
      }
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

  // ------------------------
  // ✅ Status Helpers
  // ------------------------
  isQualifiedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CONFIRM') || s.includes('APPROV');
  }
  isRejectedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('REJECT');
  }
  isCreditedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CREDIT');
  }
  isPendingStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('PENDING');
  }

  formatCurrency(v) {
    const n = this.toNumberSafe(v, 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  // ------------------------
  // ✅ MST + Payroll week helpers
  // ------------------------
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

  getPayrollWeekStart(date = new Date()) {
    const mst = this.toMST(date);
    const d = new Date(mst);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); 
    const diffToSat = (day - 6 + 7) % 7; 
    d.setDate(d.getDate() - diffToSat);
    return d;
  }

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
  // ✅ ADMIN ANALYTICS
  // ------------------------
  getLeadDateValue(lead) {
    return this.getAny(lead, ['lead_date', 'Lead Date', 'DATE', 'Date', 'created_at', 'Created At', 'timestamp', 'Timestamp', 'TimeStamp', 'Submitted At', 'submitted_at', 'Appointment Date', 'appointment_date', 'Date Submitted', 'date_submitted', 'Submission Date', 'submission_date'], '');
  }

  getLeadStatusValue(lead) {
    return this.getAny(lead, ['status', 'Status', 'Lead Status', 'LEAD STATUS', 'lead_status', 'Disposition', 'disposition'], '');
  }

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

    const day = now.getDay(); 
    const monday = addDays(startOfDay(now), (day === 0 ? -6 : 1 - day)); 

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

  refreshAdminAnalyticsFromRawLeads() {
    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];
    if (!leads.length) return;

    const rangeKey = this.getSelectedAdminRangeKey();
    const { start, end } = this.computeAdminDateRange(rangeKey);

    const inRange = leads.filter(l => {
      const dt = this.parseDateSafe(this.getLeadDateValue(l));
      if (!dt) return false;
      return dt >= start && dt <= end;
    });

    const total = inRange.length;
    let qualified = 0, qcRejected = 0, credited = 0, pending = 0;

    for (const l of inRange) {
      const status = this.getLeadStatusValue(l);
      if (this.isQualifiedStatus(status)) qualified++;
      else if (this.isRejectedStatus(status)) qcRejected++;
      else if (this.isCreditedStatus(status)) credited++;
      else pending++; 
    }

    const denom = qualified + credited;
    const cancelRate = denom > 0 ? Math.round((credited / denom) * 100) : 0;

    this.setMetricByLabel('TOTAL LEADS', String(total));
    this.setMetricByLabel('QUALIFIED', String(qualified));
    this.setMetricByLabel('QC REJECTED', String(qcRejected));
    this.setMetricByLabel('CREDITED', String(credited));
    this.setMetricByLabel('PENDING', String(pending));
    this.setMetricByLabel('CANCELLATION RATE', `${cancelRate}%`);
  }

  // ------------------------
  // ✅ AGENT DATA FETCHING
  // ------------------------
  async fetchAllData() {
    if (!this.currentUser || !this.currentUser.email) return;

    const stats = ['stat-appointments', 'stat-cancel-rate', 'stat-incentives', 'stat-hours'];
    stats.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerText = '...';
    });

    try {
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
      const data = result.data || result; 

      this.updateAgentDashboard(data);
      this.renderLeadsTable(data.leads || []);
      this.renderCharts(data.charts || {});
      this.updateProfileUI(data.profile || this.currentUser);
    } catch (error) {
      console.error('❌ Error fetching agent data:', error);
    }
  }

  updateAgentDashboard(data) {
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    };

    setText('stat-appointments', data.totalAppointments || 0);
    setText('stat-cancel-rate', (data.cancellationRate || 0) + '%');
    setText('stat-incentives', this.formatCurrency(data.totalIncentives || 0));
    setText('stat-hours', data.weeklyHours || 0);

    setText('monthly-incentive-status-ov', data.monthlyIncentiveStatus || 'Not qualified yet');
    setText('monthly-raffle-status-ov', data.raffleStatus || '0 / 4 weeks qualified');

    const tierCount = data.approvedAppointments || 0;
    const tierMax = 6; 
    const percentage = Math.min(100, (tierCount / tierMax) * 100);
      
    setText('tier-count-display', `${tierCount} / ${tierMax} approved appointments`);
    const progressBar = document.getElementById('tier-progress-bar');
    if (progressBar) progressBar.style.width = `${percentage}%`;
      
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
    const aptChartDom = document.getElementById('appointmentsChart');
    if (aptChartDom && window.echarts) {
      if (!this.charts) this.charts = {};
      this.charts.appointments = echarts.init(aptChartDom);
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: chartData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { type: 'value' },
        series: [{ data: chartData.appointments || [0, 0, 0, 0, 0], type: 'bar', itemStyle: { color: '#FBBF24' }, barWidth: '40%' }]
      };
      this.charts.appointments.setOption(option);
    }

    const incChartDom = document.getElementById('incentivesChart');
    if (incChartDom && window.echarts) {
      this.charts.incentives = echarts.init(incChartDom);
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: chartData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { type: 'value' },
        series: [{ data: chartData.earnings || [0, 0, 0, 0, 0], type: 'line', smooth: true, lineStyle: { color: '#D97706', width: 3 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{offset: 0, color: 'rgba(251, 191, 36, 0.5)'}, {offset: 1, color: 'rgba(251, 191, 36, 0.01)'}]) } }]
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
      console.log('📡 Fetching Master Data...');
      const response = await fetch(this.webhooks.fetchAdminData);
      const result = await response.json();
      const dataRoot = result?.data || result || {};

      let supaLeads = [],
    supaPackages = [],
    supaClients = [],
    supaTime = [],
    supaAgents = [],
    supaClientHealth = [],
    supaAgentPerformance = [],
    supaClientPackageStatus = [],
    supaClientPackageAllocation = [],
    supaProfiles = [],
    supaAgentCurrentRates = [],
    supaWeeklyPayroll = [];

if (supaClient) {
  const [lRes, pRes, cRes, tRes, aRes, chRes, apRes, cpsRes, cpaRes, profRes, acrRes, wpRes] = await Promise.all([
    supaClient.from('leads_raw').select('*'),
    supaClient.from('packages').select('*'),
    supaClient.from('clients').select('*'),
    supaClient.from('time_events').select('*'),
    supaClient.from('agents').select('*'),
    supaClient.from('client_health_view').select('*'),
    supaClient.from('agent_performance_view').select('*'),
    supaClient.from('client_package_status_view').select('*'),
    supaClient.from('client_package_allocation_view').select('*'),
    supaClient.from('profiles').select('*'),
    supaClient.from('agent_current_rate_view').select('*'),
    supaClient.from('payroll_dashboard_final_view').select('*')
  ]);

  supaLeads = lRes.data || [];
  supaPackages = pRes.data || [];
  supaClients = cRes.data || [];
  supaTime = tRes.data || [];
  supaAgents = aRes.data || [];
  supaClientHealth = chRes.data || [];
  supaAgentPerformance = apRes.data || [];
  supaClientPackageStatus = cpsRes.data || [];
  supaClientPackageAllocation = cpaRes.data || [];
  supaProfiles = profRes.data || [];
  supaAgentCurrentRates = acrRes.data || [];
  supaWeeklyPayroll = wpRes.data || [];
}
      
      this.adminState.rawClients = supaClients.length > 0 ? supaClients : (dataRoot.clients || []);
this.adminState.leads = supaLeads.length > 0 ? supaLeads : (dataRoot.leads || []);
this.adminState.packages = supaPackages.length > 0 ? supaPackages : (dataRoot.packages || []);
this.adminState.timeEvents = supaTime;
this.adminState.agents = supaAgents.length > 0 ? supaAgents : (dataRoot.agents || []);
this.adminState.rawProfiles = supaProfiles || [];
this.adminState.agentCurrentRates = supaAgentCurrentRates || [];
this.adminState.weeklyPayroll = supaWeeklyPayroll;

this.adminState.clientHealthView = supaClientHealth;
this.adminState.agentPerformanceView = supaAgentPerformance;
this.adminState.clientPackageStatusView = supaClientPackageStatus;
this.adminState.clientPackageAllocationView = supaClientPackageAllocation;

      console.log('clientPackageStatusView rows:', this.adminState.clientPackageStatusView.length);

if (this.adminState.clientHealthView.length > 0) {
  this.normalizeAdminFromHealthMonitor(this.adminState.clientHealthView);
} else {
  this.adminState.clients = this.adminState.rawClients;
}
      const arrowheadDebug = this.adminState.clientHealthView.find(
  x => String(x.company_name || '').toLowerCase().includes('arrowhead')
);
      console.log('DEBUG clientHealthView Arrowhead:', arrowheadDebug);

      console.log('clientHealthView rows:', this.adminState.clientHealthView.length);
      console.log('agentPerformanceView rows:', this.adminState.agentPerformanceView.length);
      console.log('clientPackageAllocationView rows:', this.adminState.clientPackageAllocationView.length);

      this.triggerAdminRefresh();
    } catch (err) {
      console.error('❌ fetchAdminData failed:', err);
    }
  }

  triggerAdminRefresh() {
    if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
      window.adminDashboard.refreshDashboard();
    }
  }

  normalizeAdminFromHealthMonitor(rows) {
    const list = Array.isArray(rows) ? rows : [];

    this.adminState.clients = list.map(r => {
      const status = this.getAny(r, ['client_status', 'status', 'Client Status', 'CLIENT STATUS'], 'NOT STARTED');
const codeName = this.getAny(r, ['client_code', 'code_name', 'codeName', 'CODE NAME', 'CODE', 'code'], 'N/A');
const roofingCompany = this.getAny(r, ['company_name', 'roofing_company', 'Roofing Company', 'Roofing Company Name', 'Company Name', 'COMPANY NAME'], '—');
const cityState = this.getAny(r, ['city_state', 'CITY STATE', 'City State', 'location', 'Location'], 'Remote');
const clientName = this.getAny(r, ['client_name', 'CLIENT NAME', 'Client Name'], '—');
const lastLeadReceived = this.getAny(r, ['last_lead_received', 'Last Lead Received'], '');
const hoursSinceLastLead = 0;
const leadsToday = this.toNumberSafe(this.getAny(r, ['leads_today', 'Leads Today'], 0), 0);
const leadsYesterday = this.toNumberSafe(this.getAny(r, ['leads_yesterday', 'Leads Yesterday'], 0), 0);
const purchasedLeads = this.toNumberSafe(this.getAny(r, ['purchased_leads', 'Purchased Leads'], 0), 0);
const owedLeads = this.toNumberSafe(this.getAny(r, ['owed_leads', 'Owed Leads'], 0), 0);
const packageStatus = this.getAny(r, ['package_status', 'Package Status'], '');
const purchaseDate = this.getAny(r, ['purchase_date', 'Purchase Date'], '');

      return {
        status, code_name: codeName, roofing_company: roofingCompany, city_state: cityState, clientName,
        last_lead_received: lastLeadReceived, hours_since_last_lead: hoursSinceLastLead, leads_today: leadsToday, leads_yesterday: leadsYesterday,
        purchased_leads: purchasedLeads, owed_leads: owedLeads, package_status: packageStatus, purchase_date: purchaseDate,
      };
    });
  }

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
      last_lead_received: '', hours_since_last_lead: 0, leads_today: 0, leads_yesterday: 0,
      purchased_leads: 0, owed_leads: 0, package_status: '', purchase_date: ''
    }));
  }

  // ==========================================
  // ✅ PASSBOOK & PAYROLL LOADING
  // ==========================================
  async loadPassbookClientsList(force = false) {
    try {
      const url = new URL(this.webhooks.passbookClientsList);
      url.searchParams.set('ts', Date.now());

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Passbook list failed (HTTP ${res.status}).`);

      const data = await res.json();
      const clients = data?.clients || data?.data?.clients || data?.data || [];

      const countEl = document.querySelector('#passbookClientsCount');
      if (countEl) countEl.textContent = `Showing ${clients.length} clients`;

      this.adminState.passbookClients = clients;
      return clients;
    } catch (e) {
      console.error('❌ loadPassbookClientsList error:', e);
      return [];
    }
  }
  
  async loadPayrollData(force = false) {
    try {
      const url = new URL(this.webhooks.payrollData);
      url.searchParams.set('ts', Date.now());

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Payroll data failed (HTTP ${res.status}).`);

      const json = await res.json();
      const root = json?.data || json || {};

      const weeklyPayroll = root.weeklyPayroll || root.weekly_payroll || root.weekly || [];
      const payrollHistory = root.payrollHistory || root.payroll_history || root.history || [];

      this.weeklyPayroll = Array.isArray(weeklyPayroll) ? weeklyPayroll : [];
      this.timeTracker = Array.isArray(root.timeTracker || root.time_tracker) ? (root.timeTracker || root.time_tracker) : [];

      this.adminState.weeklyPayroll = this.weeklyPayroll;
      this.adminState.payrollHistory = Array.isArray(payrollHistory) ? payrollHistory : [];

      return this.adminState;
    } catch (e) {
      console.error('❌ loadPayrollData error:', e);
      this.adminState.weeklyPayroll = [];
      this.adminState.payrollHistory = [];
      return this.adminState;
    }
  }

  bindPassbookUpdateButton() {
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

        if (!payload.updates || Object.keys(payload.updates).length === 0) {
          alert('No fields detected to update.');
          return;
        }

        await this.submitPassbookClientUpdate(payload);
        await this.refreshPassbookClientDetails(payload.codeName);
        alert('Client updated successfully.');
      } catch (err) {
        console.error('❌ Passbook update failed:', err);
        alert(err?.message || 'Update failed. Please try again.');
      }
    };

    if (btn) btn.addEventListener('click', handler);
    if (form) form.addEventListener('submit', handler);
  }

  collectPassbookUpdatePayloadFromForm(rootEl) {
    const root = rootEl || document;
    // We grab the ORIGINAL code from the hidden input before it was changed
    const originalCodeName = (root.querySelector('#codeName')?.value || '').trim();
    const updates = {};
    
    const fields = Array.from(root.querySelectorAll('#passbook-form-body input[name], #passbook-form-body textarea[name]'));
    for (const el of fields) {
      const name = el.getAttribute('name');
      if (name) { 
          updates[name] = el.value;
      }
    }
    
    // FIXED: We return BOTH names so it passes the hidden validation check!
    return { codeName: originalCodeName, originalCodeName, updates };
  }

  async submitPassbookClientUpdate(payload) {
    if (typeof supaClient === 'undefined' || !supaClient) throw new Error("Database connection missing.");
    
    const newClientCode = payload.updates['client_code'];
    const originalCode = payload.originalCodeName || payload.codeName;

    // 1. UPDATE THE CLIENT PROFILE
    const { error } = await supaClient
        .from('clients')
        .update(payload.updates)
        .eq('client_code', originalCode);

    if (error) {
        console.error("Supabase Update Error:", error);
        if (error.code === 'PGRST204' || error.message.includes('column')) {
            throw new Error("One of the form fields is missing a matching column in your Supabase table!");
        }
        throw new Error(error.message || "Failed to update client in database.");
    }

    // 2. SMART LINK: IF THE CODE CHANGED, UPDATE THE SALES PIPELINE TOO!
    if (newClientCode && newClientCode !== originalCode) {
        const { error: pkgErr } = await supaClient
            .from('packages')
            .update({ client_code: newClientCode })
            .eq('client_code', originalCode);
            
        if (pkgErr) console.error("Failed to update related sales packages:", pkgErr);
    }

    // 3. Instantly sync the background dashboard tables
    if (window.portal && typeof window.portal.fetchAdminData === 'function') {
        window.portal.fetchAdminData(true);
    }
    if (typeof fetchAdminClients === 'function') {
        fetchAdminClients('All'); 
    }
    
    return { success: true };
  }

  async refreshPassbookClientDetails(codeName) {
    // Because we use Supabase now, we can just call the read function again to instantly show the new data!
    if (window.Admin && typeof window.Admin._fetchAndRenderPassbookClient === 'function') {
        await window.Admin._fetchAndRenderPassbookClient(codeName);
    }
  }

  startAdminAutoRefresh() {
    setInterval(() => { this.fetchAdminData(true); }, 20000);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.fetchAdminData(true);
    });
  }
}

window.portal = window.portal || new CallHammerPortal();

// ==========================================
// SUPABASE CLIENT INITIALIZATION
// ==========================================
const supabaseUrl = 'https://api.supabase.callhammerleads.com';
const supabaseKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTcwMjI2MCwiZXhwIjo0OTI3Mzc1ODYwLCJyb2xlIjoiYW5vbiJ9.XuWCdGs0XSSSlWhsF6gR4gHMp50C-v6xra9ABgSVRoU';
const supaClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// ==========================================
// PASSBOOK CONTROLS (ADMIN & SALES)
// ==========================================
async function fetchAdminClients(status = 'Active') {
    if (!supaClient) return;
    
    // Fetch ALL clients first to beat Supabase's strict case-sensitivity
    const { data: clients, error } = await supaClient.from('clients').select('*');
    if (error) return console.error("Error fetching clients:", error);
    
    let filtered = clients || [];
    
    // Javascript filter ignores Capitalization and invisible spaces
    if (status !== 'All') {
        filtered = filtered.filter(c => {
            const dbStatus = String(c.client_status || c.status || '').trim().toLowerCase();
            return dbStatus === String(status).toLowerCase();
        });
    }
    
    if (window.Admin && typeof window.Admin.applyPassbookFilters === 'function') {
        window.Admin.applyPassbookFilters(filtered);
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
    // FIX: Match the actual Supabase column name 'client_code'
    const { error } = await supaClient.from('clients').update({ shared_with_sales: isShared }).eq('client_code', codeName); 
    if (error) {
        alert('Database error. Check the console.');
        checkboxElement.checked = !isShared; 
    }
}

// ==========================================
// SALES PIPELINE CONTROLS (UPGRADED HYBRID LEDGER)
// ==========================================
window.fetchSalesPipeline = function() {
  console.warn("⚠️ OLD fetchSalesPipeline DISABLED");
  return;
    const state = window.portal?.adminState;
    if (!state || !state.packages) return;

    const packages = state.packages; 
    const clients = state.rawClients || state.clients || [];

    const tbody = document.getElementById('admin-sales-table-body');
    if (!tbody) return;

    const query = (document.getElementById('admin-sales-search')?.value || "").toLowerCase().trim();
    const pkgFilter = document.getElementById('admin-sales-package-filter')?.value || "all";
    const catFilter = document.getElementById('admin-sales-category-filter')?.value || "All";

    let totalSalesValue = 0;

    let rows = packages.map(pkg => {
        const code = String(pkg.client_code || "").trim();
        const client = clients.find(c =>
  String(c.client_code || c.code_name || "").trim().toLowerCase() === code.toLowerCase()
) || {};
        
        let pStatus = String(pkg.status || "COMPLETED").toUpperCase();
        if (pStatus === 'ACTIVE') pStatus = 'ONGOING';

        const rawAmt = pkg.amount ? String(pkg.amount).replace(/[^0-9.-]+/g,"") : "0";
        const valNum = parseFloat(rawAmt) || 0;
        const valFormatted = valNum.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        // Math for Total Commission (Purchased Leads * Commission Per Lead)
        const purchasedAmount = Number(pkg.purchased_leads) || 0;
        const commPerLead = Number(pkg.commission_per_lead) || 0;
        const totalComm = purchasedAmount * commPerLead;
        const commFormatted = totalComm.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        return {
            id: pkg.id,
            purchaseDateRaw: new Date(pkg.purchase_date || 0),
            purchaseDate: window.portal.formatDate(pkg.purchase_date) || "—",
            txn: pkg.external_package_id || pkg.transaction_id || "—",
            company: client.company_name || client.roofing_company || "—",
            poc: client.contact_person || client.client_name || client.contact_name || "—",
            packageLeads: purchasedAmount,
            dealValueNum: valNum,
            dealValue: valFormatted,
            totalComm: commFormatted,
            pkgStatus: pStatus,
            dealStatus: pkg.deal_status || "—", // <--- NEW LINE
            soldBy: pkg.sales_category || pkg.sold_by || "CHL", 
            dateStarted: window.portal.formatDate(pkg.package_start_date) || "—",
            searchStr: `${code} ${client.company_name} ${pkg.external_package_id}`.toLowerCase()
        };
    });

    // 1. Apply Filters
    if (pkgFilter !== "all") {
        const filterTarget = pkgFilter === "Active" ? "ONGOING" : pkgFilter.toUpperCase();
        rows = rows.filter(r => r.pkgStatus === filterTarget);
    }
    if (catFilter !== "All") {
        rows = rows.filter(r => r.soldBy === catFilter);
    }
    if (query) rows = rows.filter(r => r.searchStr.includes(query));

    // 2. Sort by Latest Sale First
    rows.sort((a, b) => b.purchaseDateRaw - a.purchaseDateRaw);

    // 3. Render Table & Calculate Total KPI
    tbody.innerHTML = rows.map(r => {
        totalSalesValue += r.dealValueNum; // Add to total

        // We put the PKG Colors back!
        let pkgColor = "bg-gray-100 text-gray-700";
        if (r.pkgStatus === 'ONGOING') pkgColor = "bg-blue-100 text-blue-800";
        if (r.pkgStatus === 'COMPLETED') pkgColor = "bg-purple-100 text-purple-800";
        if (r.pkgStatus === 'REFUNDED') pkgColor = "bg-orange-100 text-orange-800";
        if (r.pkgStatus === 'PAUSE') pkgColor = "bg-yellow-100 text-yellow-800";

        // New Deal Status Colors
        let dealColor = "bg-gray-100 text-gray-700";
        if (r.dealStatus === 'Paid') dealColor = "bg-emerald-100 text-emerald-800";
        if (r.dealStatus === 'Negotiating') dealColor = "bg-yellow-100 text-yellow-800";
        if (r.dealStatus === 'Refunded') dealColor = "bg-red-100 text-red-800";
      
        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition-colors">
            <td class="p-4 text-sm text-gray-500">${r.purchaseDate}</td>
            <td class="p-4 text-xs font-mono text-gray-400 font-bold">${r.txn}</td>
            <td class="p-4 font-bold text-gray-900">${r.company}</td>
            <td class="p-4 text-sm text-gray-600">${r.poc}</td>
            <td class="p-4 font-bold text-gray-900">${r.packageLeads} Leads</td>
            <td class="p-4 font-bold text-emerald-600">${r.dealValue}</td>
            <td class="p-4 font-bold text-purple-600">${r.totalComm}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-extrabold uppercase ${pkgColor}">${r.pkgStatus}</span></td>
            <td class="p-4 text-sm text-gray-600">${r.soldBy}</td>
            <td class="p-4 text-sm text-gray-500 font-bold">${r.dateStarted}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-extrabold uppercase ${dealColor}">${r.dealStatus}</span></td>
            <td class="p-4 text-center flex justify-center gap-1">
                <button onclick="window.editDealModal('${r.id}')" class="px-3 py-1 bg-gray-100 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded shadow-sm transition-colors">Edit</button>
                <button onclick="window.deleteDeal('${r.id}', '${r.company.replace(/'/g, "\\'")}')" class="px-3 py-1 bg-gray-100 hover:bg-red-100 text-red-700 text-xs font-bold rounded shadow-sm transition-colors">Delete</button>
            </td>
        </tr>`;
    }).join('');

    // Update KPI
    const kpiEl = document.getElementById('sales-total-kpi');
    if (kpiEl) kpiEl.textContent = totalSalesValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Opens confirm dialog to delete a deal
window.deleteDeal = async function(pkgId, companyName) {
    if (!supaClient) return alert("Database connection missing.");
    
    const confirmed = confirm(`Are you sure you want to permanently delete the deal for ${companyName}? This cannot be undone.`);
    if (!confirmed) return;

    const { error } = await supaClient.from('packages').delete().eq('id', pkgId);
    
    if (error) {
        console.error("Delete Deal Error:", error);
        alert("Failed to delete deal.");
    } else {
        window.portal.fetchAdminData(true); // Refresh dashboard instantly
    }
}
window.openAddDealModal = function() {
    document.getElementById('add-sale-form').reset();
    document.getElementById('sale-package-id').value = ""; 
    document.getElementById('sale-client-code').value = ""; 
    document.getElementById('sale-deal-type').value = "New Client";
    document.getElementById('sale-modal-title').innerText = "Log New Deal";
    document.getElementById('save-sale-btn').innerText = "Save Deal";
    window.populateSalesClientDropdown();
    document.getElementById('add-sale-modal').classList.remove('hidden');
}

window.editDealModal = function(pkgId) {
    const pkg = window.portal.adminState.packages.find(p => p.id == pkgId);
    if (!pkg) return;

    window.populateSalesClientDropdown();
    const clients = window.portal?.adminState?.rawClients || window.portal?.adminState?.clients || [];
    const client = clients.find(c =>
  String(c.client_code || c.code_name || "").trim().toLowerCase() === String(pkg.client_code || "").trim().toLowerCase()
) || {};

    document.getElementById('sale-package-id').value = pkg.id;
    document.getElementById('sale-client-code').value = pkg.client_code || "";
    document.getElementById('sale-company').value = client.company_name || "";
    document.getElementById('sale-poc').value = client.contact_person || "";
    
    document.getElementById('sale-leads').value = pkg.purchased_leads || "";
    document.getElementById('sale-value').value = String(pkg.amount || "").replace(/[^0-9.-]+/g,"");
    document.getElementById('sale-commission').value = pkg.commission_per_lead || 0;
    
    if (pkg.purchase_date) document.getElementById('sale-date').value = new Date(pkg.purchase_date).toISOString().split('T')[0];

    document.getElementById('sale-transaction-id').value = pkg.external_package_id || "";
    document.getElementById('sale-deal-status').value = pkg.deal_status || "Paid";
    document.getElementById('sale-deal-type').value = pkg.deal_type || "New Client";
    document.getElementById('sale-category').value = pkg.sales_category || "CHL Team";

    document.getElementById('sale-modal-title').innerText = "Edit Deal Details";
    document.getElementById('save-sale-btn').innerText = "Update Deal";
    document.getElementById('add-sale-modal').classList.remove('hidden');
}

window.populateSalesClientDropdown = function() {
    const companyInput = document.getElementById('sale-company');
    const suggestionBox = document.getElementById('custom-client-suggestions');
    if (!companyInput || !suggestionBox) return;

    const clients = window.portal?.adminState?.rawClients || window.portal?.adminState?.clients || [];
    
    // 1. Hide dropdown when clicking outside of it
    document.addEventListener('click', (e) => {
        if (e.target !== companyInput && e.target !== suggestionBox) {
            suggestionBox.classList.add('hidden');
        }
    });

    // 2. Filter and build the list as you type
    companyInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        suggestionBox.innerHTML = ''; // Clear old suggestions
        
        if (!val) {
            suggestionBox.classList.add('hidden');
            document.getElementById('sale-client-code').value = "";
            document.getElementById('sale-deal-type').value = "New Client";
            document.getElementById('sale-poc').value = "";
            return;
        }

        const matches = clients.filter(c => String(c.company_name || "").toLowerCase().includes(val));
        
        if (matches.length > 0) {
            suggestionBox.classList.remove('hidden');
            matches.forEach(match => {
                const div = document.createElement('div');
                div.className = "px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm font-bold text-gray-700 border-b border-gray-50 last:border-0";
                div.textContent = match.company_name;
                
                // 3. What happens when you click a suggestion
                div.onclick = () => {
                    companyInput.value = match.company_name;
                    document.getElementById('sale-poc').value = match.contact_person || "";
                    document.getElementById('sale-client-code').value = match.client_code || match.code_name || "";
                    document.getElementById('sale-deal-type').value = "Renewal";
                    suggestionBox.classList.add('hidden');
                };
                suggestionBox.appendChild(div);
            });
        } else {
            // If no match, treat as a New Client
            suggestionBox.classList.add('hidden');
            document.getElementById('sale-client-code').value = "";
            document.getElementById('sale-deal-type').value = "New Client";
        }
    });
}

window.submitNewSale = async function(e) {
    e.preventDefault();
    if (!supaClient) return alert("Database connection missing.");

    const btn = document.getElementById('save-sale-btn');
    btn.innerText = "Saving...";
    btn.disabled = true;

    const pkgId = document.getElementById('sale-package-id').value;
    let clientCode = document.getElementById('sale-client-code').value;
    const companyName = document.getElementById('sale-company').value.trim();
    const poc = document.getElementById('sale-poc').value.trim();

    if (!companyName) {
        alert("Roofing Company name is required.");
        btn.innerText = "Save Deal"; btn.disabled = false; return;
    }

    // IF NEW CLIENT: Auto-create in the Passbook database first
    if (!clientCode) {
        clientCode = "NEW-" + Math.floor(Date.now() / 1000); // Generate a unique ID
        const newClientPayload = {
            client_code: clientCode,
            company_name: companyName,
            contact_person: poc,
            client_status: "Active"
        };
        const { error: cErr } = await supaClient.from('clients').insert([newClientPayload]);
        if (cErr) {
            console.error("Auto-Client Creation Error:", cErr);
            alert("Failed to auto-create client profile.");
            btn.innerText = "Save Deal"; btn.disabled = false; return;
        }
    }

    const payload = {
        client_code: clientCode,
        purchased_leads: parseInt(document.getElementById('sale-leads').value) || 0,
        amount: parseFloat(document.getElementById('sale-value').value) || 0,
        commission_per_lead: parseFloat(document.getElementById('sale-commission').value) || 0,
        purchase_date: document.getElementById('sale-date').value,
        external_package_id: document.getElementById('sale-transaction-id').value,
        status: "Active", // Default background package status to Active
        deal_status: document.getElementById('sale-deal-status').value,
        deal_type: document.getElementById('sale-deal-type').value,
        sales_category: document.getElementById('sale-category').value
    };

    let error;
    if (pkgId) {
        const res = await supaClient.from('packages').update(payload).eq('id', pkgId);
        error = res.error;
    } else {
        const res = await supaClient.from('packages').insert([payload]);
        error = res.error;
    }
    
    if (error) {
        console.error("Sale Save Error:", error);
        alert("Failed to save deal.");
    } else {
        document.getElementById('add-sale-modal').classList.add('hidden');
        window.portal.fetchAdminData(true); 
    }
    
    btn.innerText = pkgId ? "Update Deal" : "Save Deal";
    btn.disabled = false;
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
    // ❌ OLD SALES PIPELINE DISABLED COMPLETELY
// All rendering is now handled by Admin.renderSalesTab()
});

// ==========================================
// INTERACTIVE LEADS TRACKER (SUPABASE DIRECT + GSHEET SYNC)
// ==========================================

async function updateLeadStatus(leadId, newStatus) {
    if (!supaClient) return alert("Database connection missing.");
    if (!leadId || leadId === "unknown") return alert("Cannot update: Lead ID is missing.");

    // 1. UPDATE SUPABASE INSTANTLY (For Dashboard Speed)
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

    // 2. BACKGROUND SYNC TO GOOGLE SHEETS (For Clients)
    try {
        fetch('https://automate.callhammerleads.com/webhook/update-lead-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_id: leadId, status: newStatus })
        });
    } catch (e) { console.error("Sheet sync failed", e); }
}

async function deleteLead(leadId) {
    if (!supaClient) return alert("Database connection missing.");
    if (!leadId || leadId === "unknown") return alert("Cannot delete: Lead ID is missing.");

    const confirmDelete = confirm(`Are you sure you want to permanently delete Lead ID: ${leadId}?`);
    if (!confirmDelete) return;

    // 1. DELETE FROM SUPABASE INSTANTLY
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

    // 2. BACKGROUND SYNC TO GOOGLE SHEETS
    try {
        fetch('https://automate.callhammerleads.com/webhook/delete-lead-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_id: leadId })
        }).then(res => console.log("Google Sheets sync triggered:", res.status));
    } catch (e) { console.error("Sheet sync failed", e); }
}

// ==========================================
// PASSBOOK CLIENT MANAGEMENT
// ==========================================

function getClientStatusColor(status) {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'ACTIVE') return 'bg-green-100 text-green-800 border-green-200';
    if (s === 'PAUSE') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (s === 'BLACKLISTED') return 'bg-red-100 text-red-800 border-red-200';
    if (s === 'INACTIVE') return 'bg-gray-100 text-gray-800 border-gray-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

async function updateClientStatus(clientId, newStatus) {
    if (!supaClient) return alert("Database connection missing.");
    
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
        fetchAdminClients('All'); 
    }
}

async function submitNewClient(e) {
    e.preventDefault();
    if (!supaClient) return;

    const btn = document.getElementById('save-client-btn');
    btn.innerText = "Saving...";
    btn.disabled = true;

    const payload = {
        client_code: document.getElementById('new-client-code').value,
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
        fetchAdminClients('All'); 
    }

    btn.innerText = "Add Client";
    btn.disabled = false;
}

// ==========================================
// ✅ CLIENT HEALTH MONITOR (MISSION CONTROL)
// ==========================================
window.updateClientPackageStatus = async function(packageId, newPackageStatus) {
    if (!supaClient) {
        alert("Database connection missing.");
        return;
    }

    const cleanId = String(packageId || "").trim();
    if (!cleanId || cleanId === "null" || cleanId === "undefined") {
        console.error("Missing packageId in updateClientPackageStatus:", packageId);
        alert("Package ID is missing for this row. Cannot update status.");
        return;
    }

    console.log("Updating package status", { packageId: cleanId, newPackageStatus });

    try {
        const { data, error: updateErr } = await supaClient
            .from('packages')
            .update({ status: newPackageStatus })
            .eq('id', cleanId)
            .select();

        if (updateErr) {
            console.error("Status Update Error:", updateErr);
            alert("Failed to update package in ledger.");
            return;
        }

        console.log("Package status updated:", data);

        if (window.portal && typeof window.portal.fetchAdminData === 'function') {
            await window.portal.fetchAdminData(true);
        } else {
            location.reload();
        }
    } catch (error) {
        console.error("Status Update Error:", error);
        alert("An error occurred while updating.");
    }
};
