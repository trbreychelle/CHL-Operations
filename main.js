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
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            this.fetchAllData();
            this.updateProfileUI();
        }
    }

    // --- DATA FETCHING SYSTEM ---
    async fetchAllData() {
        if (!this.currentUser) return;
        this.setLoadingState(true, 'Fetching performance data...');
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
            }
        } catch (error) {
            console.error('Fetch error:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    // --- UI RENDERING ENGINE ---
    updateDashboardUI(leads) {
        if (!this.currentUser) return;

        // 1. Header Updates
        const navName = document.getElementById('nav-user-name');
        if (navName) navName.textContent = this.currentUser.name;

        // 2. Calculations
        const total = leads.length;
        const cancelled = leads.filter(l => l.Status?.toLowerCase().includes('cancel') || l.Status?.toLowerCase().includes('reject')).length;
        const rate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
        
        // Revised Incentive Engine
        const incentiveStats = this.calculateIncentives(total, parseFloat(rate));

        // 3. Update Stat Cards
        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = total;
        if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = `$${incentiveStats.totalIncentives}`;

        // 4. Progress Bar & Tier Logic (FIXED)
        const progressBar = document.getElementById('tier-progress-bar');
        const tierStatusText = document.getElementById('tier-status-text');
        if (progressBar) {
            let nextGoal = total < 6 ? 6 : total < 8 ? 8 : total < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((total / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${total} / ${nextGoal} appointments`;

            if (tierStatusText) {
                let tier = total >= 13 ? "Tier 4 (High Performance)" : total >= 9 ? "Tier 3" : total >= 8 ? "Tier 2" : total >= 1 ? "Tier 1" : "Base Only";
                tierStatusText.textContent = `Current: ${tier}`;
            }
        }

        this.renderCharts(leads);
        this.renderLeadsTable(leads);
    }

    // --- REVISED INCENTIVE ENGINE ---
    calculateIncentives(n, c) {
        let total = 0;
        const highPerf = c < 25;

        // Rule 1: 1st - 6th Apt = $50 FLAT
        if (n >= 1) total += 50;

        // Rule 2: 8th Apt = $30 (Std) or $50 (High) FLAT
        if (n >= 8) total += (highPerf ? 50 : 30);

        // Rule 3: 9th - 12th Apt = $15 (Std) or $17 (High) EACH
        const t3Count = Math.max(0, Math.min(n, 12) - 8);
        if (t3Count > 0) total += t3Count * (highPerf ? 17 : 15);

        // Rule 4: 13th+ Apt = $25 (Std) or $27 (High) EACH
        const t4Count = Math.max(0, n - 12);
        if (t4Count > 0) total += t4Count * (highPerf ? 27 : 25);

        return { totalIncentives: total };
    }

    // --- CHART & TABLE RENDERERS ---
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
            yAxis: { type: 'value', minInterval: 1 },
            series: [{ data: apptCounts, type: 'line', smooth: true, color: '#FF6B35' }]
        });
        
        echarts.init(incDom).setOption({
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value' },
            series: [{ data: [0,0,0,0,0], type: 'bar', color: '#FF6B35' }] // Placeholder for daily earnings
        });
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (body) body.innerHTML = leads.map(l => `
            <tr>
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${l['Appointment Date /Time'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm font-bold text-orange-600">${l.Status || 'Pending'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${l.Address || 'N/A'}</td>
            </tr>
        `).join('');
    }

    // --- AUTH & SESSION ---
    async login(email, password) {
        if (this.isLoading) return;
        this.setLoadingState(true, 'Connecting...');
        try {
            const response = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.currentUser = { ...result.user, email: email };
                localStorage.setItem('callHammerSession', JSON.stringify({ user: this.currentUser, expiresAt: Date.now() + 86400000 }));
                window.location.href = 'agent-dashboard.html';
            } else { throw new Error(result.message); }
        } catch (err) { alert("Login failed: " + err.message); this.setLoadingState(false); }
    }

    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            const data = JSON.parse(session);
            if (data.expiresAt > Date.now()) this.currentUser = data.user;
        }
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const fields = { 'profileName': this.currentUser.name, 'profileEmail': this.currentUser.email };
        for (const [id, val] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    bindEvents() {
        const form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', (e) => {
            e.preventDefault();
            const data = new FormData(form);
            this.login(data.get('email'), data.get('password'));
        });
    }

    setLoadingState(loading, text = 'Sign In') {
        this.isLoading = loading;
        const btn = document.getElementById('loginButton');
        if (btn) btn.disabled = loading;
    }
}

const portal = new CallHammerPortal();
