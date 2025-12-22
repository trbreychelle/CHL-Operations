// Call Hammer Leads - Robust Performance Engine
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

    // --- DATA FETCHING & FILTERING ---
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
                // CRITICAL: Refresh UI with the current filter
                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { console.error('Performance Sync Error:', error); }
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
            if (value === 'last-4-weeks') return diffDays <= 28;
            if (value === 'last-6-weeks') return diffDays <= 42;
            return true;
        });
        this.updateDashboardUI(this.filteredLeads);
    }

    // --- UI UPDATES ---
    updateDashboardUI(leads) {
        const total = leads.length;
        const cancelled = leads.filter(l => l.Status?.toLowerCase().includes('cancel')).length;
        const rate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
        const incentives = this.calculateIncentives(total, parseFloat(rate));

        document.getElementById('stat-appointments').textContent = total;
        document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        document.getElementById('stat-incentives').textContent = `$${incentives}`;
        if (document.getElementById('stat-hours')) {
            document.getElementById('stat-hours').textContent = this.currentUser.weeklyHours || '0';
        }

        const progressBar = document.getElementById('tier-progress-bar');
        const tierText = document.getElementById('tier-status-text');
        if (progressBar) {
            let nextGoal = total < 6 ? 6 : total < 8 ? 8 : total < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((total / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${total} / ${nextGoal} appointments`;
            if (tierText) {
                let tier = total >= 13 ? "Tier 4 (High Performance)" : total >= 9 ? "Tier 3" : total >= 8 ? "Tier 2" : total >= 1 ? "Tier 1" : "Base Only";
                tierText.textContent = `Current Status: ${tier}`;
            }
        }
        this.renderCharts(leads, parseFloat(rate));
        this.renderLeadsTable(leads);
    }

    calculateIncentives(n, c) {
        let total = 0;
        const isHighPerf = c < 25; 
        if (n >= 1) total += 50; 
        if (n >= 8) total += (isHighPerf ? 50 : 30);
        const t3 = Math.max(0, Math.min(n, 12) - 8);
        if (t3 > 0) total += t3 * (isHighPerf ? 17 : 15);
        const t4 = Math.max(0, n - 12);
        if (t4 > 0) total += t4 * (isHighPerf ? 27 : 25);
        return total;
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
                if (dIdx === -1) dIdx = 6; 
                if (dIdx >= 0 && dIdx <= 6) {
                    counts[dIdx]++;
                    if (!l.Status?.toLowerCase().includes('cancel')) {
                        earnings[dIdx] += (cancelRate < 25 ? 17 : 15);
                    }
                }
            }
        });

        echarts.init(apptDom).setOption({ xAxis: { type: 'category', data: days }, yAxis: { type: 'value', minInterval: 1 }, series: [{ data: counts, type: 'line', smooth: true, color: '#FF6B35' }] });
        echarts.init(incDom).setOption({ xAxis: { type: 'category', data: days }, yAxis: { type: 'value' }, series: [{ data: earnings, type: 'bar', color: '#FF6B35' }] });
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (body) body.innerHTML = leads.map(l => `
            <tr><td class="px-6 py-4 font-bold text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td><td class="px-6 py-4">${l['Date Submitted'] || 'N/A'}</td><td class="px-6 py-4 text-orange-600 font-bold">${l.Status || 'Pending'}</td><td class="px-6 py-4">${l.Address || 'N/A'}</td></tr>
        `).join('');
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const map = {
            'profileName': this.currentUser.name, 'profileEmail': this.currentUser.email,
            'profilePosition': this.currentUser.position || 'Agent', 'profileRate': `$${this.currentUser.baseRate || '10.00'}/hr`,
            'profileHours': `${this.currentUser.weeklyHours || '0'} hours`, 'profileStartDate': this.currentUser.startDate || 'N/A',
            'nav-user-name': this.currentUser.name
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    // --- RESTORED TIME OFF LOGIC ---
    async submitTimeOffRequest(data) {
        try {
            const response = await fetch(this.webhooks.timeOffRequest, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email, name: this.currentUser.name, ...data })
            });
            if (response.ok) { alert("Time-off request submitted successfully!"); return true; }
        } catch (err) { alert("Submission failed."); return false; }
    }

    async login(email, password) {
        if (this.isLoading) return;
        this.isLoading = true;
        try {
            const response = await fetch(this.webhooks.login, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            const result = await response.json();
            if (result.status === "success") {
                const userObj = { ...result.user, email: email }; // Captures email
                this.currentUser = userObj;
                localStorage.setItem('callHammerSession', JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 }));
                window.location.href = 'agent-dashboard.html';
            } else { alert(result.message); }
        } catch (err) { alert("Login failed: Network Error"); }
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
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = new FormData(loginForm);
                await this.login(data.get('email'), data.get('password'));
            });
        }

        const timeOffForm = document.getElementById('timeOffForm');
        if (timeOffForm) {
            timeOffForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(timeOffForm);
                const success = await this.submitTimeOffRequest({
                    startDate: formData.get('startDate'),
                    endDate: formData.get('endDate'),
                    reason: formData.get('reason')
                });
                if (success) { closeTimeOffModal(); timeOffForm.reset(); }
            });
        }
    }

    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
}
const portal = new CallHammerPortal();
