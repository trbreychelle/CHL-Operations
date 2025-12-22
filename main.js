// Call Hammer Leads - Main Application Logic
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.isLoading = false;
        this.webhooks = {
            login: 'http://localhost:5678/webhook/agent-login', 
            fetchData: 'http://localhost:5678/webhook/fetch-agent-data', 
            timeOffRequest: 'http://localhost:5678/webhook/timeoff-request'
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

    // --- LOGIN ENGINE ---
    async login(email, password) {
        if (this.isLoading) return;
        this.setLoadingState(true);
        try {
            const response = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.currentUser = { ...result.user, email: email }; 
                this.createSession(this.currentUser);
                window.location.href = 'agent-dashboard.html';
            } else {
                throw new Error(result.message || 'Invalid credentials');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert("Login Failed: " + error.message);
            this.setLoadingState(false);
        }
    }

    // --- DATA & INCENTIVE ENGINE ---
    async fetchAllData() {
        if (!this.currentUser) return;
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.leadsData = result.leads || [];
                this.updateDashboardUI(this.leadsData);
            }
        } catch (error) {
            console.error('Fetch error:', error);
        }
    }

    calculateIncentives(n, c) {
        let total = 0;
        const isHighPerf = c < 25;
        // Rules: 1-6 is $50 flat, 8th is $30/$50 flat, 9-12 is $15/$17 each, 13+ is $25/$27 each.
        if (n >= 1) total += 50; 
        if (n >= 8) total += (isHighPerf ? 50 : 30);
        const tier3Count = Math.max(0, Math.min(n, 12) - 8);
        if (tier3Count > 0) total += tier3Count * (isHighPerf ? 17 : 15);
        const tier4Count = Math.max(0, n - 12);
        if (tier4Count > 0) total += tier4Count * (isHighPerf ? 27 : 25);
        return { totalIncentives: total };
    }

    // --- UI UPDATES ---
    updateDashboardUI(leads) {
        const total = leads.length;
        const cancelled = leads.filter(l => l.Status?.toLowerCase().includes('cancel')).length;
        const cancelRate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
        const incentives = this.calculateIncentives(total, parseFloat(cancelRate));

        document.getElementById('stat-appointments').textContent = total;
        document.getElementById('stat-cancel-rate').textContent = `${cancelRate}%`;
        document.getElementById('stat-incentives').textContent = `$${incentives.totalIncentives}`;

        const progressBar = document.getElementById('tier-progress-bar');
        const tierStatusText = document.getElementById('tier-status-text');
        if (progressBar) {
            const nextGoal = total < 6 ? 6 : total < 8 ? 8 : total < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((total / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${total} / ${nextGoal} appointments`;
            if (tierStatusText) {
                let tier = total >= 13 ? "Tier 4" : total >= 9 ? "Tier 3" : total >= 8 ? "Tier 2" : "Tier 1";
                tierStatusText.textContent = `Current: ${tier}`;
            }
        }
        this.renderCharts(leads);
        this.renderLeadsTable(leads);
    }

    renderCharts(leads) {
        const apptDom = document.getElementById('appointmentsChart');
        const incDom = document.getElementById('incentivesChart');
        if (!apptDom || !incDom || typeof echarts === 'undefined') return;
        
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const apptCounts = [0, 0, 0, 0, 0];
        leads.forEach(l => {
            const d = new Date(l['Appointment Date /Time']).getDay() - 1;
            if (d >= 0 && d <= 4) apptCounts[d]++;
        });

        echarts.init(apptDom).setOption({
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value' },
            series: [{ data: apptCounts, type: 'line', smooth: true, color: '#FF6B35' }]
        });
        // Incentives bar chart initialization follows same pattern...
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (body) body.innerHTML = leads.map(l => `
            <tr><td class="px-6 py-4">${l['Homeowner Name(s)']}</td><td class="px-6 py-4">${l['Appointment Date /Time']}</td><td class="px-6 py-4">${l.Status}</td></tr>
        `).join('');
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const elName = document.getElementById('profileName');
        const elEmail = document.getElementById('profileEmail');
        if (elName) elName.textContent = this.currentUser.name;
        if (elEmail) elEmail.textContent = this.currentUser.email;
        const navName = document.getElementById('nav-user-name');
        if (navName) navName.textContent = this.currentUser.name;
    }

    // --- SESSION & EVENTS ---
    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            const data = JSON.parse(session);
            if (data.expiresAt > Date.now()) this.currentUser = data.user;
        }
    }
    createSession(user) {
        localStorage.setItem('callHammerSession', JSON.stringify({ user, expiresAt: Date.now() + 86400000 }));
    }
    logout() {
        localStorage.removeItem('callHammerSession');
        window.location.href = 'index.html';
    }
    setLoadingState(loading) {
        this.isLoading = loading;
        const btn = document.getElementById('loginButton');
        if (btn) btn.disabled = loading;
    }
    bindEvents() {
        const form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', e => {
            e.preventDefault();
            const data = new FormData(form);
            this.login(data.get('email'), data.get('password'));
        });
    }
}
let portal;
document.addEventListener('DOMContentLoaded', () => { portal = new CallHammerPortal(); });
