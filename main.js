// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.currentFilter = 'this-week';
        this.charts = null; 

        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook/agent-login',
            // IMPORTANT: Change this to Production URL once testing is done
            fetchData: 'https://automate.callhammerleads.com/webhook-test/fetch-agent-data',
            timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
            changePassword: 'https://automate.callhammerleads.com/webhook/change-password',
            manageEmployee: 'https://automate.callhammerleads.com/webhook/manage-employee'
        };
        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();

        if (this.currentUser && window.location.pathname.includes('dashboard')) {
            this.fetchAllData();
            this.updateProfileUI();
            
            // Handle Role-Based UI
            if (this.currentUser.role === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            }
        }
    }

    async fetchAllData() {
        if (!this.currentUser) return;
        try {
            const response = await fetch(this.webhooks.fetchData, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: this.currentUser.email,
                    name: this.currentUser.name,
                    role: this.currentUser.role // Added role to help n8n branching
                })
            });
            const result = await response.json();
            
            if (result.status === "success") {
                // Handle different data formats from n8n branches
                this.leadsData = result.leads || [];
                
                if (result.timeOffHistory) {
                    this.renderTimeOffHistory(result.timeOffHistory);
                }

                // If Admin, render the global employee list
                if (result.employeeList && this.currentUser.role === 'admin') {
                    this.renderEmployeeManagement(result.employeeList);
                }
                
                this.handleFilterChange(this.currentFilter); 
            }
        } catch (error) { 
            console.error('Data Sync Error:', error); 
        }
    }

    // --- ADMIN MANAGEMENT LOGIC ---
    renderEmployeeManagement(employees) {
        const container = document.getElementById('employee-list-body');
        if (!container) return;

        container.innerHTML = employees.map(emp => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 text-sm font-bold text-gray-900">${emp['Employee Name'] || 'N/A'}</td>
                <td class="px-6 py-4 text-sm text-gray-600">${emp.Email || 'N/A'}</td>
                <td class="px-6 py-4 text-sm font-medium uppercase">${emp.Role || 'Agent'}</td>
                <td class="px-6 py-4 text-sm">
                    <span class="px-2 py-1 rounded text-xs ${emp.Employment_Status === 'Offboarded' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">
                        ${emp.Employment_Status || 'Active'}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <button onclick="portal.offboardEmployee('${emp.Email}')" class="text-red-600 hover:text-red-900 text-xs font-bold">OFFBOARD</button>
                </td>
            </tr>
        `).join('');
    }

    async offboardEmployee(email) {
        if (!confirm(`Are you sure you want to offboard ${email}?`)) return;
        const res = await fetch(this.webhooks.manageEmployee, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'offboard', email: email })
        });
        if (res.ok) { alert('Employee Offboarded'); this.fetchAllData(); }
    }

    // Previous UI & Stat methods kept identical...
    handleFilterChange(value) { /* ... keep existing ... */ }
    updateDashboardUI(leads) { /* ... keep existing ... */ }
    renderLeadsTable(leads) { /* ... keep existing ... */ }
    renderTimeOffHistory(history) { /* ... keep existing ... */ }
    getStatusStyle(status) {
        const s = (status || '').toLowerCase();
        if (s.includes('approved')) return 'bg-green-100 text-green-700';
        if (s.includes('declined') || s.includes('reject')) return 'bg-red-100 text-red-700';
        return 'bg-yellow-100 text-yellow-700';
    }
    initCharts() { /* ... keep existing ... */ }
    updateCharts(leads) { /* ... keep existing ... */ }
    calculateIncentives(approvedN, cancelRate) { /* ... keep existing ... */ }

    // Fixed Profile Mapping to match your Google Sheet Headers
    updateProfileUI() {
        if (!this.currentUser) return;
        const u = this.currentUser;
        const map = {
            'profileName': u.name || u['Employee Name'] || 'N/A',
            'profileEmail': u.email || u.Email || 'N/A',
            'profilePosition': u.role || u.Role || 'N/A',
            'profileRate': this.formatCurrency(u.baseRate || u['Base Rate'] || 0),
            'profileHours': u['Weekly Hours'] || 'N/A',
            'profileStartDate': u['Start Date'] || 'N/A',
            'nav-user-name': u.name || u['Employee Name']
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }
    }

    async login(email, password) { /* ... keep existing ... */ }
    async submitTimeOffRequest(data) { /* ... keep existing ... */ }
    checkExistingSession() { /* ... keep existing ... */ }
    bindEvents() { /* ... keep existing ... */ }
    formatCurrency(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val); }
    logout() { localStorage.removeItem('callHammerSession'); window.location.href = 'index.html'; }
}

const portal = new CallHammerPortal();
window.portal = portal;
