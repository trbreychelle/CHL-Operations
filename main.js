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
            fetchData: 'https://automate.callhammerleads.com/webhook-test/fetch-agent-data',
            timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
            changePassword: 'https://automate.callhammerleads.com/webhook/change-password'
        };
        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();

        if (this.currentUser && window.location.pathname.includes('dashboard')) {
            this.fetchAllData();
            this.updateProfileUI();
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
                    name: this.currentUser.name 
                })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.leadsData = result.leads || [];
                
                // Load Time Off History if management provides it in the response
                if (result.timeOffHistory) {
                    this.renderTimeOffHistory(result.timeOffHistory);
                }
                
                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { 
            console.error('Data Sync Error:', error); 
        }
    }

    handleFilterChange(value) {
        this.currentFilter = value;
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        this.filteredLeads = this.leadsData.filter(lead => {
            if (value === 'all-time') return true;
            const dateStr = lead['Date Submitted'] || lead['Appointment Date /Time'];
            if (!dateStr) return false;

            const itemDate = new Date(dateStr);
            const diffDays = (now - itemDate) / (1000 * 60 * 60 * 24);

            switch(value) {
                case 'this-week':
                    const day = now.getDay();
                    const diff = now.getDate() - day + (day == 0 ? -6 : 1);
                    const monday = new Date(new Date().setDate(diff));
                    monday.setHours(0,0,0,0);
                    return itemDate >= monday;
                case '30-days': return diffDays <= 30;
                case '4-weeks': return diffDays <= 28;
                case '6-weeks': return diffDays <= 42;
                default: return true;
            }
        });
        this.updateDashboardUI(this.filteredLeads);
    }

    // --- DASHBOARD UI UPDATES ---
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
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
        }).length;

        const cancelRate = totalRaw > 0 ? ((cancelledCount / totalRaw) * 100).toFixed(1) : 0;
        const incentives = this.calculateIncentives(approvedCount, parseFloat(cancelRate));

        // Update Stat Cards
        document.getElementById('stat-appointments').textContent = totalRaw;
        document.getElementById('stat-cancel-rate').textContent = `${cancelRate}%`;
        document.getElementById('stat-incentives').textContent = this.formatCurrency(incentives);
        
        // Update Progress Bar
        const progressBar = document.getElementById('tier-progress-bar');
        if (progressBar) {
            let nextGoal = approvedCount < 6 ? 6 : approvedCount < 8 ? 8 : approvedCount < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((approvedCount / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${approvedCount} / ${nextGoal} approved appointments`;
        }

        this.renderLeadsTable(leads);
        this.updateCharts(leads); 
    }

    // --- RENDER LEAD LIST (FIXED: Date first, then Name, No Address) ---
    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        const statusFilter = document.getElementById('status-filter')?.value || 'all';
        if (!body) return;

        const filtered = statusFilter === 'all' 
            ? leads 
            : leads.filter(l => (l.Status || '').toLowerCase() === statusFilter.toLowerCase());

        body.innerHTML = filtered.map(l => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 text-sm text-gray-600">${l['Date Submitted'] || 'N/A'}</td>
                <td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4">
                    <span class="px-3 py-1 rounded-full text-xs font-bold ${this.getStatusStyle(l.Status)} uppercase">
                        ${l.Status || 'Pending Review'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    // --- RENDER TIME OFF HISTORY ---
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
                    <span class="text-[10px] font-bold text-gray-400 uppercase">${req.startDate} — ${req.endDate}</span>
                    <span class="text-[8px] font-bold ${this.getStatusStyle(req.Status)} uppercase px-2 py-0.5 rounded">${req.Status || 'Pending'}</span>
                </div>
                <p class="text-xs text-gray-700 mt-1 font-medium">${req.reason || 'Leave Request'}</p>
            </div>
        `).join('');
    }

    getStatusStyle(status) {
        const s = (status || '').toLowerCase();
        if (s === 'approved') return 'bg-green-100 text-green-700';
        if (s.includes('reject') || s.includes('cancel')) return 'bg-red-100 text-red-700';
        return 'bg-orange-100 text-orange-700';
    }

    // --- CHART LOGIC (FUNCTIONAL) ---
    initCharts() {
        const appChartEl = document.getElementById('appointmentsChart');
        const incChartEl = document.getElementById('incentivesChart');
        if (appChartEl && incChartEl) {
            this.charts = {
                appointments: echarts.init(appChartEl),
                incentives: echarts.init(incChartEl)
            };
        }
    }

    updateCharts(leads) {
        if (!this.charts) this.initCharts();
        if (!this.charts) return;

        // Group leads by date for the graph
        const dateGroups = leads.reduce((acc, lead) => {
            const date = lead['Date Submitted'] || 'N/A';
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});

        const sortedDates = Object.keys(dateGroups).sort((a, b) => new Date(a) - new Date(b)).slice(-7);
        const appointmentCounts = sortedDates.map(date => dateGroups[date]);
        const incentiveProjection = appointmentCounts.map(count => count * 50); 

        this.charts.appointments.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: sortedDates },
            yAxis: { type: 'value' },
            series: [{ data: appointmentCounts, type: 'bar', itemStyle: { color: '#FF6B35' } }]
        });

        this.charts.incentives.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: sortedDates },
            yAxis: { type: 'value' },
            series: [{ data: incentiveProjection, type: 'line', smooth: true, lineStyle: { color: '#FF8C61', width: 3 }, areaStyle: { color: 'rgba(255, 140, 97, 0.1)' } }]
        });
    }

    // --- INCENTIVE CALCULATION (PRESERVED) ---
    calculateIncentives(approvedN, cancelRate) {
        let total = 0;
        const isHighPerf = cancelRate < 25; 

        if (approvedN >= 1) total += 50; 
        if (approvedN >= 8) total += (isHighPerf ? 50 : 30);
        
        if (approvedN >= 9) {
            const extra = Math.min(approvedN, 12) - 8;
            total += extra * (isHighPerf ? 17 : 15);
        }
        
        if (approvedN >= 13) {
            const extra = approvedN - 12;
            total += extra * (isHighPerf ? 27 : 25);
        }

        return total;
    }

    // --- PROFILE & SESSION (PRESERVED) ---
    updateProfileUI() {
        if (!this.currentUser) return;
        const map = {
            'profileName': this.currentUser.name,
            'profileEmail': this.currentUser.email,
            'profilePosition': this.currentUser.role,
            'profileRate': this.formatCurrency(this.currentUser.baseRate || 0),
            'profileHours': this.currentUser.weeklyHours || 'N/A',
            'profileStartDate': this.currentUser.startDate || 'N/A',
            'nav-user-name': this.currentUser.name
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

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
                window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
            } else { alert(result.message || "Login failed"); }
        } catch (err) { alert("Login failed: Network error"); }
    }

    // --- AGENT ACTIONS (PRESERVED) ---
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
