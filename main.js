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

    // --- DATE FILTERING ---
    handleFilterChange(value) {
        this.currentFilter = value;
        this.applyDateFilter(value);
    }

    applyDateFilter(filterType) {
        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        
        this.filteredLeads = this.leadsData.filter(lead => {
            const dateStr = lead['Date Submitted'] || lead['Appointment Date /Time'];
            if (!dateStr) return false;
            const submittedDate = new Date(dateStr);
            const diffDays = (startOfDay - submittedDate) / (1000 * 60 * 60 * 24);

            if (filterType === 'this-week') {
                const day = startOfDay.getDay(); 
                const diff = startOfDay.getDate() - day + (day == 0 ? -6 : 1); 
                const monday = new Date(new Date().setDate(diff));
                monday.setHours(0,0,0,0);
                return submittedDate >= monday;
            }
            if (filterType === 'last-30-days') return diffDays <= 30;
            if (filterType === 'last-4-weeks') return diffDays <= 28;
            if (filterType === 'last-6-weeks') return diffDays <= 42;
            return true;
        });

        this.updateDashboardUI(this.filteredLeads);
    }

    // --- DATA FETCHING ---
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
                this.applyDateFilter(this.currentFilter); 
            }
        } catch (error) { console.error('Fetch error:', error); }
    }

    updateDashboardUI(leads) {
        const total = leads.length;
        const cancelled = leads.filter(l => l.Status?.toLowerCase().includes('cancel')).length;
        const rate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
        const stats = this.calculateIncentives(total, parseFloat(rate));

        document.getElementById('stat-appointments').textContent = total;
        document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        document.getElementById('stat-incentives').textContent = `$${stats.totalIncentives}`;

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
        this.renderCharts(leads, parseFloat(rate));
        this.renderLeadsTable(leads);
    }

    calculateIncentives(n, c) {
        let total = 0;
        const highPerf = c < 25;
        if (n >= 1) total += 50; 
        if (n >= 8) total += (highPerf ? 50 : 30);
        const t3Count = Math.max(0, Math.min(n, 12) - 8);
        if (t3Count > 0) total += t3Count * (highPerf ? 17 : 15);
        const t4Count = Math.max(0, n - 12);
        if (t4Count > 0) total += t4Count * (highPerf ? 27 : 25);
        return { totalIncentives: total };
    }

    renderCharts(leads, cancelRate) {
        const apptDom = document.getElementById('appointmentsChart');
        const incDom = document.getElementById('incentivesChart');
        if (!apptDom || !incDom || typeof echarts === 'undefined') return;

        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const counts = [0,0,0,0,0,0,0];
        const earnings = [0,0,0,0,0,0,0];

        leads.forEach(l => {
            const dateStr = l['Date Submitted'] || l['Appointment Date /Time'];
            if (dateStr) {
                const dObj = new Date(dateStr);
                let dIdx = dObj.getDay() - 1;
                if (dIdx === -1) dIdx = 6; // Sunday
                if (dIdx >= 0 && dIdx <= 6) {
                    counts[dIdx]++;
                    if (!l.Status?.toLowerCase().includes('cancel')) {
                        earnings[dIdx] += (cancelRate < 25 ? 17 : 15); 
                    }
                }
            }
        });

        echarts.init(apptDom).setOption({
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{ data: counts, type: 'line', smooth: true, color: '#FF6B35' }]
        });

        echarts.init(incDom).setOption({
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value' },
            series: [{ data: earnings, type: 'bar', color: '#FF6B35' }]
        });
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (body) body.innerHTML = leads.map(l => `
            <tr><td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td><td class="px-6 py-4 text-gray-500">${l['Date Submitted'] || 'N/A'}</td><td class="px-6 py-4 text-orange-600 font-bold">${l.Status || 'Pending'}</td><td class="px-6 py-4 text-gray-500">${l.Address || 'N/A'}</td></tr>
        `).join('');
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const map = {
            'profileName': this.currentUser.name, 'profileEmail': this.currentUser.email,
            'profilePosition': this.currentUser.position || 'Agent', 'profileRate': `$${this.currentUser.baseRate || '15.00'}/hr`,
            'profileHours': `${this.currentUser.weeklyHours || '40'} hours`, 'profileStartDate': this.currentUser.startDate || 'N/A',
            'nav-user-name': this.currentUser.name
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    // --- AUTH ---
    async login(email, password) {
        if (this.isLoading) return;
        this.isLoading = true;
        try {
            const response = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.currentUser = result.user;
                localStorage.setItem('callHammerSession', JSON.stringify({ user: result.user, expiresAt: Date.now() + 86400000 }));
                window.location.href = 'agent-dashboard.html';
            } else { alert(result.message); }
        } catch (err) { alert("Login Error: Connection failed"); }
        finally { this.isLoading = false; }
    }

    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            const data = JSON.parse(session);
            if (data.expiresAt > Date.now()) this.currentUser = data.user;
        }
    }

    bindEvents() {
        const form = document.getElementById('loginForm');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault(); // FIXED: Prevents page jump
                const data = new FormData(form);
                await this.login(data.get('email'), data.get('password'));
            });
        }
    }

    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
}
const portal = new CallHammerPortal();
