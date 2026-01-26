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
      console.warn('⚠️ adminDashboard.refreshDashboard not found (OK if your admin UI uses a different function).');
    }
  }

  // ✅ ADMIN: normalize from healthMonitor (now includes code_name + roofing_company + city_state + package stats)
  normalizeAdminFromHealthMonitor(rows) {
    const list = Array.isArray(rows) ? rows : [];

    this.adminState.clients = list.map(r => {
      // source fields (from n8n)
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
        // ✅ snake_case for easy HTML use
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

        // ✅ camelCase aliases (safe for any other JS)
        clientName,
        codeName,
        roofingCompany,
        cityState,
        lastLeadReceived,
        hoursSinceLastLead,
        leadsToday,
        leadsYesterday,

        purchasedLeads,
        owedLeads,
        packageStatus,
        purchaseDate
      };
    });
  }

  // Fallback join-based normalization (also outputs aliases)
  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];

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
      const hoursSinceLastLead = this.toNumberSafe(this.getAny(sRow, ['Hours Since Last Lead'], 0), 0);
      const leadsToday = this.toNumberSafe(this.getAny(sRow, ['Leads Today'], 0), 0);
      const leadsYesterday = this.toNumberSafe(this.getAny(sRow, ['Leads Yesterday'], 0), 0);

      // ✅ output both naming styles
      return {
        client_name: companyName,
        code: codeName,
        location,
        status: joinedStatus || 'NOT STARTED',
        package: joinedPackage || '',
        last_lead_received: lastLeadReceived,
        hours_since_last_lead: hoursSinceLastLead,
        leads_today: leadsToday,
        leads_yesterday: leadsYesterday,

        clientName: companyName,
        codeName,
        clientNameWithCode: codeName && codeName !== 'N/A' ? `${companyName} (${codeName})` : companyName,
        lastLeadReceived,
        hoursSince
        hoursSinceLastLead,
        leadsToday,
        leadsYesterday,

        purchasedLeads,
        owedLeads,
        packageStatus,
        purchaseDate
      };
    });

    // store raw leads/agents too
    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
    this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];

    // ✅ Build status options + admin performance payload
    this.adminState.statusOptions = this.getAdminStatusOptions();
    this.adminState.performance = this.buildAdminPerformance(this.currentFilter || 'this-week');
  }

  // ------------------------
  // ✅ ADMIN: Status Options (fix dropdown missing statuses)
  // ------------------------
  getAdminStatusOptions() {
    const required = ['CRITICAL', 'AT RISK', 'HEALTHY', 'NOT STARTED'];

    const found = new Set();
    (this.adminState.clients || []).forEach(c => {
      const s = (c?.status || '').toString().trim();
      if (s) found.add(s.toUpperCase());
    });

    // union required + found
    const all = new Set([...required, ...found]);

    // return in a friendly order
    const ordered = [];
    required.forEach(r => { if (all.has(r)) ordered.push(r); all.delete(r); });
    [...all].sort().forEach(x => ordered.push(x));
    return ordered;
  }

  // ------------------------
  // ✅ ADMIN: Performance Builder (team totals + chart series + top10)
  // ------------------------
  buildAdminPerformance(periodKey = 'this-week') {
    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];
    const agents = Array.isArray(this.adminState.agents) ? this.adminState.agents : [];

    const range = this.getPeriodRange(periodKey);
    const { start, end } = range;

    // Helpers: robust agent name + status + date
    const getLeadAgentName = (lead) => {
      // Try common header variants
      return (
        this.getAny(lead, ['Agent Name', 'AGENT NAME', 'agent_name', 'agent', 'Agent', 'Submitted By', 'submitted_by'], '') ||
        this.getAny(lead, ['Team Leader', 'TL', 'team_leader'], '')
      ).toString().trim();
    };

    const getLeadDecision = (lead) => {
      // confirmed/approved vs rejected/credited
      const raw =
        this.getAny(lead, ['Status', 'STATUS', 'Decision', 'DECISION', 'Lead Status', 'LEAD STATUS'], '') ||
        this.getAny(lead, ['Qualified', 'QUALIFIED'], '') ||
        '';
      return raw.toString().trim().toUpperCase();
    };

    const getLeadDate = (lead) => {
      const v =
        this.getAny(lead, ['Date', 'DATE', 'Submitted Date', 'SUBMITTED DATE', 'Created', 'CREATED', 'Timestamp', 'TIMESTAMP', 'created_at'], '');
      return this.parseDateSafe(v);
    };

    // Filter leads in range
    const inRange = [];
    for (const lead of leads) {
      const dt = getLeadDate(lead);
      if (!dt) continue;
      if (dt >= start && dt < end) inRange.push({ lead, dt });
    }

    // Build employee map (for display names)
    const employeeNameSet = new Set();
    agents.forEach(a => {
      const n = this.getAny(a, ['Agent Name', 'AGENT NAME', 'Name', 'NAME', 'agent_name'], '').toString().trim();
      if (n) employeeNameSet.add(n);
    });

    // Aggregate totals per agent
    const perAgent = {};
    const teamTotals = { total: 0, confirmed: 0, rejected: 0 };

    const bump = (agentName, type) => {
      if (!agentName) agentName = 'Unknown';
      if (!perAgent[agentName]) perAgent[agentName] = { total: 0, confirmed: 0, rejected: 0 };
      perAgent[agentName].total += 1;
      teamTotals.total += 1;

      if (type === 'CONFIRMED') {
        perAgent[agentName].confirmed += 1;
        teamTotals.confirmed += 1;
      } else if (type === 'REJECTED') {
        perAgent[agentName].rejected += 1;
        teamTotals.rejected += 1;
      }
    };

    // classify lead decision
    const classifyDecision = (decisionUpper) => {
      // confirmed synonyms
      if (
        decisionUpper.includes('CONFIRM') ||
        decisionUpper.includes('APPROV') ||
        decisionUpper.includes('QUALIF') ||
        decisionUpper === 'YES'
      ) return 'CONFIRMED';

      // rejected/credited synonyms
      if (
        decisionUpper.includes('REJECT') ||
        decisionUpper.includes('CREDIT') ||
        decisionUpper.includes('UNQUALIF') ||
        decisionUpper === 'NO'
      ) return 'REJECTED';

      // unknown -> still counts as submitted total only
      return 'UNKNOWN';
    };

    // Count leads
    inRange.forEach(({ lead }) => {
      const agentName = getLeadAgentName(lead);
      const decision = classifyDecision(getLeadDecision(lead));

      if (decision === 'CONFIRMED') bump(agentName, 'CONFIRMED');
      else if (decision === 'REJECTED') bump(agentName, 'REJECTED');
      else bump(agentName, 'UNKNOWN');
    });

    // Build Top 10 agents by total submitted
    const topAgents = Object.entries(perAgent)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => (b.total - a.total) || (b.confirmed - a.confirmed))
      .slice(0, 10);

    // Build a chart series depending on period type:
    // - today: hourly buckets (optional)
    // - this-week / prev-week: daily buckets
    // - last-4/6: weekly buckets
    // - all-time: monthly buckets (safe)
    const series = this.buildPerformanceSeries(inRange, periodKey, getLeadDecision, getLeadAgentName);

    // Provide everything your admin dashboard needs
    return {
      period: periodKey,
      range: { start: start.toISOString(), end: end.toISOString() },
      totals: teamTotals,
      topAgents,
      series
    };
  }

  // ------------------------
  // ✅ Period Ranges (today, this-week, prev-week, last-4, last-6, all-time)
  // ------------------------
  getPeriodRange(periodKey) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

    const startOfWeek = (d) => {
      // Monday start (0=Sun -> convert)
      const day = d.getDay(); // 0..6
      const diff = (day === 0 ? -6 : 1) - day;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff, 12, 0, 0);
    };

    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);

    // Default end is "tomorrow noon" for inclusive today
    const tomorrow = addDays(today, 1);

    if (periodKey === 'today') {
      return { start: today, end: tomorrow };
    }

    if (periodKey === 'this-week' || periodKey === 'current-week') {
      const sow = startOfWeek(today);
      const eow = addDays(sow, 7);
      return { start: sow, end: eow };
    }

    if (periodKey === 'prev-week' || periodKey === 'previous-week') {
      const thisSow = startOfWeek(today);
      const prevSow = addDays(thisSow, -7);
      const prevEow = addDays(thisSow, 0);
      return { start: prevSow, end: prevEow };
    }

    if (periodKey === 'last-4-weeks') {
      const thisSow = startOfWeek(today);
      const start = addDays(thisSow, -28);
      const end = addDays(thisSow, 7); // include current week window
      return { start, end };
    }

    if (periodKey === 'last-6-weeks') {
      const thisSow = startOfWeek(today);
      const start = addDays(thisSow, -42);
      const end = addDays(thisSow, 7);
      return { start, end };
    }

    // all-time fallback (last 5 years safe range)
    if (periodKey === 'all-time') {
      const start = new Date(today.getFullYear() - 5, 0, 1, 12, 0, 0);
      const end = tomorrow;
      return { start, end };
    }

    // fallback -> this week
    const sow = startOfWeek(today);
    return { start: sow, end: addDays(sow, 7) };
  }

  // ------------------------
  // ✅ Build chart-ready series (labels + totals/confirmed/rejected per bucket)
  // ------------------------
  buildPerformanceSeries(inRange, periodKey, getLeadDecision, getLeadAgentName) {
    const classifyDecision = (decisionUpper) => {
      if (
        decisionUpper.includes('CONFIRM') ||
        decisionUpper.includes('APPROV') ||
        decisionUpper.includes('QUALIF') ||
        decisionUpper === 'YES'
      ) return 'CONFIRMED';

      if (
        decisionUpper.includes('REJECT') ||
        decisionUpper.includes('CREDIT') ||
        decisionUpper.includes('UNQUALIF') ||
        decisionUpper === 'NO'
      ) return 'REJECTED';

      return 'UNKNOWN';
    };

    const buckets = {}; // key -> {label,total,confirmed,rejected}

    const addBucket = (key, label, decision) => {
      if (!buckets[key]) buckets[key] = { label, total: 0, confirmed: 0, rejected: 0 };
      buckets[key].total += 1;
      if (decision === 'CONFIRMED') buckets[key].confirmed += 1;
      if (decision === 'REJECTED') buckets[key].rejected += 1;
    };

    const pad2 = (n) => String(n).padStart(2, '0');

    for (const { lead, dt } of inRange) {
      const decisionUpper = (this.getAny(lead, ['Status', 'STATUS', 'Decision', 'DECISION', 'Lead Status', 'LEAD STATUS'], '') || '').toString().trim().toUpperCase();
      const decision = classifyDecision(decisionUpper);

      if (periodKey === 'today') {
        const key = `${pad2(dt.getHours())}:00`;
        addBucket(key, key, decision);
      } else if (periodKey === 'this-week' || periodKey === 'prev-week' || periodKey === 'current-week' || periodKey === 'previous-week') {
        const key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
        addBucket(key, key, decision);
      } else if (periodKey === 'last-4-weeks' || periodKey === 'last-6-weeks') {
        // week bucket: YYYY-W##
        const onejan = new Date(dt.getFullYear(), 0, 1, 12, 0, 0);
        const week = Math.ceil((((dt - onejan) / 86400000) + onejan.getDay() + 1) / 7);
        const key = `${dt.getFullYear()}-W${pad2(week)}`;
        addBucket(key, key, decision);
      } else {
        // all-time -> month bucket: YYYY-MM
        const key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;
        addBucket(key, key, decision);
      }
    }

    // Sort bucket keys chronologically-ish (works for our formats)
    const keys = Object.keys(buckets).sort();
    return keys.map(k => ({ key: k, ...buckets[k] }));
  }

  // ------------------------
  // ✅ ADMIN: Set performance period + refresh dashboard
  // ------------------------
  setAdminPerformancePeriod(periodKey) {
    this.currentFilter = periodKey;
    this.adminState.performance = this.buildAdminPerformance(periodKey);
    this.triggerAdminRefresh();
  }
