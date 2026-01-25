/**
 * CALL HAMMER LEADS - MAIN PORTAL LOGIC (ADMIN FIXED + ALIGNED)
 * - Works with your existing dashboards (Agent / Team Leader / Admin)
 * - Uses the Admin webhook path shown in your screenshots: /webhook/dashboard-data
 */

class CallHammerPortal {
  constructor() {
    this.currentUser = null;

    // Shared stores used by dashboards
    this.leadsData = [];
    this.filteredLeads = [];
    this.employeeList = [];
    this.timeOffHistory = [];

    // Admin store
    this.adminState = {
      clients: [],
      leads: [],
      agents: []
    };

    // Charts holder (some dashboards call portal.charts?.xxx?.resize())
    this.charts = {};

    // ✅ Your real webhooks (updated admin one)
    this.webhooks = {
      login: "https://automate.callhammerleads.com/webhook/agent-login",
      fetchData: "https://automate.callhammerleads.com/webhook/fetch-agent-data",
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

    // Admin dashboard route
    if (path.includes("admin-dashboard")) {
      if (this.currentUser && (this.currentUser.role || "").toLowerCase() === "admin") {
        this.fetchAdminData();
        setInterval(() => this.fetchAdminData(), 300000); // every 5 mins
      } else {
        window.location.href = "index.html";
      }
      return;
    }

    // Agent / Team Leader route
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

      // ✅ Accept multiple "success" shapes
      const ok =
        result?.status === "success" ||
        result?.success === true ||
        result?.ok === true;

      if (!ok) {
        alert("Login failed: " + (result?.message || "Invalid credentials"));
        return;
      }

      // ✅ Accept either result.user or nested data
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

      // Pull from multiple possible keys
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
  // ADMIN FETCH (FIXED)
  // =========================================================
  async fetchAdminData() {
    try {
      // cache-buster prevents stale cached responses
      const url = this.webhooks.fetchAdminData + "?t=" + Date.now();

      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        console.warn("Admin webhook failed:", response.status, response.statusText);
        return;
      }

      const result = await response.json();

      // Accept either {clients,leads,agents} or {json:{clients,leads,agents}}
      const data = result?.json ? result.json : result;

      this.adminState = {
        clients: Array.isArray(data?.clients) ? data.clients : [],
        leads: Array.isArray(data?.leads) ? data.leads : [],
        agents: Array.isArray(data?.agents) ? data.agents : []
      };

      // Keep these populated so admin UI can reuse
      this.leadsData = this.normalizeLeads(this.adminState.leads);
      this.employeeList = this.adminState.agents;

      // If your admin dashboard has a refresh function, trigger it
      if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === "function") {
        window.adminDashboard.refreshDashboard();
      }

      // Basic fallback: if there's a leads table, show first rows
      if (document.getElementById("leads-table-body")) {
        this.renderLeadsTable(this.leadsData.slice(0, 100));
      }

      console.log("✅ Admin data loaded:", {
        clients: this.adminState.clients.length,
        leads: this.adminState.leads.length,
        agents: this.adminState.agents.length
      });
    } catch (e) {
      console.warn("Admin data loading error:", e);
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
    if (!obj || !key) return "";
    if (obj[key] != null) return obj[key];
    const k = key.toLowerCase();
    const found = Object.keys(obj).find((x) => x.toLowerCase() === k);
    return found ? obj[found] : "";
  }

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
    this.currentFilter = filterValue;
    this.filteredLeads = this.leadsData;
  }

  updateNavUI() {
    if (!this.currentUser) return;
    const nameEl = document.getElementById("nav-user-name");
    const roleEl = document.getElementById("nav-user-role");

    if (nameEl) nameEl.textContent = this.currentUser.name || "User";
    if (roleEl) {
      roleEl.textContent = (this.currentUser.role || "agent")
        .toString()
        .replace("_", " ")
        .toUpperCase();
    }
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
