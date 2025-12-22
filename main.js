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
                
                // Update the Dashboard UI with the real data
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

        // 1. Update Header Name & Role using the new IDs from your HTML
        const nameHeader = document.getElementById('nav-user-name');
        const roleHeader = document.getElementById('nav-user-role');
        
        if (nameHeader) nameHeader.textContent = this.currentUser.name;
        if (roleHeader) roleHeader.textContent = this.currentUser.role || 'Sales Agent';

        // 2. Calculate Stats from Real Sheet Data
        const totalAppointments = leads.length;
        
        // Find leads marked as "Cancelled" or "Rejected" in the sheet
        const cancelledCount = leads.filter(l => 
            l.Status?.toLowerCase().includes('cancel') || 
            l.Status?.toLowerCase().includes('reject')
        ).length;
        
        const cancelRate = totalAppointments > 0 ? ((cancelledCount / totalAppointments) * 100).toFixed(1) : 0;
        const incentiveStats = this.calculateIncentives(totalAppointments, cancelRate);

        // 3. Inject Values into the Metric Cards
        const apptCount = document.getElementById('stat-appointments');
        const cancelRateDisp = document.getElementById('stat-cancel-rate');
        const incentiveDisp = document.getElementById('stat-incentives');
        
        if (apptCount) apptCount.textContent = totalAppointments;
        if (cancelRateDisp) cancelRateDisp.textContent = `${cancelRate}%`;
        if (incentiveDisp) incentiveDisp.textContent = `$${incentiveStats.totalIncentives.toLocaleString()}`;

        // 4. Update the Progress Bar and Tier Text
        const progressBar = document.getElementById('tier-progress-bar');
        const tierStatusText = document.getElementById('tier-status-text');
        const tierCountDisp = document.getElementById('tier-count-display');
        
        if (progressBar) {
            // Logic to determine the current tier based on appointments
            let currentTier = "Tier 1 (1-6 leads)";
            let nextGoal = 8;

            if (totalAppointments >= 12) {
                currentTier = "Tier 4 (13+ leads)";
                nextGoal = 20; // Cap for the bar
            } else if (totalAppointments >= 8) {
                currentTier = "Tier 3 (9-12 leads)";
                nextGoal = 12;
            } else if (totalAppointments >= 6) {
                currentTier = "Tier 2 (8th lead)";
                nextGoal = 8;
            }

            const percentage = Math.min((totalAppointments / nextGoal) * 100, 100);
            progressBar.style.width = `${percentage}%`;
            
            if (tierStatusText) tierStatusText.textContent = `Current: ${currentTier}`;
            if (tierCountDisp) tierCountDisp.textContent = `${totalAppointments} / ${nextGoal} appointments`;
        }
        
        console.log(`UI Sync Complete: ${totalAppointments} leads for ${this.currentUser.name}`);
    }

    // --- AUTHENTICATION & SESSION LOGIC ---
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

    // --- MATH & UTILITIES ---
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
