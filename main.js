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

    // --- UI RENDERING ENGINE ---
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
        
        // Use the NEW updated incentive engine
        const incentiveStats = this.calculateIncentives(totalAppointments, parseFloat(cancelRate));

        const apptCount = document.getElementById('stat-appointments');
        const cancelRateDisp = document.getElementById('stat-cancel-rate');
        const incentiveDisp = document.getElementById('stat-incentives');
        
        if (apptCount) apptCount.textContent = totalAppointments;
        if (cancelRateDisp) cancelRateDisp.textContent = `${cancelRate}%`;
        if (incentiveDisp) incentiveDisp.textContent = `$${incentiveStats.totalIncentives.toLocaleString()}`;

        // Update Progress Bar & Tier Text
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

    // --- UPDATED INCENTIVE ENGINE ---
    calculateIncentives(n, c) {
        let total = 0;
        const highPerformance = c < 25; // Bonus logic for < 25% cancellation

        // 1. First 1-6 appointments: $50 flat base incentive
        if (n >= 1) total += 50;

        // 2. 8th appointment: $30 base (Standard) or $50 base (High Performance)
        if (n >= 8) total += (highPerformance ? 50 : 30);

        // 3. 9th-12th appointments: $15 each (Standard) or $17 each (High Performance)
        const tier3Apts = Math.max(0, Math.min(n, 12) - 8);
        if (tier3Apts > 0) total += tier3Apts * (highPerformance ? 17 : 15);

        // 4. 13th+ appointments: $25 each (Standard) or $27 each (High Performance)
        const tier4Apts = Math.max(0, n - 12);
        if (tier4Apts > 0) total += tier4Apts * (highPerformance ? 27 : 25);

        return { totalIncentives: total };
    }

    // Remaining render and auth functions stay the same...
    renderCharts(leads) { /* Logic from previous update */ }
    renderLeadsTable(leads) { /* Logic from previous update */ }
    updateProfileUI() { /* Logic from previous update */ }
    checkExistingSession() { /* Logic from previous update */ }
    createSession(user) { /* Logic from previous update */ }
    isValidSession(sessionData) { return sessionData && sessionData.expiresAt > Date.now(); }
    redirectToDashboard() { if (!this.currentUser) return; window.location.href = 'agent-dashboard.html'; }
    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
    setLoadingState(loading, text = 'Loading...') { /* Logic from previous update */ }
    showError(message) { /* Logic from previous update */ }
    showSuccess(message) { /* Logic from previous update */ }
    bindEvents() { /* Logic from previous update */ }
}

let portal;
document.addEventListener('DOMContentLoaded', () => { portal = new CallHammerPortal(); });
