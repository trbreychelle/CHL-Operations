// Call Hammer Leads - Main Application Logic
// Comprehensive Operations & Payroll Portal System

class CallHammerPortal {
    constructor() {
        this.currentUser = null;
        this.sessionData = null;
        this.agentsData = [];
        this.leadsData = [];
        this.isLoading = false;
        
        // n8n Webhook URLs (Replace with actual production URLs)
        this.webhooks = {
            fetchData: 'http://localhost:5678/webhook/agent-login',
            addEmployee: 'http://localhost:5678/webhook/f8588932-bb8f-4f81-8da5-2bd205b9169f',
            timeOffRequest: 'http://localhost:5678/webhook/f8588932-bb8f-4f81-8da5-2bd205b9169f',
            updatePerformance: 'https://your-n8n-instance.com/webhook/update-performance'
        };

        this.init();
    }

    init() {
        this.checkExistingSession();
        this.bindEvents();
        this.initializeAnimations();
    }

    // Authentication System
    checkExistingSession() {
        const session = localStorage.getItem('callHammerSession');
        if (session) {
            try {
                const sessionData = JSON.parse(session);
                if (this.isValidSession(sessionData)) {
                    this.currentUser = sessionData.user;
                    this.redirectToDashboard();
                }
            } catch (error) {
                console.error('Invalid session data:', error);
                localStorage.removeItem('callHammerSession');
            }
        }
    }

    async login(email, password) {
        if (this.isLoading) return;
        
        this.setLoadingState(true, 'Signing in...');
        
        try {
            // Simulate authentication (replace with actual API call)
            const user = await this.authenticateUser(email, password);
            
            if (user) {
                this.currentUser = user;
                this.createSession(user);
                this.showSuccess('Login successful! Redirecting...');
                
                setTimeout(() => {
                    this.redirectToDashboard();
                }, 1000);
            } else {
                throw new Error('Invalid email or password');
            }
        } catch (error) {
            this.showError(error.message || 'Login failed. Please try again.');
            this.setLoadingState(false);
        }
    }

    async authenticateUser(email, password) {
        // Mock authentication - replace with actual API call
        const mockUsers = [
            { id: 'admin_001', email: 'admin@callhammer.com', password: 'admin123', role: 'admin', name: 'Sarah Johnson' },
            { id: 'agent_001', email: 'agent1@callhammer.com', password: 'agent123', role: 'agent', name: 'John Smith' },
            { id: 'agent_002', email: 'agent2@callhammer.com', password: 'agent123', role: 'agent', name: 'Jane Doe' }
        ];

        const user = mockUsers.find(u => u.email === email && u.password === password);
        
        if (user) {
            // Remove password from returned user object
            const { password, ...userData } = user;
            
            // Simulate fetching additional user data
            if (user.role === 'agent') {
                userData.profile = await this.getAgentProfile(user.id);
            } else {
                userData.permissions = ['view_all_data', 'add_employees', 'process_payroll'];
            }
            
            return userData;
        }
        
        return null;
    }

    async getAgentProfile(agentId) {
        // Mock agent profile data
        return {
            baseRate: 15.00,
            weeklyHours: 40,
            startDate: '2024-01-15',
            position: 'Sales Agent',
            totalAppointments: 127,
            cancellationRate: 18.5,
            totalIncentives: 2840.00,
            tierProgress: {
                currentTier: 3,
                nextMilestone: 150,
                progressPercent: 84.7
            }
        };
    }

    createSession(user) {
        const sessionData = {
            user: user,
            timestamp: Date.now(),
            expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
        };
        
        localStorage.setItem('callHammerSession', JSON.stringify(sessionData));
        this.sessionData = sessionData;
    }

    isValidSession(sessionData) {
        return sessionData && sessionData.expiresAt > Date.now();
    }

