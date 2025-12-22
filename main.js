// Call Hammer Leads - Main Application Logic
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
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            this.fetchAllData();
            this.updateProfileUI();
        }
    }

    // --- DATA FETCHING ---
    async fetchAllData() {
        if (!this.currentUser) return;
        this.setLoadingState(true, 'Syncing performance data...');
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.leadsData = result.leads || [];
                this.applyDateFilter(this.currentFilter); // Initial Filter
            }
        } catch (error) {
            console.error('Fetch error:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    // --- DATE FILTERING SYSTEM ---
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
                const day = startOfDay.getDay(); // 0 is Sunday
                const diff = startOfDay.getDate() - day + (day == 0 ? -6 : 1); 
                const monday = new Date(startOfDay.setDate(diff));
                return submittedDate >= monday;
            }
            if (filterType === 'last-30-days') return diffDays <= 30;
            if (filterType === 'last-4-weeks') return diffDays <= 28;
            if (filterType === 'last-6-weeks') return diffDays <= 42;
            return true;
        });

        this.updateDashboardUI(this.filteredLeads);
    }

    // --- UI RENDERING ---
    updateDashboardUI(leads) {
        const total = leads.length;
        const cancelled = leads.filter(l => l.Status?.toLowerCase().includes('cancel')).length;
        const rate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
        const incentiveStats = this.calculateIncentives(total, parseFloat(rate));

        document.getElementById('stat-appointments').textContent = total;
        document.getElementById('stat-cancel-rate').textContent = `${rate}%`;
        document.getElementById('stat-incentives').textContent = `$${incentiveStats.totalIncentives}`;

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

    // --- UPDATED CHART: MON-SUN SUPPORT ---
    renderCharts(leads, cancelRate) {
        const apptDom = document.getElementById('appointmentsChart');
        const incDom = document.getElementById('incentivesChart');
        if (!apptDom || !incDom || typeof echarts === 'undefined') return;

        const apptChart = echarts.init(apptDom);
        const incChart = echarts.init(incDom);
        
        // Full week labels
        const daysLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const counts = [0, 0, 0, 0, 0, 0, 0];
        const earnings = [0, 0, 0, 0, 0, 0, 0];

        leads.forEach(l => {
            const dateStr = l['Date Submitted'] || l['Appointment Date /Time'];
            if (dateStr) {
                const dateObj = new Date(dateStr);
                // Adjust getDay() so Mon=0 and Sun=6
                let dayIndex = dateObj.getDay() - 1;
                if (dayIndex === -1) dayIndex = 6; 
                
                if (dayIndex >= 0 && dayIndex <= 6) {
                    counts[dayIndex]++;
                    const status = l.Status?.toLowerCase() || '';
                    if (!status.includes('cancel')) {
                        earnings[dayIndex] += (cancelRate < 25 ? 17 : 15); 
                    }
                }
            }
        });

        apptChart.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: daysLabel },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{ data: counts, type: 'line', smooth: true, color: '#FF6B35', areaStyle: { opacity: 0.1 } }]
        });

        incChart.setOption({
            tooltip: { trigger: 'axis', formatter: '{b}: ${c}' },
            xAxis: { type: 'category', data: daysLabel },
            yAxis: { type: 'value' },
            series: [{ data: earnings, type: 'bar', color: '#FF6B35' }]
        });
    }

    // Leads Table, Auth, and Profile UI logic remain the same...
    renderLeadsTable(leads) { /* Same as previous version */ }
    updateProfileUI() { /* Same as previous version */ }
    checkExistingSession() { /* Same as previous version */ }
    bindEvents() { /* Same as previous version */ }
    setLoadingState(l, t) { /* Same as previous version */ }
    logout() { localStorage.removeItem('callHammerSession'); window.location.href='index.html'; }
}
const portal = new CallHammerPortal();
