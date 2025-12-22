// Call Hammer Leads - Main Application Logic
// Updated to count leads by "Date Submitted" column

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
                return result;
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

        // 1. Calculations based on total leads submitted
        const total = leads.length;
        const cancelled = leads.filter(l => 
            l.Status?.toLowerCase().includes('cancel') || 
            l.Status?.toLowerCase().includes('reject')
        ).length;
        const rate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
        
        const incentiveStats = this.calculateIncentives(total, parseFloat(rate));

        // 2. Update Stat Cards
        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = total;
        if (document.getElementById('stat-cancel-rate')) document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        if (document.getElementById('stat-incentives')) document.getElementById('stat-incentives').textContent = `$${incentiveStats.totalIncentives}`;

        // 3. Progress Bar & Tier Logic
        const progressBar = document.getElementById('tier-progress-bar');
        const tierStatusText = document.getElementById('tier-status-text');
        if (progressBar) {
            let nextGoal = total < 6 ? 6 : total < 8 ? 8 : total < 12 ? 12 : 15;
            progressBar.style.width = `${Math.min((total / nextGoal) * 100, 100)}%`;
            document.getElementById('tier-count-display').textContent = `${total} / ${nextGoal} appointments`;

            if (tierStatusText) {
                let tier = "Base Only";
                if (total >= 13) tier = "Tier 4 (High Performance)";
                else if (total >= 9) tier = "Tier 3";
                else if (total >= 8) tier = "Tier 2";
                else if (total >= 1) tier = "Tier 1";
                tierStatusText.textContent = `Current: ${tier}`;
            }
        }

        this.renderCharts(leads, parseFloat(rate));
        this.renderLeadsTable(leads);
    }

    // --- REVISED INCENTIVE ENGINE ---
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

    // --- CHART RENDERER (Counts by "Date Submitted") ---
    renderCharts(leads, cancelRate) {
        const apptDom = document.getElementById('appointmentsChart');
        const incDom = document.getElementById('incentivesChart');
        if (!apptDom || !incDom || typeof echarts === 'undefined') return;

        const apptChart = echarts.init(apptDom);
        const incChart = echarts.init(incDom);
        
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const counts = [0, 0, 0, 0, 0];
        const earnings = [0, 0, 0, 0, 0];

        leads.forEach(l => {
            // FIXED: Using "Date Submitted" column for tracking
            const dateStr = l['Date Submitted'] || l['Appointment Date /Time']; 
            if (dateStr) {
                const dateObj = new Date(dateStr);
                const dayIndex = dateObj.getDay() - 1; // Mon=0, Fri=4
                
                if (dayIndex >= 0 && dayIndex <= 4) {
                    counts[dayIndex]++;
                    const status = l.Status?.toLowerCase() || '';
                    if (!status.includes('cancel')) {
                        // Visualizing average daily performance earnings
                        earnings[dayIndex] += (cancelRate < 25 ? 17 : 15); 
                    }
                }
            }
        });

        apptChart.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{ data: counts, type: 'line', smooth: true, color: '#FF6B35', areaStyle: { opacity: 0.1 } }]
        });

        incChart.setOption({
            tooltip: { trigger: 'axis', formatter: '{b}: ${c}' },
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value' },
            series: [{ data: earnings, type: 'bar', color: '#FF6B35', itemStyle: { borderRadius: [4,4,0,0] } }]
        });
    }

    renderLeadsTable(leads) {
        const body = document.getElementById('leads-table-body');
        if (body) body.innerHTML = leads.map(l => `
            <tr>
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${l['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${l['Date Submitted'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm font-bold text-orange-600">${l.Status || 'Pending'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${l.Address || 'N/A'}</td>
            </tr>
        `).join('');
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        const fields = { 
            'profileName': this.currentUser.name, 
            'profileEmail': this.currentUser.email,
            'profilePosition': this.currentUser.position || 'Sales Agent',
            'profileRate': `$${this.currentUser.baseRate || '15.00'}/hour`,
            'profileHours': `${this.currentUser.weeklyHours || '40'} hours`,
            'profileStartDate': this.currentUser.startDate || 'Not Set',
            'nav-user-name': this.currentUser.name,
            'nav-user-role': this.currentUser.position || 'Agent'
        };
        for (const [id, val] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
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