    redirectToDashboard() {
        if (!this.currentUser) return;
        
        const dashboardUrl = this.currentUser.role === 'admin' 
            ? 'admin-dashboard.html' 
            : 'agent-dashboard.html';
            
        window.location.href = dashboardUrl;
    }

    logout() {
        localStorage.removeItem('callHammerSession');
        this.currentUser = null;
        this.sessionData = null;
        window.location.href = 'index.html';
    }

    // Incentive Calculation Engine
    calculateIncentives(appointmentCount, cancellationRate) {
        const n = parseInt(appointmentCount) || 0;
        const c = parseFloat(cancellationRate) || 0;
        let totalIncentives = 0;
        let tierBreakdown = [];

        // Tier 1: 1-6 leads - $50 each
        const tier1Count = Math.min(n, 6);
        if (tier1Count > 0) {
            const tier1Total = tier1Count * 50;
            totalIncentives += tier1Total;
            tierBreakdown.push({
                tier: 1,
                count: tier1Count,
                rate: 50,
                total: tier1Total,
                description: '1-6 leads'
            });
        }

        // Tier 2: 8th lead - Special bonus
        if (n >= 8) {
            const tier2Rate = c < 25 ? 50 : 30;
            const tier2Total = tier2Rate;
            totalIncentives += tier2Total;
            tierBreakdown.push({
                tier: 2,
                count: 1,
                rate: tier2Rate,
                total: tier2Total,
                description: `8th lead (${c < 25 ? 'low cancellation bonus' : 'standard'})`
            });
        }

        // Tier 3: 9-12 leads
        const tier3Count = Math.max(0, Math.min(n - 8, 4));
        if (tier3Count > 0) {
            const tier3Rate = c < 25 ? 17 : 15;
            const tier3Total = tier3Count * tier3Rate;
            totalIncentives += tier3Total;
            tierBreakdown.push({
                tier: 3,
                count: tier3Count,
                rate: tier3Rate,
                total: tier3Total,
                description: `9-12 leads (${c < 25 ? 'low cancellation' : 'standard'})`
            });
        }

        // Tier 4: 13+ leads
        const tier4Count = Math.max(0, n - 12);
        if (tier4Count > 0) {
            const tier4Rate = c < 25 ? 27 : 25;
            const tier4Total = tier4Count * tier4Rate;
            totalIncentives += tier4Total;
            tierBreakdown.push({
                tier: 4,
                count: tier4Count,
                rate: tier4Rate,
                total: tier4Total,
                description: `13+ leads (${c < 25 ? 'low cancellation' : 'standard'})`
            });
        }

        return {
            totalIncentives,
            tierBreakdown,
            appointmentCount: n,
            cancellationRate: c
        };
    }

    // Data Management
    async fetchAllData() {
        try {
            this.setLoadingState(true, 'Loading data...');
            
            // Simulate API call - replace with actual webhook
            const response = await fetch(this.webhooks.fetchData, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionData?.user?.id || ''}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.agentsData = data.agents || [];
                this.leadsData = data.leads || [];
                return data;
            } else {
                // Return mock data for demonstration
                return this.getMockData();
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            return this.getMockData();
        } finally {
            this.setLoadingState(false);
        }
    }

    getMockData() {
        // Mock data for demonstration
        return {
            agents: [
                {
                    id: 'agent_001',
                    name: 'John Smith',
                    email: 'john@callhammer.com',
                    baseRate: 15.00,
                    weeklyHours: 40,
                    totalAppointments: 127,
                    cancellationRate: 18.5,
                    startDate: '2024-01-15',
                    position: 'Sales Agent'
                },
                {
                    id: 'agent_002',
                    name: 'Jane Doe',
                    email: 'jane@callhammer.com',
                    baseRate: 16.00,
                    weeklyHours: 40,
                    totalAppointments: 89,
                    cancellationRate: 22.3,
                    startDate: '2024-02-01',
                    position: 'Senior Sales Agent'
                }
            ],
            leads: [
                // Mock leads data
            ]
        };
    }

