// Call Hammer Leads - Main Application Logic
// Integrated with n8n Localhost Production Webhook

class CallHammerPortal {
    constructor() {
        this.currentUser = null;
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
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            this.fetchAllData();
            this.updateProfileUI();
        }
    }

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

    updateDashboardUI(leads) {
        if (!this.currentUser) return;

        const nameHeader = document.getElementById('nav-user-name');
        if (nameHeader) nameHeader.textContent = this.currentUser.name;

        const totalAppointments = leads.length;
        const cancelledCount = leads.filter(l => 
            l.Status?.toLowerCase().includes('cancel') || 
            l.Status?.toLowerCase().includes('reject')
        ).length;
        
        const cancelRate = totalAppointments > 0 ? ((cancelledCount / totalAppointments) * 100).toFixed(1) : 0;
        const incentiveStats = this.calculateIncentives(totalAppointments, parseFloat(cancelRate));

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
            let nextGoal = totalAppointments < 6 ? 6 : totalAppointments < 8 ? 8 : totalAppointments < 12 ? 12 : 15;
            const percentage = Math.min((totalAppointments / nextGoal) * 100, 100);
            progressBar.style.width = `${percentage}%`;
            if (tierCountDisp) tierCountDisp.textContent = `${totalAppointments} / ${nextGoal} appointments`;

            if (tierStatusText) {
                let currentTier = "Base Rate Only";
                if (totalAppointments >= 13) currentTier = "Tier 4 (High Performance)";
                else if (totalAppointments >= 9) currentTier = "Tier 3 (Per Appointment)";
                else if (totalAppointments >= 8) currentTier = "Tier 2 (Volume Bonus)";
                else if (totalAppointments >= 1) currentTier = "Tier 1 (Starting Bonus)";
                tierStatusText.textContent = `Current Status: ${currentTier}`;
            }
        }

        this.renderCharts(leads);
        this.renderLeadsTable(leads);
    }

    calculateIncentives(n, c) {
        let total = 0;
        const highPerformance = c < 25;
        if (n >= 1) total += 50; 
        if (n >= 8) total += (highPerformance ? 50 : 30);
        const tier3Apts = Math.max(0, Math.min(n, 12) - 8);
        if (tier3Apts > 0) total += tier3Apts * (highPerformance ? 17 : 15);
        const tier4Apts = Math.max(0, n - 12);
        if (tier4Apts > 0) total += tier4Apts * (highPerformance ? 27 : 25);
        return { totalIncentives: total };
    }

    renderCharts(leads) {
        const apptDom = document.getElementById('appointmentsChart');
        const incDom = document.getElementById('incentivesChart');
        if (!apptDom || !incDom || typeof echarts === 'undefined') return;

        const apptChart = echarts.init(apptDom);
        const incChart = echarts.init(incDom);
        
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const apptCounts = [0, 0, 0, 0, 0];
        const dailyEarnings = [0, 0, 0, 0, 0];

        leads.forEach(lead => {
            const dateStr = lead['Appointment Date /Time'];
            if (dateStr) {
                const dayIndex = new Date(dateStr).getDay() - 1;
                if (dayIndex >= 0 && dayIndex <= 4) {
                    apptCounts[dayIndex]++;
                    if (!lead.Status?.toLowerCase().includes('cancel')) {
                        dailyEarnings[dayIndex] += 15; // Simplified daily visualization
                    }
                }
            }
        });

        apptChart.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value' },
            series: [{ data: apptCounts, type: 'line', smooth: true, color: '#FF6B35' }]
        });

        incChart.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: days },
            yAxis: { type: 'value' },
            series: [{ data: dailyEarnings, type: 'bar', color: '#FF6B35' }]
        });
    }

    renderLeadsTable(leads) {
        const tableBody = document.getElementById('leads-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = leads.map(lead => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${lead['Homeowner Name(s)'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${lead['Appointment Date /Time'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${lead.Status || 'Pending'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${lead.Address || 'N/A'}</td>
            </tr>
        `).join('');
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
                this.createSession(this.currentUser);
                window.location.href = 'agent-dashboard.html';
            } else {
                throw new Error(result.message || 'Invalid credentials');
            }
        } catch (error) {
            alert(error.message);
            this.setLoadingState(false);
        }
    }

    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            const sessionData = JSON.parse(session);
            if (sessionData.expiresAt > Date.now()) {
                this.currentUser = sessionData.user;
            } else {
                localStorage.removeItem('callHammerSession');
            }
        }
    }

    createSession(user) {
        const sessionData = { user: user, expiresAt: Date.now() + (24 * 60 * 60 * 1000) };
        localStorage.setItem('callHammerSession', JSON.stringify(sessionData));
    }

    logout() {
        localStorage.removeItem('callHammerSession');
        window.location.href = 'index.html';
    }

    setLoadingState(loading, text = 'Loading...') {
        this.isLoading = loading;
        const btn = document.getElementById('loginButton');
        if (btn) btn.disabled = loading;
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
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                this.login(formData.get('email'), formData.get('password'));
            });
        }
    }
}

let portal;
document.addEventListener('DOMContentLoaded', () => { portal = new CallHammerPortal(); });
