// Call Hammer Leads - Unified Application Logic (Agent & Admin)
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.isLoading = false;
        this.currentFilter = 'this-week';

        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook/agent-login', 
            fetchData: 'https://automate.callhammerleads.com/webhook-test/fetch-agent-data', 
            fetchAdminData: 'https://automate.callhammerleads.com/webhook/fetch-admin-dashboard',
            timeOffRequest: 'https://automate.callhammerleads.com/webhook-test/timeoff-request',
            // --- Restored New Features ---
            changePassword: 'https://automate.callhammerleads.com/webhook/change-password',
            resetPassword: 'https://automate.callhammerleads.com/webhook/reset-password'
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

    // --- FORGOT PASSWORD LOGIC ---
    async triggerAutoReset() {
        const emailInput = document.getElementById('resetEmail');
        const email = emailInput ? emailInput.value.trim() : null;
        if (!email) return alert("Please enter your work email.");

        try {
            const response = await fetch(this.webhooks.resetPassword, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email })
            });
            alert("If the email exists, a new temporary password has been sent!");
            if (typeof toggleResetModal === 'function') toggleResetModal();
        } catch (err) {
            alert("Connection error. Ensure n8n is listening.");
        }
    }

    // --- CHANGE PASSWORD LOGIC ---
    async updatePassword(newPassword) {
        if (!this.currentUser) return alert("You must be logged in.");
        try {
            const response = await fetch(this.webhooks.changePassword, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email, newPassword })
            });
            const result = await response.json();
            if (result.status === "success") {
                alert("Password updated successfully!");
                return true;
            }
            throw new Error(result.message || "Update failed");
        } catch (error) {
            alert("Failed to update password.");
            return false;
        }
    }

    // --- ORIGINAL INTERFACE DATA FETCHING ---
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

            if (value === 'this-week') {
                const day = startOfDay.getDay(); 
                const diff = startOfDay.getDate() - day + (day == 0 ? -6 : 1); 
                const monday = new Date(new Date().setDate(diff));
                monday.setHours(0,0,0,0);
                return submittedDate >= monday;
            }
            if (value === 'last-30-days') return diffDays <= 30;
            return true;
        });
        this.updateDashboardUI(this.filteredLeads);
    }

    // --- ORIGINAL INTERFACE UI LOGIC ---
    updateDashboardUI(leads) {
        const totalRaw = leads.length;
        const approvedCount = leads.filter(l => (l.Status || '').toLowerCase() === 'approved').length;
        const cancelled = leads.filter(l => {
            const s = (l.Status || '').toLowerCase();
            return s.includes('cancel') || s.includes('credited') || s.includes('rejected');
        }).length;

        const rate = totalRaw > 0 ? ((cancelled / totalRaw) * 100).toFixed(1) : 0;
        const incentives = this.calculateIncentives(approvedCount, parseFloat(rate));

        // Update Stat Cards
        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = totalRaw;
        if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = this.formatCurrency(incentives);
        
        // Update Progress Bar
        const progressBar = document.getElementById('tier-progress-bar');
        if (progressBar) {
            let nextGoal = approvedCount < 6 ? 6 : approvedCount < 8 ? 8 : approvedCount < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((approvedCount / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${approvedCount} / ${nextGoal} approved appointments`;
        }

        this.renderCharts(leads, parseFloat(rate));
        this.renderLeadsTable(leads);
    }

    calculateIncentives(approvedN, cancelRate) {
        let total = 0;
        const isHighPerf = cancelRate < 25; 
        if (approvedN >= 1) total += 50; 
        if (approvedN >= 8) total += (isHighPerf ? 50 : 30);
        return total;
    }

    renderCharts(leads, cancelRate) {
        const apptDom = document.getElementById('appointmentsChart');
        if (!apptDom || typeof echarts === 'undefined') return;
        // ... (Echarts logic from your original code) ...
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (body) body.innerHTML = leads.map(l => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4">${l['Date Submitted'] || 'N/A'}</td>
                <td class="px-6 py-4 text-orange-600 font-bold">${l.Status || 'Pending'}</td>
                <td class="px-6 py-4">${l.Address || 'N/A'}</td>
            </tr>
        `).join('');
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const map = {
            'profileName': this.currentUser.name,
            'profileEmail': this.currentUser.email,
            'nav-user-name': this.currentUser.name
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    // --- LOGIN & AUTH ---
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
    }

    formatCurrency(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val); }
    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
}

const portal = new CallHammerPortal();
window.triggerAutoReset = () => portal.triggerAutoReset();
