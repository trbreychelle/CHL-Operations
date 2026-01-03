// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.currentFilter = 'this-week';

        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook/agent-login',
            fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data',
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
    }

    // --- RENDER LEAD LIST (With Status) ---
    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (!body) return;
        body.innerHTML = leads.map(l => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4">${l['Date Submitted'] || 'N/A'}</td>
                <td class="px-6 py-4 text-orange-600 font-bold">${l.Status || 'Pending Review'}</td>
                <td class="px-6 py-4 text-xs text-gray-500">${l.Address || 'N/A'}</td>
            </tr>
        `).join('');
    }

    // --- INCENTIVE CALCULATION (Exact Tiers) ---
    calculateIncentives(approvedN, cancelRate) {
        let total = 0;
        const isHighPerf = cancelRate < 25; 

        if (approvedN >= 1) total += 50; // 1st - 6th Apt Tier
        if (approvedN >= 8) total += (isHighPerf ? 50 : 30); // 8th Apt Tier
        
        // 9th - 12th Apt Tier
        if (approvedN >= 9) {
            const extra = Math.min(approvedN, 12) - 8;
            total += extra * (isHighPerf ? 17 : 15);
        }
        
        // 13th & Above Tier
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
        const filterSelect = document.getElementById('timeframe-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', (e) => this.handleFilterChange(e.target.value));
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
