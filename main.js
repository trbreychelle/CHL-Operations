// Call Hammer Leads - Main Application Logic
// Optimized for Production with n8n & Caching

class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.sessionData = null;
        this.agentsData = [];
        this.leadsData = [];
        this.isLoading = false;
        
        // n8n Webhook URLs - REPLACE WITH YOUR PRODUCTION URLS FROM n8n
        this.webhooks = {
            login: 'PASTE_YOUR_PRODUCTION_LOGIN_WEBHOOK_HERE', // New: Specifically for credentials
            fetchData: 'PASTE_YOUR_PRODUCTION_FETCH_DATA_WEBHOOK_HERE',
            addEmployee: 'PASTE_YOUR_PRODUCTION_ADD_EMPLOYEE_WEBHOOK_HERE',
            timeOffRequest: 'PASTE_YOUR_PRODUCTION_TIMEOFF_WEBHOOK_HERE',
            updatePerformance: 'PASTE_YOUR_PRODUCTION_UPDATE_PERF_WEBHOOK_HERE'
        };

        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();
        this.initializeAnimations();
    }

    // --- AUTHENTICATION SYSTEM ---

    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            try {
                const sessionData = JSON.parse(session);
                if (this.isValidSession(sessionData)) {
                    this.currentUser = sessionData.user;
                    // Only redirect if we are on the login page (index.html)
                    if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
                        this.redirectToDashboard();
                    }
                }
            } catch (error) {
                localStorage.removeItem('callHammerSession');
            }
        }
    }

    async login(email, password) {
        if (this.isLoading) return;
        this.setLoadingState(true, 'Verifying Credentials...');
        
        try {
            // REAL API CALL: Talking to your n8n Login Workflow
            const response = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.status === "success") {
                this.currentUser = result.user; // Includes name, role, etc. from Google Sheet
                this.createSession(this.currentUser);
                this.showSuccess('Login successful!');
                
                setTimeout(() => this.redirectToDashboard(), 800);
            } else {
                throw new Error(result.message || 'Invalid email or password');
            }
        } catch (error) {
            this.showError(error.message || 'Login failed. Server unreachable.');
            this.setLoadingState(false);
        }
    }

    createSession(user) {
        const sessionData = {
            user: user,
            timestamp: Date.now(),
            expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
        };
        localStorage.setItem('callHammerSession', JSON.stringify(sessionData));
        this.sessionData = sessionData;
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
        localStorage.removeItem('cachedLeadsData'); // Clear cache on logout
        window.location.href = 'index.html';
    }

    // --- DATA MANAGEMENT WITH CACHING ---

    async fetchAllData() {
        // Anti-Execution Glitch: Check cache first (Valid for 1 hour)
        const cachedData = localStorage.getItem('cachedLeadsData');
        const cacheTime = localStorage.getItem('cacheTimestamp');
        const oneHour = 60 * 60 * 1000;

        if (cachedData && (Date.now() - cacheTime < oneHour)) {
            const data = JSON.parse(cachedData);
            this.agentsData = data.agents || [];
            this.leadsData = data.leads || [];
            console.log("Loading data from local cache...");
            return data;
        }

        try {
            this.setLoadingState(true, 'Fetching latest leads...');
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST', // Webhooks usually prefer POST for security
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.currentUser?.id })
            });

            if (response.ok) {
                const data = await response.json();
                this.agentsData = data.agents || [];
                this.leadsData = data.leads || [];
                
                // Save to cache to save n8n executions
                localStorage.setItem('cachedLeadsData', JSON.stringify(data));
                localStorage.setItem('cacheTimestamp', Date.now().toString());
                
                return data;
            } else {
                throw new Error('Server returned an error');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            this.showError('Could not load real-time data. Check n8n status.');
            return { agents: [], leads: [] }; // No mock fallback
        } finally {
            this.setLoadingState(false);
        }
    }

    // --- INCENTIVE ENGINE (The Math) ---
    calculateIncentives(appointmentCount, cancellationRate) {
        const n = parseInt(appointmentCount) || 0;
        const c = parseFloat(cancellationRate) || 0;
        let totalIncentives = 0;
        let tierBreakdown = [];

        // Tier 1: 1-6 leads - $50 each
        const tier1Count = Math.min(n, 6);
        if (tier1Count > 0) {
            const tier1Total = tier1Count * 50;
            totalIncentives += tier1Total;
            tierBreakdown.push({ tier: 1, count: tier1Count, rate: 50, total: tier1Total, description: '1-6 leads' });
        }

        // Tier 2: 8th lead - Special bonus
        if (n >= 8) {
            const tier2Rate = c < 25 ? 50 : 30;
            totalIncentives += tier2Rate;
            tierBreakdown.push({ tier: 2, count: 1, rate: tier2Rate, total: tier2Rate, description: `8th lead (${c < 25 ? 'Low Cancel Bonus' : 'Standard'})` });
        }

        // Tier 3: 9-12 leads
        const tier3Count = Math.max(0, Math.min(n - 8, 4));
        if (tier3Count > 0) {
            const tier3Rate = c < 25 ? 17 : 15;
            const tier3Total = tier3Count * tier3Rate;
            totalIncentives += tier3Total;
            tierBreakdown.push({ tier: 3, count: tier3Count, rate: tier3Rate, total: tier3Total, description: `9-12 leads (${c < 25 ? '$17 bonus' : '$15'})` });
        }

        // Tier 4: 13+ leads
        const tier4Count = Math.max(0, n - 12);
        if (tier4Count > 0) {
            const tier4Rate = c < 25 ? 27 : 25;
            const tier4Total = tier4Count * tier4Rate;
            totalIncentives += tier4Total;
            tierBreakdown.push({ tier: 4, count: tier4Count, rate: tier4Rate, total: tier4Total, description: `13+ leads (${c < 25 ? '$27 bonus' : '$25'})` });
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

    initializeAnimations() { /* Animation logic here */ }
}

// Initialize
let portal;
document.addEventListener('DOMContentLoaded', () => { portal = new CallHammerPortal(); });
