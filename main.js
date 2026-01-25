/**
 * CALL HAMMER LEADS - MAIN PORTAL LOGIC (CLEAN + ALIGNED)
 * - Works with your existing dashboards (Agent / Team Leader / Admin)
 * - Works with your n8n workflows shown in your screenshots
 */

class CallHammerPortal {
  constructor() {
    this.currentUser = null;

    // Shared stores used by dashboards
    this.leadsData = [];
    this.filteredLeads = [];
    this.employeeList = [];
    this.timeOffHistory = [];

    // Charts holder (some dashboards call portal.charts?.xxx?.resize())
    this.charts = {};

    // ✅ Your real webhooks
    this.webhooks = {
      login: "https://automate.callhammerleads.com/webhook/agent-login",
      fetchData: "https://automate.callhammerleads.com/webhook/fetch-agent-data",

      // IMPORTANT: Replace this with the Production URL from your “CHL Admin Backend” workflow webhook node
      fetchAdminData: "https://automate.callhammerleads.com/webhook/dashboard-data"
    };

    this.init();
  }

  // =========================================================
  // INIT + ROUTING
  // =========================================================
  init() {
    this.checkExistingSession();
    this.bindEvents();

    const path = (window.location.pathname || "").toLowerCase();

    // If on admin dashboard
    if (path.includes("admin-dashboard")) {
      if (this.currentUser && this.currentUser.role === "admin") {
        this.fetchAdminData();
        setInterval(() => this.fetchAdminData(), 300000); // every 5 mins
      } else {
        window.location.href = "index.html";
      }
      return;
    }

    // If on agent or team leader dashboards
    if (
      (path.includes("agent-dashboard") || path.includes("team-leader-dashboard")) &&
      this.currentUser
    ) {
      this.fetchAllData();
      this.updateNavUI();
      return;
    }
  }

  // =========================================================
  // AUTH
  // =========================================================
  async login(email, password) {
    try {
      const res = await fetch(this.webhooks.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const result = await res.json();

      // ✅ Accept both shapes: {status:"success"} OR {success:true}
      const ok =
        result?.status === "success" ||
        result?.success === true ||
        result?.ok === true;

      if (!ok) {
        alert("Login failed: " + (result?.message || "Invalid credentials"));
        return;
      }

      // ✅ Accept either result.user or result.data.user, etc.
      const u = result.user || result.data?.user || result.data || {};

      // Normalize role naming
      let role = (u.Role || u.role || "agent").toString().toLowerCase();
      if (role === "team leader") role = "team_leader";
      if (role === "teamlead") role = "team_leader";
      if (role === "team-leader") role = "team_leader";

      const userObj = {
        name: u["Employee Name"] || u.name || "User",
        role: role,
        email: u.Email || u.email || email,
        managerEmail: u["Manager_Email"] || u.managerEmail || "",
        baseRate: u["Base Rate"] || u.baseRate || "",
        weeklyHours: u["Weekly Hours"] || u.weeklyHours || "",
        startDate: u["Start Date"] || u.startDate || "",
        position: u["Position"] || u.position || ""
      };

      localStorage.setItem(
        "callHammerSession",
        JSON.stringify({ user: userObj, expiresAt: Date.now() + 86400000 })
      );

      // Redirect based on role
      if (userObj.role === "admin") {
        window.location.href = "admin-dashboard.html";
      } else if (userObj.role === "team_leader") {
        window.location.href = "team-leader-dashboard.html";
      } else {
        window.location.href = "agent-dashboard.html";
      }
    } catch (err) {
      console.error("Login Error", err);
      alert("Network error. Please try again.");
    }
  }

  logout() {
    localStorage.removeItem("callHammerSession");
    window.location.href = "index.html";
  }

  checkExistingSession() {
    const session = localStorage.getItem("callHammerSession");
    if (!session) return;

    try {
      const data = JSON.parse(session);
      if (data.expiresAt > Date.now()) {
        this.currentUser = data.user;
      } else {
        localStorage.removeItem("callHammerSession");
      }
    } catch (e) {
      localStorage.removeItem("callHammerSession");
    }
  }

  // =========================================================
  // FETCH (AGENT + TL)
  // =========================================================
  async fetchAllData() {
    if (!this.currentUser) return;

    try {
      const response = await fetch(this.webhooks.fetchData, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.currentUser.email,
          role: this.currentUser.role
        })
      });

      const result = await response.json();

      const ok =
        result?.status === "success" ||
        result?.success === true ||
        result?.ok === true;

      if (!ok) {
        console.warn("fetchAllData failed:", result);
        return;
      }

      // pull from multiple possible keys
      const leads = result.leads || result.leadsData || result.data?.leads || [];
      const employees = result.employees || result.employeeList || result.data?.employees || [];
      const timeOff = result.timeOffHistory || result.timeoff || result.data?.timeOffHistory || [];

      // Normalize leads for ALL dashboards
      this.leadsData = this.normalizeLeads(leads);
      this.filteredLeads = this.leadsData; // default
      this.employeeList = Array.isArray(employees) ? employees : [];
      this.timeOffHistory = Array.isArray(timeOff) ? timeOff : [];

