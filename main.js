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
                
                // --- NEW: UPDATE THE UI WITH REAL DATA ---
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

    // --- NEW: UI RENDERING ENGINE ---
    updateDashboardUI(leads) {
        if (!this.currentUser) return;

        // 1. Update Header Name
        const headerName = document.querySelector('.text-sm.font-medium.text-gray-900');
        if (headerName) headerName.textContent = this.currentUser.name;

        // 2. Calculate Stats from Leads
        const totalAppointments = leads.length;
        
        // Calculate Cancel Rate (Status contains 'Cancel' or 'Reject')
        const cancelledCount = leads.filter(l => 
            l.Status?.toLowerCase().includes('cancel') || 
            l.Status?.toLowerCase().includes('reject')
        ).length;
        
        const cancelRate = totalAppointments > 0 ? ((cancelledCount / totalAppointments) * 100).toFixed(1) : 0;
        
        // Use your existing Incentive Engine
        const incentiveStats = this.calculateIncentives(totalAppointments, cancelRate);

        // 3. Inject Values into Dashboard Cards
        // Card order: 0=Appointments, 1=Cancel Rate, 2=Incentives, 3=Hours
        const cards = document.querySelectorAll('.text-2xl.font-bold.text-gray-900');
        if (cards.length >= 3) {
            cards[0].textContent = totalAppointments;
            cards[1].textContent = `${cancelRate}%`;
            cards[2].textContent = `$${incentiveStats.totalIncentives.toLocaleString()}`;
        }

        // 4. Update the Progress Bar
        const progressBar = document.querySelector('.h-2.bg-orange-500');
        const progressText = document.querySelector('.text-sm.font-medium.text-orange-600');
        const countDisplay = document.querySelector('.text-sm.text-gray-500.ml-auto');
        
        if (progressBar) {
            const nextGoal = totalAppointments < 8 ? 8 : totalAppointments < 12 ? 12 : 15;
            const percentage = Math.min((totalAppointments / nextGoal) * 100, 100);
            progressBar.style.width = `${percentage}%`;
            
            if (progressText) progressText.textContent = `Current: Tier ${totalAppointments < 8 ? '2' : totalAppointments < 12 ? '3' : '4'}`;
            if (countDisplay) countDisplay.textContent = `${totalAppointments} / ${nextGoal} appointments`;
        }
        
        console.log(`UI Updated: ${totalAppointments} real leads found for ${this.currentUser.name}`);
    }

    // --- EXISTING AUTH & SESSION LOGIC ---
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
