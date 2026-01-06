// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
  constructor() {
    this.currentUser = null;
    this.leadsData = [];
    this.employeeList = [];
    this.filteredLeads = [];
    this.currentFilter = 'this-week';
    this.currentStatusFilter = 'all';

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
    this.bindEvents();

    if (this.currentUser && window.location.pathname.includes('dashboard')) {
      this.fetchAllData();
      this.updateProfileUI();

      if (this.currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      } else if (this.currentUser.role === 'team_leader') {
        document.querySelectorAll('.tl-only').forEach(el => el.classList.remove('hidden'));
      }
    }
  }

  // ---------- Utilities ----------
  getVal(obj, key) {
    const foundKey = Object.keys(obj || {}).find(k => k.toLowerCase() === key.toLowerCase());
    return foundKey ? (obj[foundKey] ?? '') : '';
  }

  // Robust parse for Google Sheets date strings
  parseDate(value) {
    if (!value) return null;
    // If it's already a Date-like string, try Date()
    const d1 = new Date(value);
    if (!isNaN(d1.getTime())) return d1;

    // Try MM/DD/YYYY
    const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const mm = parseInt(m[1], 10) - 1;
      const dd = parseInt(m[2], 10);
      const yyyy = parseInt(m[3], 10);
      const d2 = new Date(yyyy, mm, dd);
      return isNaN(d2.getTime()) ? null : d2;
    }
    return null;
  }

  // ---------- Payroll Week (Sat-Fri) ----------
  // Uses America/Denver time (covers DST better than "UTC-7")
  getPayrollWeekRange() {
    const now = new Date();
    const denverStr = now.toLocaleString('en-US', { timeZone: 'America/Denver' });
    const mstNow = new Date(denverStr);

    const dayOfWeek = mstNow.getDay(); // 0 Sun ... 6 Sat

    // most recent Saturday
    const start = new Date(mstNow);
    const diffToSat = (dayOfWeek === 6) ? 0 : (dayOfWeek + 1);
    start.setDate(mstNow.getDate() - diffToSat);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  // ---------- Data ----------
  async fetchAllData() {
    if (!this.currentUser) return;
    try {
      const response = await fetch(this.webhooks.fetchData, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.currentUser.email,
          name: this.currentUser.name,
          role: this.currentUser.role
        })
      });

      const result = await response.json();

      if (result.status === "success") {
        this.leadsData = result.leads || [];
        this.employeeList = result.employeeList || [];

        if (result.timeOffHistory) {
          this.renderTimeOffHistory(result.timeOffHistory);
        }

        // If admin dashboard exists on page, let it refresh
        if (window.adminDashboard) {
          window.adminDashboard.refreshDashboard();
        }

        // Apply filters and render
        this.applyFiltersAndRender();
      } else {
        console.error('Fetch failed:', result);
      }
    } catch (error) {
      console.error('Data Sync Error:', error);
    }
  }

  applyFiltersAndRender() {
    // 1) timeframe filter => filteredLeads
    const leadsByTime = this.filterLeadsByTime(this.currentFilter, this.leadsData);

    // 2) status filter => final leads displayed in table
    const finalLeads = this.filterLeadsByStatus(this.currentStatusFilter, leadsByTime);

    this.filteredLeads = finalLeads;
    this.updateDashboardUI(leadsByTime, finalLeads);
  }

  filterLeadsByTime(filterValue, leads) {
    const now = new Date();
    let filtered = [...(leads || [])];

    if (filterValue === 'this-week') {
      const range = this.getPayrollWeekRange();
      filtered = filtered.filter(l => {
        const d = this.parseDate(this.getVal(l, 'Date Submitted'));
        return d && d >= range.start && d <= range.end;
      });
    } else if (filterValue === '30-days') {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      filtered = filtered.filter(l => {
        const d = this.parseDate(this.getVal(l, 'Date Submitted'));
        return d && d >= from;
      });
    } else if (filterValue === '4-weeks') {
      const from = new Date(now);
      from.setDate(from.getDate() - 28);
      filtered = filtered.filter(l => {
        const d = this.parseDate(this.getVal(l, 'Date Submitted'));
        return d && d >= from;
      });
    } else if (filterValue === '6-weeks') {
      const from = new Date(now);
      from.setDate(from.getDate() - 42);
      filtered = filtered.filter(l => {
        const d = this.parseDate(this.getVal(l, 'Date Submitted'));
        return d && d >= from;
      });
    } else if (filterValue === 'all-time') {
      // no filtering
    }

    return filtered;
  }

  filterLeadsByStatus(statusValue, leads) {
    if (!leads) return [];
    if (!statusValue || statusValue === 'all') return leads;

    const target = statusValue.toLowerCase();
    return leads.filter(l => String(this.getVal(l, 'Status')).toLowerCase() === target);
  }

  // ---------- UI ----------
  updateDashboardUI(leadsForMetrics, leadsForTable) {
    // Incentives should always reflect CURRENT payroll week
    const payrollRange = this.getPayrollWeekRange();
    const payrollLeads = (this.leadsData || []).filter(l => {
      const subDate = this.parseDate(this.getVal(l, 'Date Submitted'));
      return subDate && subDate >= payrollRange.start && subDate <= payrollRange.end;
    });

    const payrollApproved = payrollLeads.filter(l =>
      String(this.getVal(l, 'Status')).toLowerCase() === 'approved'
    );

    const payrollTotal = payrollLeads.length;

    const payrollCancelled = payrollLeads.filter(l => {
      const s = String(this.getVal(l, 'Status')).toLowerCase();
      return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
    }).length;

    const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;
    const currentIncentives = this.calculateIncentives(payrollApproved.length, payrollCancelRate);

    // Metrics for selected timeframe
    const totalRaw = leadsForMetrics.length;

    const cancelledCount = leadsForMetrics.filter(l => {
      const s = String(this.getVal(l, 'Status')).toLowerCase();
      return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
    }).length;

    const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : 0;

    const statAppointments = document.getElementById('stat-appointments');
    const statCancelRate = document.getElementById('stat-cancel-rate');
    const statIncentives = document.getElementById('stat-incentives');

    if (statAppointments) statAppointments.textContent = totalRaw;
    if (statCancelRate) statCancelRate.textContent = `${rate}%`;
    if (statIncentives) statIncentives.textContent = this.formatCurrency(currentIncentives);

    // Progress bar (Payroll week approved count)
    const progressBar = document.getElementById('tier-progress-bar');
    if (progressBar) {
      const approvedCount = payrollApproved.length;
      let nextGoal = approvedCount < 6 ? 6 : approvedCount < 8 ? 8 : approvedCount < 12 ? 12 : 20;

      progressBar.style.width = `${Math.min((approvedCount / nextGoal) * 100, 100)}%`;

      const tierCount = document.getElementById('tier-count-display');
      const tierStatus = document.getElementById('tier-status-text');

      if (tierCount) tierCount.textContent = `${approvedCount} / ${nextGoal} approved (This Payroll Week)`;
      if (tierStatus) tierStatus.textContent = `Cycle: ${payrollRange.start.toLocaleDateString()} - ${payrollRange.end.toLocaleDateString()}`;
    }

    // Render table
    this.renderLeadsTable(leadsForTable);

    // Charts
    this.updateCharts();
  }

  // Tiered Incentive Logic
  calculateIncentives(approvedN, cancelRate) {
    let total = 0;
    const isHighPerf = cancelRate < 25;

    for (let i = 1; i <= approvedN; i++) {
      if (i <= 7) total += 50;
      else if (i === 8) total += isHighPerf ? 50 : 30;
      else if (i >= 9 && i <= 12) total += isHighPerf ? 17 : 15;
      else if (i >= 13) total += isHighPerf ? 27 : 25;
    }
    return total;
  }

  renderLeadsTable(leads) {
    const body = document.getElementById('leads-table-body');
    if (!body) return;

    body.innerHTML = (leads || []).map(l => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 text-sm text-gray-600">${this.getVal(l, 'Date Submitted') || 'N/A'}</td>
        <td class="px-6 py-4 font-bold text-gray-900">${this.getVal(l, 'Homeowner Name(s)') || 'N/A'}</td>
        <td class="px-6 py-4">
          <span class="px-3 py-1 rounded-full text-xs font-bold ${this.getStatusStyle(this.getVal(l, 'Status'))} uppercase">
            ${this.getVal(l, 'Status') || 'Pending'}
          </span>
        </td>
      </tr>
    `).join('');
  }

  renderTimeOffHistory(history) {
    const container = document.getElementById('timeoff-history-list');
    if (!container) return;

    container.innerHTML = (history || []).map(req => `
      <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2">
        <span class="text-[10px] font-bold text-gray-400 uppercase">${req['Start Date']} — ${req['End Date']}</span>
        <p class="text-xs text-gray-700 font-medium">${req.Reason || 'Leave Request'}</p>
      </div>
    `).join('');
  }

  getStatusStyle(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 'bg-green-100 text-green-700';
    if (s.includes('cancel') || s.includes('reject') || s.includes('credited')) return 'bg-red-100 text-red-700';
    if (s.includes('pending')) return 'bg-yellow-100 text-yellow-700';
    return 'bg-yellow-100 text-yellow-700';
  }

  updateProfileUI() {
    if (!this.currentUser) return;

    const u = this.currentUser;
    const map = {
      'profileName': u.name,
      'profileEmail': u.email,
      'profilePosition': u.role,
      'profileRate': this.formatCurrency(u.baseRate),
      'nav-user-name': u.name,
      'nav-user-role': (u.role || 'Agent').toUpperCase(),
      'stat-hours': u.weeklyHours || 0,
      'profileHours': u.weeklyHours || 0,
      'profileStartDate': u.startDate || 'N/A'
    };

    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }
  }

  // Charts: weekly trends (last 8 weeks)
  updateCharts() {
    const elApt = document.getElementById('appointmentsChart');
    const elInc = document.getElementById('incentivesChart');
    if (!elApt || !elInc || typeof echarts === 'undefined') return;

    if (!this.charts.appointments) this.charts.appointments = echarts.init(elApt);
    if (!this.charts.incentives) this.charts.incentives = echarts.init(elInc);

    // Build weekly buckets for last 8 weeks (Sun-Sat display)
    const now = new Date();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - (i * 7));
      start.setHours(0, 0, 0, 0);

      // normalize to week start (Sunday)
      const dow = start.getDay();
      start.setDate(start.getDate() - dow);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      weeks.push({ start, end });
    }

    const weekLabels = weeks.map(w => `${w.start.getMonth()+1}/${w.start.getDate()}`);
    const weeklyAppointments = weeks.map(w => {
      return (this.leadsData || []).filter(l => {
        const d = this.parseDate(this.getVal(l, 'Date Submitted'));
        return d && d >= w.start && d <= w.end;
      }).length;
    });

    const weeklyIncentives = weeks.map(w => {
      // incentives based on APPROVED + cancel rate for that week window
      const weekLeads = (this.leadsData || []).filter(l => {
        const d = this.parseDate(this.getVal(l, 'Date Submitted'));
        return d && d >= w.start && d <= w.end;
      });

      const approved = weekLeads.filter(l => String(this.getVal(l, 'Status')).toLowerCase() === 'approved').length;
      const cancelled = weekLeads.filter(l => {
        const s = String(this.getVal(l, 'Status')).toLowerCase();
        return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
      }).length;

      const rate = weekLeads.length > 0 ? (cancelled / weekLeads.length) * 100 : 0;
      return this.calculateIncentives(approved, rate);
    });

    this.charts.appointments.setOption({
      xAxis: { type: 'category', data: weekLabels },
      yAxis: { type: 'value' },
      tooltip: { trigger: 'axis' },
      series: [{ data: weeklyAppointments, type: 'line', smooth: true }]
    });

    this.charts.incentives.setOption({
      xAxis: { type: 'category', data: weekLabels },
      yAxis: { type: 'value' },
      tooltip: { trigger: 'axis' },
      series: [{ data: weeklyIncentives, type: 'bar' }]
    });

    window.addEventListener('resize', () => {
      this.charts.appointments?.resize();
      this.charts.incentives?.resize();
    });
  }

  // ---------- Auth ----------
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
          role: result.user.Role || 'agent',
          email,
          baseRate: result.user['Base Rate'],
          weeklyHours: result.user['Weekly Hours'],
          startDate: result.user['Start Date']
        };

        localStorage.setItem('callHammerSession', JSON.stringify({
          user: userObj,
          expiresAt: Date.now() + 86400000
        }));

        window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
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

  // ---------- Events ----------
  bindEvents() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.onsubmit = (e) => {
        e.preventDefault();
        const form = new FormData(loginForm);
        this.login(form.get('email'), form.get('password'));
      };
    }

    const timeframeSelect = document.getElementById('timeframe-filter');
    if (timeframeSelect) {
      timeframeSelect.onchange = (e) => {
        this.currentFilter = e.target.value;
        this.applyFiltersAndRender();
      };
    }

    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
      statusFilter.onchange = (e) => {
        this.currentStatusFilter = e.target.value;
        this.applyFiltersAndRender();
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
