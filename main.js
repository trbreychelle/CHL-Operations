// Call Hammer Leads - Unified Application Logic (Agent & Admin)
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.isLoading = false;
        this.currentFilter = 'this-week';
        
        // FINAL PRODUCTION WEBHOOKS
        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook/agent-login', 
            fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data', 
            fetchAdminData: 'https://automate.callhammerleads.com/webhook/fetch-admin-dashboard',
            timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
            changePassword: 'https://automate.callhammerleads.com/webhook/change-password'
        };
        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();
        
        if (this.currentUser && (window.location.pathname.includes('dashboard'))) {
            if (this.currentUser.role !== 'admin') {
                this.fetchAllData();
            }
        }
    }

    // --- NEW: Password Update Logic ---
    async updatePassword(newPassword) {
        if (!this.currentUser) return alert("You must be logged in to change your password.");
        
        try {
            const response = await fetch(this.webhooks.changePassword, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: this.currentUser.email, 
                    newPassword: newPassword 
                })
            });
            const result = await response.json();
            if (result.status === "success") {
                alert("Password updated successfully!");
                return true;
            }
            throw new Error(result.message || "Update failed");
        } catch (error) {
            console.error('Password Update Error:', error);
            alert("Failed to update password.");
            return false;
        }
    }

    // --- AUTHENTICATION & DATA ---
    async login(email, password) {
        try {
            const response = await fetch(this.webhooks.login, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ email, password }) 
            });
            const result = await response.json();
            if (result.status === "success") {
                const userObj = { ...result.user, email: email };
                this.currentUser = userObj;
                localStorage.setItem('callHammerSession', JSON.stringify({ 
                    user: userObj, 
                    expiresAt: Date.now() + 86400000 
                }));
                window.location.href = userObj.role === 'admin' ? 'admin-dashboard.html' : 'agent-dashboard.html';
            } else {
                alert("Login failed: " + (result.message || "Invalid credentials"));
            }
        } catch (err) { 
            alert("Connection error. Ensure your n8n workflows are ACTIVE."); 
        }
    }

    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            const data = JSON.parse(session);
            if (data.expiresAt > Date.now()) {
                this.currentUser = data.user;
            } else {
                this.logout();
            }
        }
    }

    logout() { 
        localStorage.removeItem('callHammerSession'); 
        window.location.href = 'index.html'; 
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
    }
}

const portal = new CallHammerPortal();
