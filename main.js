// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
  constructor() {
    this.currentUser = null;
    this.leadsData = [];
    this.employeeList = [];
    this.filteredLeads = [];
    this.currentFilter = 'this-week';
    this.charts = null;

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

  // --- Payroll Week Calculation (Saturday to Friday MST) ---
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

        // ✅ Update profile from AGENT_MASTER real-time (if provided)
        if (result.profile) {
          const p = result.profile;

          // Normalize + store into currentUser so the rest of your UI uses it
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

          // Refresh stored session too
          const session = localStorage.getItem('callHammerSession');
          if (session) {
            const s = JSON.parse(session);
            s.user = this.currentUser;
            localStorage.setItem('callHammerSession', JSON.stringify(s));
          }

          this.updateProfileUI();
        }

        if (result.timeOffHistory) {
          this.renderTimeOffHistory(result.timeOffHistory);
        }

        if (window.adminDashboard) {
          window.adminDashboard.refreshDashboard();
        }

        this.handleFilterChange(this.currentFilter);
      }
    } catch (error) {
      console.error('Data Sync Error:', error);
    }
  }

  updateDashboardUI(leads) {
    const getVal = (obj, key) => {
      const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
      return foundKey ? (obj[foundKey] || '') : '';
    };

    // Payroll week incentives always use payroll week
    const payrollRange = this.getPayrollWeekRange();
    const payrollLeads = this.leadsData.filter(l => {
      const subDate = new Date(getVal(l, 'Date Submitted'));
      return subDate >= payrollRange.start && subDate <= payrollRange.end;
    });

    const payrollApproved = payrollLeads.filter(l => getVal(l, 'Status').toString().toLowerCase() === 'approved');
    const payrollTotal = payrollLeads.length;
    const payrollCancelled = payrollLeads.filter(l => {
      const s = getVal(l, 'Status').toString().toLowerCase();
      return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
    }).length;

    const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;
    const currentIncentives = this.calculateIncentives(payrollApproved.length, payrollCancelRate);

    // Stats reflect selected filter leads
    const totalRaw = leads.length;
    const cancelledCount = leads.filter(l => {
      const s = getVal(l, 'Status').toString().toLowerCase();
      return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
    }).length;
    const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : 0;

    if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
    if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
    if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(currentIncentives);

    // Weekly hours should reflect profile weekly hours (AGENT_MASTER)
    if (document.getElementById('stat-hours')) document.getElementById('stat-hours').textContent = this.currentUser?.weeklyHours || 0;

    // Progress bar
    const progressBar = document.getElementById('tier-progress-bar');
    if (progressBar) {
      let nextGoal = payrollApproved.length < 6 ? 6 : payrollApproved.length < 8 ? 8 : payrollApproved.length < 12 ? 12 : 20;
      progressBar.style.width = `${Math.min((payrollApproved.length / nextGoal) * 100, 100)}%`;
      document.getElementById('tier-count-display').textContent = `${payrollApproved.length} / ${nextGoal} approved (This Payroll Week)`;
      document.getElementById('tier-status-text').textContent = `Cycle: ${payrollRange.start.toLocaleDateString()} - ${payrollRange.end.toLocaleDateString()}`;
    }

    this.renderLeadsTable(leads);
  }

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

    body.innerHTML = leads.map(l => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 text-sm text-gray-600">${l['Date Submitted'] || 'N/A'}</td>
        <td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
        <td class="px-6 py-4">
          <span class="px-3 py-1 rounded-full text-xs font-bold ${this.getStatusStyle(l.Status)} uppercase">
            ${l.Status || 'Pending'}
          </span>
        </td>
      </tr>
    `).join('');
  }

  renderTimeOffHistory(history) {
    const container = document.getElementById('timeoff-history-list');
    if (!container) return;

    container.innerHTML = (Array.isArray(history) ? history : []).map(req => `
      <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2">
        <span class="text-[10px] font-bold text-gray-400 uppercase">${req['Start Date'] || req.startDate || ''} — ${req['End Date'] || req.endDate || ''}</span>
        <p class="text-xs text-gray-700 font-medium">${req.Reason || req.reason || 'Leave Request'}</p>
      </div>
    `).join('') || `<p class="text-xs text-gray-400 italic">No history found.</p>`;
  }

  getStatusStyle(status) {
    const s = (status || '').toLowerCase();
    if (s === 'approved') return 'bg-green-100 text-green-700';
    if (s.includes('cancel') || s.includes('reject') || s.includes('credited')) return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
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
      'stat-hours': u.weeklyHours || 0,
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

    if (value === 'this-week') {
      const range = this.getPayrollWeekRange();
      filtered = this.leadsData.filter(l => {
        const d = new Date(l['Date Submitted']);
        return d >= range.start && d <= range.end;
      });
    } else if (value === '30-days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      filtered = this.leadsData.filter(l => new Date(l['Date Submitted']) >= thirtyDaysAgo);
    } else if (value === '4-weeks') {
      const d = new Date();
      d.setDate(now.getDate() - 28);
      filtered = this.leadsData.filter(l => new Date(l['Date Submitted']) >= d);
    } else if (value === '6-weeks') {
      const d = new Date();
      d.setDate(now.getDate() - 42);
      filtered = this.leadsData.filter(l => new Date(l['Date Submitted']) >= d);
    } else if (value === 'all-time') {
      filtered = this.leadsData;
    }

    this.updateDashboardUI(filtered);
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
  }

  formatCurrency(val) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  }

  logout() {
    localStorage.removeItem('callHammerSession');
    window.location.href = 'index.html';
  }

  updateCharts() {}
}

const portal = new CallHammerPortal();
window.portal = portal;
