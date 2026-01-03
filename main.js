// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.employeeList = []; // Roster for Admin access
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

                if (window.adminDashboard) {
                    window.adminDashboard.refreshDashboard();
                }

                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { 
            console.error('Data Sync Error:', error); 
        }
    }

    // --- NEW: Payroll Week Calculation (Saturday to Friday MST) ---
    getPayrollWeekRange() {
        // Get current time in MST (UTC-7)
        const now = new Date();
        const mstOffset = -7 * 60; // MST in minutes
        const localOffset = now.getTimezoneOffset();
        const mstNow = new Date(now.getTime() + (mstOffset + localOffset) * 60000);
        
        const dayOfWeek = mstNow.getDay(); // 0 (Sun) to 6 (Sat)
        
        // Calculate start of payroll (The most recent Saturday)
        const start = new Date(mstNow);
        const diffToSat = (dayOfWeek === 6) ? 0 : (dayOfWeek + 1);
        start.setDate(mstNow.getDate() - diffToSat);
        start.setHours(0, 0, 0, 0);

        // Calculate end of payroll (The upcoming Friday)
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        return { start, end };
    }

    updateDashboardUI(leads) {
        const getVal = (obj, key) => {
            const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
            return foundKey ? (obj[foundKey] || '') : '';
        };

        // 1. Identify leads for the CURRENT Payroll Week (Sat-Fri) for Incentive Calculation
        const payrollRange = this.getPayrollWeekRange();
        const payrollLeads = this.leadsData.filter(l => {
            const subDate = new Date(getVal(l, 'Date Submitted'));
            return subDate >= payrollRange.start && subDate <= payrollRange.end;
        });

        // 2. Metrics for the Payroll Week
        const payrollApproved = payrollLeads.filter(l => getVal(l, 'Status').toString().toLowerCase() === 'approved');
        const payrollTotal = payrollLeads.length;
        const payrollCancelled = payrollLeads.filter(l => {
            const s = getVal(l, 'Status').toString().toLowerCase();
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
        }).length;

        const payrollCancelRate = payrollTotal > 0 ? (payrollCancelled / payrollTotal) * 100 : 0;
        
        // 3. Calculate Incentives based on Payroll Week Data
        const currentIncentives = this.calculateIncentives(payrollApproved.length, payrollCancelRate);

        // 4. Update UI Stats (Appointments and Rate reflect the chosen Filter, Incentives reflect the Payroll Week)
        const totalRaw = leads.length;
        const cancelledCount = leads.filter(l => {
            const s = getVal(l, 'Status').toString().toLowerCase();
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
        }).length;
        const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : 0;

        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
        if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(currentIncentives);
        
        // Progress bar logic (Next Tier Goal)
        const progressBar = document.getElementById('tier-progress-bar');
        if (progressBar) {
            let nextGoal = payrollApproved.length < 6 ? 6 : payrollApproved.length < 8 ? 8 : payrollApproved.length < 12 ? 12 : 20;
            progressBar.style.width = `${Math.min((payrollApproved.length / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${payrollApproved.length} / ${nextGoal} approved (This Payroll Week)`;
            document.getElementById('tier-status-text').textContent = `Cycle: ${payrollRange.start.toLocaleDateString()} - ${payrollRange.end.toLocaleDateString()}`;
        }

        this.renderLeadsTable(leads);
    }

    // --- FIXED: Tiered Incentive Logic based on Reference Table ---
    calculateIncentives(approvedN, cancelRate) {
        let total = 0;
        const isHighPerf = cancelRate < 25;

        for (let i = 1; i <= approvedN; i++) {
            if (i <= 7) {
                // 1st - 7th Apt: $50
                total += 50;
            } else if (i === 8) {
                // 8th Apt: $30 or $50
                total += isHighPerf ? 50 : 30;
            } else if (i >= 9 && i <= 12) {
                // 9th - 12th Apt: $15 or $17
                total += isHighPerf ? 17 : 15;
            } else if (i >= 13) {
                // 13th & Above: $25 or $27
                total += isHighPerf ? 27 : 25;
            }
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
        container.innerHTML = history.map(req => `
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2">
                <span class="text-[10px] font-bold text-gray-400 uppercase">${req['Start Date']} — ${req['End Date']}</span>
                <p class="text-xs text-gray-700 font-medium">${req.Reason || 'Leave Request'}</p>
            </div>
        `).join('');
    }

    getStatusStyle(status) {
        const s = (status || '').toLowerCase();
        if (s === 'approved') return 'bg-green-100 text-green-700';
        if (s.includes('cancel') || s.includes('reject')) return 'bg-red-100 text-red-700';
        return 'bg-yellow-100 text-yellow-700';
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const u = this.currentUser;
        const map = {
            'profileName': u.name, 'profileEmail': u.email, 'profilePosition': u.role,
            'profileRate': this.formatCurrency(u.baseRate), 'nav-user-name': u.name,
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
            const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
            filtered = this.leadsData.filter(l => new Date(l['Date Submitted']) >= thirtyDaysAgo);
        }

        this.updateDashboardUI(filtered);
    }

    async login(email, password) {
        try {
            const res = await fetch(this.webhooks.login, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            const result = await res.json();
            if (result.status === "success") {
                const userObj = { 
                    name: result.user['Employee Name'], role: result.user.Role || 'agent', email, 
                    baseRate: result.user['Base Rate'], weeklyHours: result.user['Weekly Hours'], startDate: result.user['Start Date'] 
                };
                localStorage.setItem('callHammerSession', JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 }));
                window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
            } else { alert("Login failed"); }
        } catch (err) { alert("Network error"); }
    }

    async submitTimeOffRequest(data) {
        try {
            const res = await fetch(this.webhooks.timeOffRequest, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, email: this.currentUser.email, name: this.currentUser.name }) });
            return res.ok;
        } catch (err) { return false; }
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
        if (loginForm) loginForm.onsubmit = (e) => { e.preventDefault(); this.login(new FormData(loginForm).get('email'), new FormData(loginForm).get('password')); };
        
        const timeframeSelect = document.getElementById('timeframe-filter');
        if (timeframeSelect) {
            timeframeSelect.onchange = (e) => this.handleFilterChange(e.target.value);
        }
    }

    formatCurrency(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0); }
    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
    updateCharts() {}
}
const portal = new CallHammerPortal();
window.portal = portal;
