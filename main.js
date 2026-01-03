// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.currentFilter = 'this-week';
        this.charts = null; 

        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook/agent-login',
            // Updated to Production URL for data consistency
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
            
            // Multi-Admin & Team Leader Role Logic
            if (this.currentUser.role === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            } else if (this.currentUser.role === 'team_leader') {
                document.querySelectorAll('.tl-only').forEach(el => el.classList.remove('hidden'));
            }
        }
    }

    // --- DATA FETCHING & FILTERING ---
    async fetchAllData() {
        if (!this.currentUser) return;
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: this.currentUser.email,
                    name: this.currentUser.name,
                    role: this.currentUser.role // Passing role for n8n branching logic
                })
            });
            const result = await response.json();
            
            if (result.status === "success") {
                // Safely handle leads and history from any n8n branch
                this.leadsData = result.leads || [];
                
                if (result.timeOffHistory) {
                    this.renderTimeOffHistory(result.timeOffHistory);
                }

                // If Admin, handle the global employee list for management
                if (result.employeeList && this.currentUser.role === 'admin') {
                    this.renderEmployeeManagement(result.employeeList);
                }
                
                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { 
            console.error('Data Sync Error:', error); 
        }
    }

    // --- ADMIN MANAGEMENT UI ---
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
                alert('Employee status updated to Offboarded.'); 
                this.fetchAllData(); 
            }
        } catch (err) { alert('Failed to update employee status.'); }
    }

    // --- DASHBOARD UI & RENDERERS ---
    updateDashboardUI(leads) {
        const getVal = (obj, key) => {
            const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
            return foundKey ? (obj[foundKey] || '') : '';
        };

        const totalRaw = leads.length;
        const approvedLeads = leads.filter(l => getVal(l, 'Status').toString().toLowerCase() === 'approved');
        const approvedCount = approvedLeads.length;
        
        const cancelledCount = leads.filter(l => {
            const s = getVal(l, 'Status').toString().toLowerCase();
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected') || s.includes('declined');
        }).length;

        const cancelRate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : 0;
        const incentives = this.calculateIncentives(approvedCount, parseFloat(cancelRate));

        document.getElementById('stat-appointments').textContent = totalRaw;
        document.getElementById('stat-cancel-rate').textContent = `${cancelRate}%`;
        document.getElementById('stat-incentives').textContent = this.formatCurrency(incentives);
        
        const progressBar = document.getElementById('tier-progress-bar');
        if (progressBar) {
            let nextGoal = approvedCount < 6 ? 6 : approvedCount < 8 ? 8 : approvedCount < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((approvedCount / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${approvedCount} / ${nextGoal} approved appointments`;
        }

        this.renderLeadsTable(leads);
        this.updateCharts(leads); 
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (!body) return;
        const statusFilter = document.getElementById('status-filter')?.value || 'all';
        const filtered = statusFilter === 'all' ? leads : leads.filter(l => (l.Status || '').toLowerCase() === statusFilter.toLowerCase());

        body.innerHTML = filtered.map(l => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 text-sm text-gray-600">${l['Date Submitted'] || 'N/A'}</td>
                <td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4">
                    <span class="px-3 py-1 rounded-full text-xs font-bold ${this.getStatusStyle(l.Status)} uppercase">
                        ${l.Status || 'Pending Approval'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    renderTimeOffHistory(history) {
        const container = document.getElementById('timeoff-history-list');
        if (!container) return;
        if (!history.length) {
            container.innerHTML = '<p class="text-xs text-gray-400 italic">No history found.</p>';
            return;
        }

        container.innerHTML = history.map(req => `
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2">
                <div class="flex justify-between items-start">
                    <span class="text-[10px] font-bold text-gray-400 uppercase">${req.startDate || req['Start Date']} — ${req.endDate || req['End Date']}</span>
                    <span class="text-[8px] font-bold ${this.getStatusStyle(req.Status)} uppercase px-2 py-0.5 rounded">${req.Status || 'Pending'}</span>
                </div>
                <p class="text-xs text-gray-700 mt-1 font-medium">${req.Reason || 'Leave Request'}</p>
            </div>
        `).join('');
    }

    getStatusStyle(status) {
        const s = (status || '').toLowerCase();
        if (s === 'approved') return 'bg-green-100 text-green-700';
        if (s.includes('declined') || s.includes('reject') || s.includes('cancel')) return 'bg-red-100 text-red-700';
        return 'bg-yellow-100 text-yellow-700';
    }

    // --- PROFILE & SESSION MAPPING ---
    updateProfileUI() {
        if (!this.currentUser) return;
        const u = this.currentUser;
        
        const map = {
            'profileName': u.name || u['Employee Name'] || 'N/A',
            'profileEmail': u.email || u.Email || 'N/A',
            'profilePosition': u.role || u.Role || 'N/A',
            'profileRate': this.formatCurrency(parseFloat(u.baseRate || u['Base Rate']) || 0),
            'profileHours': u['Weekly Hours'] || 'N/A', // Matches Google Sheet header
            'profileStartDate': u['Start Date'] || 'N/A', // Matches Google Sheet header
            'nav-user-name': u.name || u['Employee Name'],
            'nav-user-role': (u.role || u.Role || 'Agent').replace('_', ' ').toUpperCase()
        };

        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    // --- CORE METHODS (UNCHANGED) ---
    handleFilterChange(value) { /* ... Logic same as your snippet ... */ }
    initCharts() { /* ... Logic same as your snippet ... */ }
    updateCharts(leads) { /* ... Logic same as your snippet ... */ }
    calculateIncentives(approvedN, cancelRate) { /* ... Logic same as your snippet ... */ }
    
    async login(email, password) {
        try {
            const response = await fetch(this.webhooks.login, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ email, password }) 
            });
            const result = await response.json();
            if (result.status === "success") {
                const userObj = { 
                    name: result.user['Employee Name'] || result.user.name,
                    role: result.user.Role || result.user.role,
                    email: email,
                    baseRate: result.user['Base Rate'],
                    weeklyHours: result.user['Weekly Hours'],
                    startDate: result.user['Start Date']
                };
                this.currentUser = userObj;
                localStorage.setItem('callHammerSession', JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 }));
                
                // Routes admins and agents appropriately
                window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
            } else { alert(result.message || "Login failed"); }
        } catch (err) { alert("Login failed: Network error"); }
    }

    async submitTimeOffRequest(data) {
        try {
            const response = await fetch(this.webhooks.timeOffRequest, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ ...data, email: this.currentUser.email, name: this.currentUser.name }) 
            });
            return response.ok;
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
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = new FormData(loginForm);
                await this.login(data.get('email'), data.get('password'));
            });
        }
        
        const timeframeFilter = document.getElementById('timeframe-filter');
        if (timeframeFilter) {
            timeframeFilter.addEventListener('change', (e) => this.handleFilterChange(e.target.value));
        }

        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.renderLeadsTable(this.filteredLeads));
        }
    }

    formatCurrency(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val); }

    logout() { 
        localStorage.removeItem('callHammerSession'); 
        window.location.href = 'index.html'; 
    }
}

const portal = new CallHammerPortal();
window.portal = portal;
