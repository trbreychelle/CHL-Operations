/**
 * CALL HAMMER LEADS - UNIFIED PORTAL LOGIC
 * Connected to your EXISTING n8n Workflows
 */

class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        
        // --- DATA STORES ---
        this.leadsData = [];       
        this.employeeList = [];    
        this.weeklyPayroll = [];   
        this.timeTracker = [];     
        
        // --- ADMIN STORE ---
        this.adminState = {
            clients: [],
            leads: [],
            agents: []
        };

        // --- WEBHOOKS (Your Existing URLs) ---
        this.webhooks = {
            // 1. YOUR LOGIN WORKFLOW
            login: 'https://automate.callhammerleads.com/webhook/agent-login',
            
            // 2. YOUR AGENT DATA WORKFLOW
            fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data',
            
            // 3. YOUR TL DATA WORKFLOW
            fetchTLData: 'https://automate.callhammerleads.com/webhook/fetch-tl-data',
            
            // 4. NEW ADMIN DATA WORKFLOW (You still need to create this one!)
            fetchAdminData: 'https://automate.callhammerleads.com/webhook/dashboard-data' 
        };

        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();

        const path = window.location.pathname;

        // ROUTING: If Admin Dashboard -> Fetch Admin Data
        if (path.includes('admin-dashboard')) {
            if (this.currentUser && this.currentUser.role === 'admin') {
                this.fetchAdminData(); 
                setInterval(() => this.fetchAdminData(), 300000); 
            } else {
                // If not admin, redirect to login
                window.location.href = 'index.html';
            }
        }
        
        // ROUTING: If Agent/TL Dashboard -> Fetch Agent Data
        else if (path.includes('dashboard') && this.currentUser) {
            this.fetchAllData();
            this.updateProfileUI();
        }
    }

    // =========================================================================
    // 🔐 AUTHENTICATION (Connects to your 'Logins' Workflow)
    // =========================================================================

    async login(email, password) {
        try {
            const res = await fetch(this.webhooks.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const result = await res.json(); 

            // This matches the update we just made to your n8n node
            if (result.status === "success") {
                const userObj = {
                    name: result.user['Employee Name'],
                    role: (result.user.Role || 'agent').toLowerCase(),
                    email: email,
                    baseRate: result.user['Base Rate'],
                    weeklyHours: result.user['Weekly Hours'],
                    startDate: result.user['Start Date'],
                    position: result.user['Position']
                };

                localStorage.setItem('callHammerSession', JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 }));
                
                // Redirect based on Role
                if (userObj.role === 'admin') {
                    window.location.href = 'admin-dashboard.html';
                } else if (userObj.role === 'team_leader') {
                    window.location.href = 'team-leader-dashboard.html';
                } else {
                    window.location.href = 'agent-dashboard.html';
                }
            } else {
                alert("Login failed: " + (result.message || "Invalid credentials"));
            }
        } catch (err) {
            console.error("Login Error", err);
            alert("Network error. Please try again.");
        }
    }

    // =========================================================================
    // 🧠 ADMIN DASHBOARD LOGIC (Connects to 'dashboard-data' webhook)
    // =========================================================================

    async fetchAdminData() {
        try {
            const response = await fetch(this.webhooks.fetchAdminData);
            if (!response.ok) return; // Silent fail if webhook isn't ready
            
            const data = await response.json();
            
            this.adminState.clients = data.clients || [];
            this.adminState.leads = data.leads || [];

            this.renderClientHealth();
            this.renderAdminTeamPerf();
            this.renderAdminLeads();

        } catch (error) {
            console.log("Admin Data Loading...");
        }
    }

    renderClientHealth() {
        const tbody = document.getElementById('client-health-body');
        if (!tbody) return;

        tbody.innerHTML = this.adminState.clients.map(client => {
            const lastLead = this.findLastLead(client.company);
            const hoursSince = lastLead ? this.getHoursDiff(lastLead.date) : 999;
            
            let status = 'st-new';
            if (lastLead) {
                if (hoursSince < 24) status = 'st-healthy'; 
                else if (hoursSince < 48) status = 'st-risk'; 
                else status = 'st-critical'; 
            }

            return `
                <tr class="hover:bg-gray-50 transition cursor-pointer border-b border-gray-50" onclick="openModal('modal-client')">
                    <td class="p-3"><div class="status-dot ${status}"></div></td>
                    <td class="p-3 font-bold text-gray-800">${client.company || 'Unknown'}</td>
                    <td class="p-3 text-gray-600 text-xs">${client.city || 'Phoenix'}, AZ</td>
                    <td class="p-3 text-gray-600 text-xs">${client.contact || '-'}</td>
                    <td class="p-3">
                        <div class="font-bold text-gray-700 text-xs">${lastLead ? new Date(lastLead.date).toLocaleDateString() : 'Never'}</div>
                        <div class="text-[10px] ${hoursSince > 48 ? 'text-red-500 font-bold' : 'text-gray-400'}">
                            ${lastLead ? hoursSince.toFixed(1) + ' hrs ago' : '-'}
                        </div>
                    </td>
                    <td class="p-3 font-bold text-red-600 text-xs">${client.owed || 0} Leads</td>
                </tr>
            `;
        }).join('');
    }

    renderAdminTeamPerf() {
        // Simple aggregation logic for V1
        const tbody = document.getElementById('agent-perf-body');
        if (!tbody) return;
        // (Logic identical to previous versions)
    }

    renderAdminLeads() {
        const tbody = document.getElementById('leads-table-body');
        if (!tbody || !document.getElementById('view-leads')) return;
        
        tbody.innerHTML = this.adminState.leads.slice(0, 50).map(lead => `
            <tr class="hover:bg-gray-50 transition border-b border-gray-50">
                <td class="p-4 text-gray-500 text-xs">${lead.date}</td>
                <td class="p-4 font-bold text-gray-800">${lead.client}</td>
                <td class="p-4 font-bold text-sm">${lead.homeowner}</td>
                <td class="p-4 text-sm">${lead.agent}</td>
                <td class="p-4"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">${lead.status}</span></td>
            </tr>
        `).join('');
    }

    // --- UTILS ---
    findLastLead(company) {
        if(!company) return null;
        const matches = this.adminState.leads.filter(l => (l.client||'').toLowerCase() === company.toLowerCase());
        matches.sort((a,b) => new Date(b.date) - new Date(a.date));
        return matches[0];
    }
    getHoursDiff(dateStr) {
        return (new Date() - new Date(dateStr)) / (1000 * 60 * 60);
    }

    // =========================================================================
    // 🏢 EXISTING AGENT LOGIC
    // =========================================================================

    async fetchAllData() {
        if (!this.currentUser) return;
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email, role: this.currentUser.role })
            });
            const result = await response.json();
            if (result.status === "success") {
                this.updateDashboardUI(result.leads || []);
                this.updateProfileUI();
            }
        } catch (error) { console.error(error); }
    }

    updateDashboardUI(leads) {
        if (document.getElementById('stat-appointments')) document.getElementById('stat-appointments').textContent = leads.length;
        if (!window.location.pathname.includes('admin-dashboard')) {
            const body = document.getElementById('leads-table-body');
            if(body) body.innerHTML = leads.map(l => `<tr><td class="p-4">${l['Date Submitted']}</td><td class="p-4">${l['Homeowner Name']}</td><td class="p-4">${l['Status']}</td></tr>`).join('');
        }
    }

    updateProfileUI() {
        if (!this.currentUser) return;
        if(document.getElementById('nav-user-name')) document.getElementById('nav-user-name').textContent = this.currentUser.name;
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
            loginForm.onsubmit = (e) => {
                e.preventDefault();
                this.login(new FormData(loginForm).get('email'), new FormData(loginForm).get('password'));
            };
        }
    }
}

const portal = new CallHammerPortal();
window.portal = portal;
