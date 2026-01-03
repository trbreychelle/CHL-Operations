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

                // If admin-dashboard.html is open, refresh its UI
                if (window.adminDashboard) {
                    window.adminDashboard.refreshDashboard();
                }

                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { 
            console.error('Data Sync Error:', error); 
        }
    }

    renderEmployeeManagement(employees) {
        const container = document.getElementById('employee-list-body');
        if (!container) return;
        container.innerHTML = employees.map(emp => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 text-sm font-bold text-gray-900">${emp['Employee Name'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm text-gray-600">${emp.Email || 'N/A'}</td>
                <td class="px-6 py-4 text-sm font-medium uppercase">${emp.Role || 'Agent'}</td>
                <td class="px-6 py-4 text-sm">
                    <span class="px-2 py-1 rounded text-xs ${emp.Employment_Status === 'Offboarded' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">
                        ${emp.Employment_Status || 'Active'}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <button onclick="portal.offboardEmployee('${emp.Email}')" class="text-red-600 hover:text-red-900 text-xs font-bold">OFFBOARD</button>
                </td>
            </tr>
        `).join('');
    }

    async offboardEmployee(email) {
        if (!confirm(`Are you sure you want to offboard ${email}?`)) return;
        try {
            const res = await fetch(this.webhooks.manageEmployee, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'offboard', email: email })
            });
            if (res.ok) { 
                alert('Employee status updated.'); 
                this.fetchAllData(); 
            }
        } catch (err) { alert('Failed to update status.'); }
    }

    updateDashboardUI(leads) {
        const getVal = (obj, key) => {
            const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
            return foundKey ? (obj[foundKey] || '') : '';
        };

        const totalRaw = leads.length;
        const approvedLeads = leads.filter(l => getVal(l, 'Status').toString().toLowerCase() === 'approved');
        const cancelledCount = leads.filter(l => {
            const s = getVal(l, 'Status').toString().toLowerCase();
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
        }).length;

        const rate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : 0;
        const incentives = this.calculateIncentives(approvedLeads.length, parseFloat(rate));

        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
        if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(incentives);
        
        const progressBar = document.getElementById('tier-progress-bar');
        if (progressBar) {
            let nextGoal = approvedLeads.length < 6 ? 6 : approvedLeads.length < 8 ? 8 : 12;
            progressBar.style.width = `${Math.min((approvedLeads.length / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${approvedLeads.length} / ${nextGoal} approved`;
        }
        this.renderLeadsTable(leads);
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
            'nav-user-role': (u.role || 'Agent').toUpperCase()
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    handleFilterChange(value) {
        this.currentFilter = value;
        this.updateDashboardUI(this.leadsData);
    }

    calculateIncentives(approvedN, cancelRate) {
        let total = 0;
        for (let i = 1; i <= approvedN; i++) {
            if (i <= 6) total += 50;
            else if (i === 8) total += (cancelRate < 25) ? 50 : 30;
            else if (i >= 9) total += (cancelRate < 25) ? 17 : 15;
        }
        return total;
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
    }

    formatCurrency(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0); }
    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
    updateCharts() {}
}
const portal = new CallHammerPortal();
window.portal = portal;