      // Render UI depending on page
      this.updateAgentOrTLUI();
    } catch (error) {
      console.error("fetchAllData error:", error);
    }
  }

  normalizeLeads(leads) {
    if (!Array.isArray(leads)) return [];

    return leads.map((l) => {
      // Handle both “nice keys” and weird keys safely
      const status = l["Status"] || l.status || "";
      const dateSubmitted = l["Date Submitted"] || l.dateSubmitted || l.date || "";
      const homeowner = l["Homeowner Name"] || l.homeowner || l["Homeowner Name(s)"] || "";
      const agent =
        l.Agent ||
        l.agent ||
        l["Appointment Coordinator Name"] ||
        l["Appointment Coordinator"] ||
        l["Agent Name"] ||
        "";

      // Return same object but guaranteed keys exist
      return {
        ...l,
        Agent: agent,
        Status: status,
        "Date Submitted": dateSubmitted,
        "Homeowner Name": homeowner
      };
    });
  }

  updateAgentOrTLUI() {
    // Update common stats if present
    const statAppointments = document.getElementById("stat-appointments");
    if (statAppointments) statAppointments.textContent = this.leadsData.length;

    // Update nav user display
    this.updateNavUI();

    // If table exists, render leads table
    if (typeof this.renderLeadsTable === "function") {
      this.renderLeadsTable(this.leadsData);
    } else {
      // basic fallback
      const body = document.getElementById("leads-table-body");
      if (body) {
        body.innerHTML = this.leadsData
          .map(
            (l) =>
              `<tr>
                <td class="px-6 py-4 text-sm text-gray-600">${l["Date Submitted"] || ""}</td>
                <td class="px-6 py-4 text-sm font-bold text-gray-900">${l["Homeowner Name"] || ""}</td>
                <td class="px-6 py-4 text-sm text-gray-600">${l["Status"] || ""}</td>
              </tr>`
          )
          .join("");
      }
    }

    // If TL dashboard has its own refresh hook, call it
    if (window.teamLeadDashboard && typeof window.teamLeadDashboard.refresh === "function") {
      window.teamLeadDashboard.refresh();
    }
  }

  // =========================================================
  // ADMIN FETCH
  // =========================================================
  async fetchAdminData() {
    try {
      const response = await fetch(this.webhooks.fetchAdminData, { method: "GET" });
      if (!response.ok) return;

      const result = await response.json();
      // Expecting {clients:[], leads:[], agents:[]} or similar
      // Store them where admin dashboard code can use them:
      this.adminState = {
        clients: result.clients || [],
        leads: result.leads || [],
        agents: result.agents || []
      };

      // If your admin dashboard uses window.adminDashboard.refreshDashboard(),
      // then set portal.leadsData and portal.employeeList to keep it working:
      this.leadsData = this.normalizeLeads(this.adminState.leads || []);
      this.employeeList = this.adminState.agents || this.employeeList;

      if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === "function") {
        window.adminDashboard.refreshDashboard();
      }
    } catch (e) {
      console.warn("Admin data loading...");
    }
  }

  // =========================================================
  // HELPERS used by dashboards
  // =========================================================
  renderLeadsTable(leads) {
    const tbody = document.getElementById("leads-table-body");
    if (!tbody) return;

    tbody.innerHTML = (leads || [])
      .map(
        (l) => `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 text-sm text-gray-600">${l["Date Submitted"] || ""}</td>
          <td class="px-6 py-4 text-sm font-bold text-gray-900">${l["Homeowner Name"] || ""}</td>
          <td class="px-6 py-4 text-sm text-gray-600">${l["Status"] || ""}</td>
        </tr>
      `
      )
      .join("");
  }

  normalizeKey(obj, key) {
    // dashboard helper: tries exact key, then case-insensitive match
    if (!obj || !key) return "";
    if (obj[key] != null) return obj[key];

    const k = key.toLowerCase();
    const found = Object.keys(obj).find((x) => x.toLowerCase() === k);
    return found ? obj[found] : "";
  }

  // Simple status helpers for TL dashboard logic
  isConfirmedStatus(status) {
    const s = (status || "").toString().toLowerCase().trim();
    return s === "confirmed";
  }
  isCancelledLikeStatus(status) {
    const s = (status || "").toString().toLowerCase();
    return s.includes("cancel");
  }

  parseDateSafe(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  formatDateShort(dateObj) {
    if (!dateObj) return "—";
    return dateObj.toLocaleDateString();
  }

  formatCurrency(n) {
    const num = Number(n) || 0;
    return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  handleFilterChange(filterValue) {
    // If your TL dashboard calls this, keep it simple:
    // For now: just store filteredLeads based on timeframe if you want later
    this.currentFilter = filterValue;
    this.filteredLeads = this.leadsData;
  }

  updateNavUI() {
    if (!this.currentUser) return;
    const nameEl = document.getElementById("nav-user-name");
    const roleEl = document.getElementById("nav-user-role");

    if (nameEl) nameEl.textContent = this.currentUser.name || "User";
    if (roleEl) roleEl.textContent = (this.currentUser.role || "agent").toString().replace("_", " ").toUpperCase();
  }

  // =========================================================
  // EVENTS
  // =========================================================
  bindEvents() {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(loginForm);
        this.login(fd.get("email"), fd.get("password"));
      };
    }
  }
}

// Create global portal
const portal = new CallHammerPortal();
window.portal = portal;
