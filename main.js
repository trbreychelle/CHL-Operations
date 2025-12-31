// Call Hammer Leads - Unified Application Logic (Agent & Admin)
class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.leadsData = [];
        this.filteredLeads = [];
        this.isLoading = false;
        this.currentFilter = 'this-week';
        
        // FINAL PRODUCTION WEBHOOKS (Replaced localhost with live domain)
        this.webhooks = {
            login: 'https://automate.callhammerleads.com/webhook/agent-login', 
            fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data', 
            fetchAdminData: 'https://automate.callhammerleads.com/webhook/fetch-admin-dashboard',
            timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
            changePassword: 'https://automate.callhammerleads.com/webhook/change-password'
        };
        this.init();
    }
    
    // ... rest of your existing logic ...

    // ADD THIS METHOD to enable the password updates we discussed
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
}

const portal = new CallHammerPortal();