    async postToWebhook(endpoint, data) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionData?.user?.id || ''}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Webhook error:', error);
            throw error;
        }
    }

    // Form Handling
    async submitTimeOffRequest(formData) {
        try {
            const requestData = {
                agentId: this.currentUser.id,
                agentName: this.currentUser.name,
                startDate: formData.startDate,
                endDate: formData.endDate,
                reason: formData.reason,
                status: 'pending',
                submittedAt: new Date().toISOString()
            };

            const result = await this.postToWebhook(this.webhooks.timeOffRequest, requestData);
            this.showSuccess('Time-off request submitted successfully!');
            return result;
        } catch (error) {
            this.showError('Failed to submit time-off request. Please try again.');
            throw error;
        }
    }

    async addNewEmployee(employeeData) {
        try {
            const result = await this.postToWebhook(this.webhooks.addEmployee, employeeData);
            this.showSuccess('Employee added successfully!');
            return result;
        } catch (error) {
            this.showError('Failed to add employee. Please try again.');
            throw error;
        }
    }

    // UI Helper Methods
    setLoadingState(loading, text = 'Loading...') {
        this.isLoading = loading;
        const loginButton = document.getElementById('loginButton');
        const loginText = document.getElementById('loginText');
        const loginSpinner = document.getElementById('loginSpinner');

        if (loginButton && loginText && loginSpinner) {
            if (loading) {
                loginButton.disabled = true;
                loginButton.classList.add('opacity-75');
                loginText.textContent = text;
                loginSpinner.classList.remove('hidden');
            } else {
                loginButton.disabled = false;
                loginButton.classList.remove('opacity-75');
                loginText.textContent = 'Sign In';
                loginSpinner.classList.add('hidden');
            }
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
            errorDiv.querySelector('p').textContent = message;
            errorDiv.classList.remove('hidden');
            errorDiv.classList.add('error-shake');
            
            setTimeout(() => {
                errorDiv.classList.remove('error-shake');
            }, 500);
        }
    }

    showSuccess(message) {
        // Create a temporary success notification
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    bindEvents() {
        // Login form submission
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const email = formData.get('email');
                const password = formData.get('password');
                
                this.login(email, password);
            });
        }

        // Clear error on input focus
        const inputs = document.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('focus', () => {
                const errorDiv = document.getElementById('loginError');
                if (errorDiv) {
                    errorDiv.classList.add('hidden');
                }
            });
        });
    }

    initializeAnimations() {
        // Initialize page animations using Anime.js
        if (typeof anime !== 'undefined') {
            // Animate cards on scroll
            const cards = document.querySelectorAll('.card-hover');
            if (cards.length > 0) {
                anime({
                    targets: cards,
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(100),
                    duration: 600,
                    easing: 'easeOutQuart'
                });
            }
        }
    }

    // Utility Methods
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    }

    formatDate(date) {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }).format(new Date(date));
    }

    calculateBasePay(hourlyRate, hoursWorked) {
        return hourlyRate * hoursWorked;
    }

    getTimeFrameDates(timeFrame) {
        const now = new Date();
        let startDate, endDate;

        switch (timeFrame) {
            case 'current_week':
                startDate = new Date(now.setDate(now.getDate() - now.getDay()));
                endDate = new Date();
                break;
            case 'last_30_days':
                startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
                endDate = new Date();
                break;
            case 'last_4_weeks':
                startDate = new Date(now.getTime() - (28 * 24 * 60 * 60 * 1000));
                endDate = new Date();
                break;
            case 'last_6_weeks':
                startDate = new Date(now.getTime() - (42 * 24 * 60 * 60 * 1000));
                endDate = new Date();
                break;
            default:
                startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
                endDate = new Date();
        }

        return { startDate, endDate };
    }
}

// Initialize the portal when DOM is loaded
let portal;
document.addEventListener('DOMContentLoaded', function() {
    portal = new CallHammerPortal();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CallHammerPortal;
}
