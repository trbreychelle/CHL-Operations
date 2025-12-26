// Call Hammer Leads - Unified Application Logic (Agent & Admin)
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.isLoading = false;
        this.currentFilter = 'this-week';
        
        this.webhooks = {
            login: 'http://localhost:5678/webhook/agent-login', 
            fetchData: 'http://localhost:5678/webhook/fetch-agent-data', 
            fetchAdminData: 'http://localhost:5678/webhook/fetch-admin-dashboard',
            timeOffRequest: 'http://localhost:5678/webhook/timeoff-request'
        };
        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();
        
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            if (this.currentUser.role !== 'admin') {
                this.fetchAllData();
                this.updateProfileUI();
            }
        }
    }

    // --- ADMIN DATA FETCHING ---
    async fetchAdminDashboardData(timeFrame) {
        if (!this.currentUser || this.currentUser.role !== 'admin') return { status: "error" };
        try {
            const response = await fetch(this.webhooks.fetchAdminData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    adminEmail: this.currentUser.email,
                    currentTimeFrame: timeFrame 
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Admin Data Sync Error:', error);
            return { status: "error" };
        }
    }

    formatCurrency(val) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    }

    // --- AGENT DATA FETCHING ---
    async fetchAllData() {
        if (!this.currentUser || !this.currentUser.email) return;
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.leadsData = result.leads || [];
                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { console.error('Data Sync Error:', error); }
    }

    handleFilterChange(value) {
        this.currentFilter = value;
        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        this.filteredLeads = this.leadsData.filter(lead => {
            const dateStr = lead['Date Submitted'] || lead['Appointment Date /Time'];
            if (!dateStr) return false;
            const submittedDate = new Date(dateStr);
            const diffDays = (startOfDay - submittedDate) / (1000 * 60 * 60 * 24);
            if (value === 'this-week' || value === 'current_week') {
                const day = startOfDay.getDay(); 
                const diff = startOfDay.getDate() - day + (day == 0 ? -6 : 1); 
                const monday = new Date(new Date().setDate(diff));
                monday.setHours(0,0,0,0);
                return submittedDate >= monday;
            }
            if (value === 'last-30-days' || value === 'last_30_days') return diffDays <= 30;
            return true;
        });
        this.updateDashboardUI(this.filteredLeads);
    }

    updateDashboardUI(leads) {
        const totalRaw = leads.length;
        const approvedCount = leads.filter(l => (l.Status || '').toLowerCase() === 'approved').length;
        const cancelled = leads.filter(l => {
            const s = (l.Status || '').toLowerCase();
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
        }).length;
        const rate = totalRaw > 0 ? ((cancelled / totalRaw) * 100).toFixed(1) : 0;
        
        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
        if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
    }

    async login(email, password) {
        try {
            const response = await fetch(this.webhooks.login, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            const result = await response.json();
            if (result.status === "success") {
                const userObj = { ...result.user, email: email };
                this.currentUser = userObj;
                localStorage.setItem('callHammerSession', JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 }));
                window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
            }
        } catch (err) { alert("Login failed"); }
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
    }

    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
}
const portal = new CallHammerPortal();
