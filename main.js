// Call Hammer Leads - Main Application Logic
// Integrated with n8n Localhost Production Webhook

class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.sessionData = null;
        this.agentsData = [];
        this.leadsData = [];
        this.isLoading = false;
        
        // n8n Webhook URLs 
        this.webhooks = {
            login: 'http://localhost:5678/webhook-test/agent-login', 
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

        // If logged in on a dashboard, fetch real data immediately
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            this.fetchAllData();
        }
    }

    // --- DATA FETCHING SYSTEM ---
    async fetchAllData() {
        if (!this.currentUser) return;
        this.setLoadingState(true, 'Fetching live lead data...');
        
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email })
            });

            if (!response.ok) throw new Error('Failed to fetch data from n8n');

            const result = await response.json();
            if (result.status === "success") {
                this.leadsData = result.leads || [];
                console.log('Leads loaded from sheet:', this.leadsData);
                
                // UPDATE UI WITH REAL DATA
                this.updateAgentDashboard(this.leadsData);
                return result;
            }
        } catch (error) {
            console.error('Fetch error:', error);
            this.showError('Could not sync with Google Sheets.');
        } finally {
            this.setLoadingState(false);
        }
    }

    // --- UI RENDERING ENGINE ---
    updateAgentDashboard(leads) {
        if (!this.currentUser) return;

        // 1. Update Agent Name and Role in Header
        const nameHeader = document.querySelector('.text-sm.font-medium.text-gray-900');
        const roleHeader = document.querySelector('.text-xs.text-gray-500');
        if (nameHeader) nameHeader.textContent = this.currentUser.name;
        if (roleHeader) roleHeader.textContent = this.currentUser.role.charAt(0).toUpperCase() + this.currentUser.role.slice(1);

        // 2. Calculate Real Stats
        const totalAppointments = leads.length;
        
        // Simple cancellation calculation: find leads with "Cancelled" or "Rejected" status
        const cancelledLeads = leads.filter(l => 
            l.Status?.toLowerCase().includes('cancel') || 
            l.Status?.toLowerCase().includes('reject')
        ).length;
        
        const cancelRate = totalAppointments > 0 ? ((cancelledLeads / totalAppointments) * 100).toFixed(1) : 0;
        const incentiveStats = this.calculateIncentives(totalAppointments, cancelRate);

        // 3. Inject Values into Dashboard Cards
        const cards = document.querySelectorAll('.text-2xl.font-bold.text-gray-900');
        if (cards.length >= 3) {
            cards[0].textContent = totalAppointments; // Total Appointments Card
            cards[1].textContent = `${cancelRate}%`; // Cancellation Rate Card
            cards[2].textContent = `$${incentiveStats.totalIncentives.toLocaleString()}`; // Total Incentives Card
        }

        // 4. Update Progress Bar
        const progressBar = document.querySelector('.h-2.bg-orange-500');
        const progressText = document.querySelector('.text-sm.font-medium.text-orange-600');
        if (progressBar) {
            const nextGoal = totalAppointments < 8 ? 8 : totalAppointments < 12 ? 12 : 15;
            const percentage = Math.min((totalAppointments / nextGoal) * 100, 100);
            progressBar.style.width = `${percentage}%`;
            if (progressText) progressText.textContent = `${totalAppointments} / ${nextGoal} appointments`;
        }
    }

    // --- REAL AUTHENTICATION SYSTEM ---
    async login(email, password) {
        if (this.isLoading) return;
        this.setLoadingState(true, 'Connecting to n8n...');
        
        try {
            const response = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) throw new Error('Login server error. Ensure n8n is ACTIVE.');

            const result = await response.json();

            if (result.status === "success") {
                this.currentUser = { ...result.user, email: email }; 
                this.createSession(this.currentUser);
                this.showSuccess(`Welcome back, ${this.currentUser.name}!`);
                
                setTimeout(() => this.redirectToDashboard(), 800);
            } else {
                throw new Error(result.message || 'Invalid email or password');
            }
        } catch (error) {
            this.showError(error.message);
            this.setLoadingState(false);
        }
    }

    // --- SESSION MANAGEMENT ---
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
        const sessionData = {
            user: user,
            timestamp: Date.now(),
            expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
        };
        localStorage.setItem('callHammerSession', JSON.stringify(sessionData));
    }

    isValidSession(sessionData) {
        return sessionData && sessionData.expiresAt > Date.now();
    }

    redirectToDashboard() {
        if (!this.currentUser) return;
        const dashboardUrl = this.currentUser.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
        window.location.href = dashboardUrl;
    }

    logout() {
        localStorage.removeItem('callHammerSession');
        window.location.href = 'index.html';
    }

    // --- INCENTIVE ENGINE ---
    calculateIncentives(appointmentCount, cancellationRate) {
        const n = parseInt(appointmentCount) || 0;
        const c = parseFloat(cancellationRate) || 0;
        let totalIncentives = 0;
        let tierBreakdown = [];

        const tier1Count = Math.min(n, 6);
        if (tier1Count > 0) {
            totalIncentives += tier1Count * 50;
            tierBreakdown.push({ tier: 1, count: tier1Count, rate: 50, total: tier1Count * 50, description: '1-6 leads' });
        }

        if (n >= 8) {
            const tier2Rate = c < 25 ? 50 : 30;
            totalIncentives += tier2Rate;
            tierBreakdown.push({ tier: 2, count: 1, rate: tier2Rate, total: tier2Rate, description: `8th lead` });
        }

        const tier3Count = Math.max(0, Math.min(n - 8, 4));
        if (tier3Count > 0) {
            const tier3Rate = c < 25 ? 17 : 15;
            totalIncentives += (tier3Count * tier3Rate);
            tierBreakdown.push({ tier: 3, count: tier3Count, rate: tier3Rate, total: tier3Count * tier3Rate, description: `9-12 leads` });
        }

        const tier4Count = Math.max(0, n - 12);
        if (tier4Count > 0) {
            const tier4Rate = c < 25 ? 27 : 25;
            totalIncentives += (tier4Count * tier4Rate);
            tierBreakdown.push({ tier: 4, count: tier4Count, rate: tier4Rate, total: tier4Count * tier4Rate, description: `13+ leads` });
        }

        return { totalIncentives, tierBreakdown, appointmentCount: n, cancellationRate: c };
    }

    // --- UI HELPERS ---
    setLoadingState(loading, text = 'Loading...') {
        this.isLoading = loading;
        const btn = document.getElementById('loginButton');
        const txt = document.getElementById('loginText');
        const spinner = document.getElementById('loginSpinner');
        if (btn && txt) {
            btn.disabled = loading;
            txt.textContent = loading ? text : 'Sign In';
            if (spinner) loading ? spinner.classList.remove('hidden') : spinner.classList.add('hidden');
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

    initializeAnimations() { /* Animation logic */ }
}

// Initialize
let portal;
document.addEventListener('DOMContentLoaded', () => { portal = new CallHammerPortal(); });
