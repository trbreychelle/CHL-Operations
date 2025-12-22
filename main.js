// Call Hammer Leads - Main Application Logic
// Integrated with n8n Localhost Production Webhook

class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.sessionData = null;
        this.agentsData = [];
        this.leadsData = [];
        this.isLoading = false;
        
        this.webhooks = {
            // FIXED: Removed the extra "login:" word inside the string
            login: 'http://localhost:5678/webhook/agent-login', 
            fetchData: 'http://localhost:5678/webhook/fetch-agent-data', 
            addEmployee: 'http://localhost:5678/webhook/add-employee',
            timeOffRequest: 'http://localhost:5678/webhook/timeoff-request'
        };

        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();
        this.initializeAnimations();

        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            this.fetchAllData();
            this.updateProfileUI();
        }
    }

    // --- DATA FETCHING SYSTEM ---
    async fetchAllData() {
        if (!this.currentUser) return;
        this.setLoadingState(true, 'Fetching live performance data...');
        
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email })
            });

            if (!response.ok) throw new Error('Failed to fetch data');

            const result = await response.json();
            if (result.status === "success") {
                this.leadsData = result.leads || [];
                this.updateDashboardUI(this.leadsData);
                return result;
            }
        } catch (error) {
            console.error('Fetch error:', error);
            this.showError('Could not sync performance data.');
        } finally {
            this.setLoadingState(false);
        }
    }

    // --- UI RENDERING ENGINE ---
    updateDashboardUI(leads) {
        if (!this.currentUser) return;

        const nameHeader = document.getElementById('nav-user-name');
        const roleHeader = document.getElementById('nav-user-role');
        if (nameHeader) nameHeader.textContent = this.currentUser.name;
        if (roleHeader) roleHeader.textContent = this.currentUser.role || 'Sales Agent';

        const totalAppointments = leads.length;
        const cancelledCount = leads.filter(l => 
            l.Status?.toLowerCase().includes('cancel') || 
            l.Status?.toLowerCase().includes('reject')
        ).length;
        
        const cancelRate = totalAppointments > 0 ? ((cancelledCount / totalAppointments) * 100).toFixed(1) : 0;
        const incentiveStats = this.calculateIncentives(totalAppointments, cancelRate);

        const apptCount = document.getElementById('stat-appointments');
        const cancelRateDisp = document.getElementById('stat-cancel-rate');
        const incentiveDisp = document.getElementById('stat-incentives');
        
        if (apptCount) apptCount.textContent = totalAppointments;
        if (cancelRateDisp) cancelRateDisp.textContent = `${cancelRate}%`;
        if (incentiveDisp) incentiveDisp.textContent = `$${incentiveStats.totalIncentives.toLocaleString()}`;

        const progressBar = document.getElementById('tier-progress-bar');
        const tierStatusText = document.getElementById('tier-status-text');
        const tierCountDisp = document.getElementById('tier-count-display');
        
        if (progressBar) {
            let nextGoal = totalAppointments < 8 ? 8 : totalAppointments < 12 ? 12 : 15;
            const percentage = Math.min((totalAppointments / nextGoal) * 100, 100);
            progressBar.style.width = `${percentage}%`;
            if (tierCountDisp) tierCountDisp.textContent = `${totalAppointments} / ${nextGoal} appointments`;
        }
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        
        const profileFields = {
            'profileName': this.currentUser.name,
            'profilePosition': this.currentUser.position || 'Sales Agent',
            'profileRate': `$${this.currentUser.baseRate || '15.00'}/hour`,
            'profileHours': `${this.currentUser.weeklyHours || '40'} hours`,
            'profileStartDate': this.currentUser.startDate || 'January 1, 2024',
            'profileEmail': this.currentUser.email
        };

        for (const [id, value] of Object.entries(profileFields)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }
    }

    async submitTimeOffRequest(data) {
        this.setLoadingState(true, 'Submitting request...');
        try {
            const response = await fetch(this.webhooks.timeOffRequest, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: this.currentUser.email,
                    name: this.currentUser.name,
                    ...data
                })
            });

            if (!response.ok) throw new Error('Time-off service unavailable.');
            
            this.showSuccess('Time-off request sent to management!');
            return true;
        } catch (error) {
            this.showError(error.message);
            return false;
        } finally {
            this.setLoadingState(false);
        }
    }

    async login(email, password) {
        if (this.isLoading) return;
        this.setLoadingState(true, 'Connecting...');
        try {
            const response = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (!response.ok) throw new Error('Ensure n8n workflow is ACTIVE.');
            const result = await response.json();
            
            if (result.status === "success") {
                this.currentUser = { ...result.user, email: email }; 
                this.createSession(this.currentUser);
                this.showSuccess(`Welcome, ${this.currentUser.name}!`);
                setTimeout(() => this.redirectToDashboard(), 800);
            } else {
                throw new Error(result.message || 'Invalid credentials');
            }
        } catch (error) {
            this.showError(error.message);
            this.setLoadingState(false);
        }
    }

    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            try {
                const sessionData = JSON.parse(session);
                if (this.isValidSession(sessionData)) {
                    this.currentUser = sessionData.user;
                    if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
                        this.redirectToDashboard();
                    }
                }
            } catch (error) {
                localStorage.removeItem('callHammerSession');
            }
        }
    }

    createSession(user) {
        const sessionData = { user: user, timestamp: Date.now(), expiresAt: Date.now() + (24 * 60 * 60 * 1000) };
        localStorage.setItem('callHammerSession', JSON.stringify(sessionData));
    }

    isValidSession(sessionData) { return sessionData && sessionData.expiresAt > Date.now(); }

    redirectToDashboard() {
        if (!this.currentUser) return;
        window.location.href = this.currentUser.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
    }

    logout() {
        localStorage.removeItem('callHammerSession');
        window.location.href = 'index.html';
    }

    calculateIncentives(n, c) {
        let total = 0;
        const t1 = Math.min(n, 6);
        if (t1 > 0) total += t1 * 50;
        if (n >= 8) total += (c < 25 ? 50 : 30);
        const t3 = Math.max(0, Math.min(n - 8, 4));
        if (t3 > 0) total += t3 * (c < 25 ? 17 : 15);
        const t4 = Math.max(0, n - 12);
        if (t4 > 0) total += t4 * (c < 25 ? 27 : 25);
        return { totalIncentives: total };
    }

    setLoadingState(loading, text = 'Loading...') {
        this.isLoading = loading;
        const btn = document.getElementById('loginButton');
        const txt = document.getElementById('loginText');
        if (btn && txt) {
            btn.disabled = loading;
            txt.textContent = loading ? text : 'Sign In';
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
            errorDiv.querySelector('p').textContent = message;
            errorDiv.classList.remove('hidden');
        }
    }

    showSuccess(message) {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }

    bindEvents() {
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                this.login(formData.get('email'), formData.get('password'));
            });
        }
    }

    initializeAnimations() { }
}

let portal;
document.addEventListener('DOMContentLoaded', () => { portal = new CallHammerPortal(); });
