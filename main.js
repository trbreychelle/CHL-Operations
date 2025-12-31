// Call Hammer Leads - Unified Application Logic (Agent & Admin)
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.isLoading = false;
        this.currentFilter = 'this-week';
        
        // WEBHOOKS SET TO TEST MODE FOR INITIAL N8N SETUP
        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook-test/agent-login', 
            fetchData: 'https://automate.callhammerleads.com/webhook-test/fetch-agent-data', 
            fetchAdminData: 'https://automate.callhammerleads.com/webhook-test/fetch-admin-dashboard',
            timeOffRequest: 'https://automate.callhammerleads.com/webhook-test/timeoff-request',
            changePassword: 'https://automate.callhammerleads.com/webhook-test/change-password',
            resetPassword: 'https://automate.callhammerleads.com/webhook-test/reset-password'
        };
        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();
        
        // Only fetch data if we are actually on a dashboard page
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            this.fetchAllData();
        }
    }

    // --- RESTORED: DASHBOARD DATA FETCHING ---
    async fetchAllData() {
        if (!this.currentUser) return;
        this.setLoading(true);
        
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: this.currentUser.email,
                    role: this.currentUser.role 
                })
            });
            const data = await response.json();
            
            if (data.status === "success") {
                this.leadsData = data.leads || [];
                this.updateUI(data.stats);
                this.filterLeads();
            }
        } catch (error) {
            console.error('Data Fetch Error:', error);
        } finally {
            this.setLoading(false);
        }
    }

    filterLeads() {
        // Logic to filter leads based on this.currentFilter (e.g., 'this-week')
        const now = new Date();
        this.filteredLeads = this.leadsData.filter(lead => {
            const leadDate = new Date(lead.date);
            // Example filter: just showing all for now, but you can add date logic here
            return true; 
        });
        this.renderLeadsTable();
    }

    renderLeadsTable() {
        const tbody = document.getElementById('leadsTableBody');
        if (!tbody) return;

        tbody.innerHTML = this.filteredLeads.map(lead => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${lead.date || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${lead.clientName || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                        ${lead.status === 'Set' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        ${lead.status || 'Pending'}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">$${lead.incentive || '0.00'}</td>
            </tr>
        `).join('');
    }

    updateUI(stats) {
        // Updates the stat cards (Total Appointments, Net Pay, etc.)
        if (!stats) return;
        const elements = {
            'totalApps': stats.totalAppointments,
            'netPay': `$${stats.netPay}`,
            'points': stats.points
        };
        for (const [id, val] of Object.entries(elements)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    setLoading(state) {
        this.isLoading = state;
        const loader = document.getElementById('globalLoader');
        if (loader) loader.classList.toggle('hidden', !state);
    }

    // --- AUTHENTICATION & SECURITY ---
    async login(email, password) {
        try {
            const response = await fetch(this.webhooks.login, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ email, password }) 
            });
            const result = await response.json();
            if (result.status === "success") {
                const userObj = { ...result.user, email: email };
                this.currentUser = userObj;
                localStorage.setItem('callHammerSession', JSON.stringify({ 
                    user: userObj, 
                    expiresAt: Date.now() + 86400000 
                }));
                window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
            } else {
                alert("Login failed: " + (result.message || "Invalid credentials"));
            }
        } catch (err) { 
            alert("Connection error. Ensure you are in 'Test' mode in n8n and the workflow is listening."); 
        }
    }

    // ... (rest of your existing methods: logout, checkExistingSession, updatePassword, etc.) ...

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
}

const portal = new CallHammerPortal();
window.triggerAutoReset = () => portal.triggerAutoReset();
