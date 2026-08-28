// Call Hammer Leads - Unified Application Logic
class CallHammerPortal {
  constructor() {
    this.currentUser = null;
    
    this.supabase = window.supabase
  ? window.supabase.createClient(
      'https://api.supabase.callhammerleads.com',
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTcwMjI2MCwiZXhwIjo0OTI3Mzc1ODYwLCJyb2xlIjoiYW5vbiJ9.XuWCdGs0XSSSlWhsF6gR4gHMp50C-v6xra9ABgSVRoU'
    )
  : null;

    // Agent/TL datasets
    this.leadsData = [];
    this.employeeList = [];
    this.filteredLeads = [];
    this.currentFilter = 'this-week';

    this.weeklyPayroll = [];
    this.timeTracker = [];

    // Admin datasets (normalized + raw)
    this.adminState = {
  rawClients: [],
  clients: [],
  leads: [],
  agents: [],
  rawStatuses: [],
  rawPackages: [],
  weeklyPayroll: [],
  payrollHistory: [],
  payrollWeeklyFactView: [],
  payrollWorkers: [],
  clientHealthView: [],
  agentPerformanceView: [],
  clientPackageAllocationView: [],
  clientPackageStatusView: [],
  clientOnboarding: []
};
    // Cache to avoid Google Sheets quota/too-many-requests issues
    this.lastAdminFetch = 0;
    this.adminCacheMs = 60_000; // 60s

    this.webhooks = {
      login: 'https://automate.callhammerleads.com/webhook/agent-login',
      fetchData: 'https://automate.callhammerleads.com/webhook/fetch-agent-data',
      fetchTLData: 'https://automate.callhammerleads.com/webhook/fetch-tl-data',
      fetchAdminData: 'https://automate.callhammerleads.com/webhook/dashboard-data-v2',
      
      // ✅ PAYROLL
      payrollData: 'https://automate.callhammerleads.com/webhook/payroll-data',

      timeOffRequest: 'https://automate.callhammerleads.com/webhook/timeoff-request',
      changePassword: 'https://automate.callhammerleads.com/webhook/change-password',
      manageEmployee: 'https://automate.callhammerleads.com/webhook/manage-employee',
      
      // ✅ PASSBOOK
      passbookClientsList: 'https://automate.callhammerleads.com/webhook/passbook-clients-list',
      passbookClientDetails: 'https://automate.callhammerleads.com/webhook/passbook-client',
      passbookClientUpdate: 'https://automate.callhammerleads.com/webhook/passbook-client-update',
      
      // ✅ ADD THESE TWO NEW WEBHOOKS FOR LEADS
      updateLead: 'https://automate.callhammerleads.com/webhook/update-lead',
      deleteLead: 'https://automate.callhammerleads.com/webhook/delete-lead',
      getGhlAvailability: 'https://automate.callhammerleads.com/webhook/agent-get-availability',
bookGhlAppointment: 'https://automate.callhammerleads.com/webhook/book-ghl-appointment',
    };

    this.init();
  }

  // ------------------------
  // ✅ LOGIN + SESSION
  // ------------------------
  saveSession(user) {
    try {
      localStorage.setItem('ch_session', JSON.stringify({ user }));
      this.currentUser = user;
    } catch (e) {
      console.warn('Failed to save session:', e);
    }
  }

  clearSession() {
    try { localStorage.removeItem('ch_session'); } catch (e) {}
    this.currentUser = null;
  }

   routeByRole(roleRaw, user = null) {
  const role = String(roleRaw || '').toLowerCase();

  if (role === 'recruitment') return 'recruitment-dashboard.html';
  if (role === 'admin') return 'admin-dashboard.html';
  if (role === 'management') return 'management-dashboard.html';
  if (role === 'sales' || role === 'team_leader' || role === 'team leader' || role === 'tl') return 'salesdashboard.html';
  if (role === 'sales_rep') return 'salesrep-dashboard.html';

  return 'agent-dashboard.html';
}

  async loginWithCredentials(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();

  if (!cleanEmail || !cleanPassword) {
    throw new Error('Missing email or password.');
  }

  if (!this.supabase) {
    throw new Error('Supabase client not initialized.');
  }

  try {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword
    });

    if (error) {
      throw new Error(error.message || 'Supabase login failed.');
    }

    const authUser = data?.user;
    if (!authUser) {
      throw new Error('Supabase login failed: user missing.');
    }

    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('id, auth_user_id, organization_id, email, full_name, display_name, role, is_active, can_access_recruitment_dashboard')
      .eq('auth_user_id', authUser.id)
      .single();

    if (profileError) {
      throw new Error(profileError.message || 'Failed to load profile.');
    }

    if (!profile) {
      throw new Error('No profile found for this user.');
    }

    if (!profile.is_active) {
      throw new Error('This account is inactive.');
    }

    const user = {
      id: profile.id,
      auth_user_id: profile.auth_user_id,
      organization_id: profile.organization_id,
      email: profile.email,
      name: profile.display_name || profile.full_name || profile.email,
      full_name: profile.full_name,
      display_name: profile.display_name,
      role: profile.role,
can_access_recruitment_dashboard: profile.can_access_recruitment_dashboard === true
    };

    this.saveSession(user);
    window.location.href = this.routeByRole(user.role, user);
  } catch (supabaseErr) {
    console.error('Supabase login failed:', supabaseErr);
    throw supabaseErr;
  }
}
  
  async tryLoginFromQueryParams() {
  return false;
}

  // ✅ Binds to YOUR index.html IDs
  bindIndexLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    const emailEl = document.getElementById('email');
    const passEl = document.getElementById('password');
    const btn = document.getElementById('loginButton');

    const errWrap = document.getElementById('loginError');
    const errText = errWrap ? errWrap.querySelector('p') : null;

    const spinner = document.getElementById('loginSpinner');
    const loginText = document.getElementById('loginText');

    const setLoading = (isLoading) => {
      if (btn) btn.disabled = !!isLoading;
      if (spinner) spinner.classList.toggle('hidden', !isLoading);
      if (loginText) loginText.classList.toggle('hidden', !!isLoading);
    };

    const showError = (msg) => {
      if (!errWrap) return;
      errWrap.classList.remove('hidden');
      if (errText) errText.textContent = msg || 'Login failed. Please try again.';
      errWrap.classList.add('error-shake');
      setTimeout(() => errWrap.classList.remove('error-shake'), 600);
    };

    const clearError = () => {
      if (!errWrap) return;
      errWrap.classList.add('hidden');
      if (errText) errText.textContent = '';
    };

    const run = async (e) => {
      if (e) e.preventDefault();
      clearError();

      const email = emailEl ? emailEl.value : '';
      const password = passEl ? passEl.value : '';

      try {
        setLoading(true);
        await this.loginWithCredentials(email, password);
      } catch (err) {
        console.error(err);
        showError(err?.message || 'Login failed. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    form.addEventListener('submit', run);
    if (btn) btn.addEventListener('click', run);
  }

  async logout() {
  try {
    if (this.supabase) {
      await this.supabase.auth.signOut(); // ✅ THIS IS THE REAL FIX
    }
  } catch (err) {
    console.error('Supabase logout failed:', err);
  }

  this.clearSession(); // keep your local cleanup
  window.location.href = 'index.html';
}
    async fetchCommandCenterNotifications(teamKey = 'admin_management', limit = 50) {
  if (!supaClient) return [];

const allowedModules =
  teamKey === 'admin_management'
    ? ['sales_pipeline', 'time_off']
    : ['sales_pipeline'];

  try {
    const { data, error } = await supaClient
      .from('command_center_team_state')
      .select(`
        id,
        event_id,
        team_key,
        is_unread,
        is_flagged,
        is_done,
        is_reviewed,
        status,
        updated_at,
        command_center_events (
          id,
          module_key,
          entity_type,
          entity_id,
          entity_code,
          entity_label,
          event_type,
          summary_text,
          field_changes,
          old_data,
          new_data,
          actor_name,
          actor_role,
          severity,
          created_at
        )
      `)
     .eq('team_key', teamKey)
.order('updated_at', { ascending: false })
.limit(Math.max(limit, 300));

    if (error) {
      console.error('Failed to fetch notifications:', error);
      return [];
    }

    return (data || []).filter(row => {
      const moduleKey = String(row?.command_center_events?.module_key || '').trim().toLowerCase();
      return allowedModules.includes(moduleKey);
    });
  } catch (err) {
    console.error('fetchCommandCenterNotifications exception:', err);
    return [];
  }
}

  async fetchSalesPassbookAcknowledgements(limit = 100) {
  if (!supaClient) return [];

  try {
    const { data, error } = await supaClient
      .from('command_center_team_state')
      .select(`
        id,
        event_id,
        team_key,
        is_unread,
        is_reviewed,
        reviewed_by_profile_id,
        reviewed_at,
        status,
        updated_at,
        command_center_events (
          id,
          module_key,
          entity_type,
          entity_id,
          entity_code,
          entity_label,
          event_type,
          summary_text,
          field_changes,
          old_data,
          new_data,
          actor_name,
          actor_role,
          created_at
        )
      `)
      .eq('team_key', 'sales')
      .eq('is_unread', true)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('fetchSalesPassbookAcknowledgements failed:', error);
      return [];
    }

    return (data || []).filter(row =>
      String(row?.command_center_events?.module_key || '').toLowerCase() === 'passbook_clients'
    );
  } catch (err) {
    console.error('fetchSalesPassbookAcknowledgements exception:', err);
    return [];
  }
}

  async fetchPassbookModuleInbox(teamKey = null, limit = 100) {
  if (!supaClient) return [];

  const resolvedTeamKey = teamKey || this.getCommandCenterTeamKey();

  try {
    const { data, error } = await supaClient
      .from('command_center_team_state')
      .select(`
        id,
        event_id,
        team_key,
        is_unread,
        is_reviewed,
        reviewed_by_profile_id,
        reviewed_at,
        updated_at,
        command_center_events (
          id,
          module_key,
          entity_type,
          entity_id,
          entity_code,
          entity_label,
          event_type,
          summary_text,
          field_changes,
          old_data,
          new_data,
          actor_name,
          actor_role,
          created_at
        )
      `)
      .eq('team_key', resolvedTeamKey)
      .eq('is_reviewed', false)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('fetchPassbookModuleInbox failed:', error);
      return [];
    }

    return (data || []).filter(row =>
      String(row?.command_center_events?.module_key || '').toLowerCase() === 'passbook_clients'
    );
  } catch (err) {
    console.error('fetchPassbookModuleInbox exception:', err);
    return [];
  }
}

  async markCommandCenterReviewed(eventId, teamKey = 'admin_management') {
    if (!supaClient || !eventId) return false;

    const { data, error } = await supaClient.rpc('command_center_mark_reviewed', {
      p_event_id: eventId,
      p_team_key: teamKey
    });

    if (error) {
      console.error('markCommandCenterReviewed failed:', error);
      return false;
    }

    return !!data;
  }

  async acknowledgePassbookChange(eventId, teamKey = null) {
  const resolvedTeamKey = teamKey || this.getCommandCenterTeamKey();

    // If Admin/Management acknowledged a Passbook change,
// notify Sales/Sales Rep that their change was reviewed.
const ok = await this.markCommandCenterReviewed(eventId, resolvedTeamKey);

if (!ok) return false;

// NOW the row is updated → safe to propagate to sales
if (resolvedTeamKey === 'admin_management') {
  try {
    const { data: adminStateRow, error: adminStateError } = await supaClient
      .from('command_center_team_state')
      .select('event_id, organization_id, reviewed_by_profile_id, reviewed_at')
      .eq('event_id', eventId)
      .eq('team_key', 'admin_management')
      .single();

    if (!adminStateError && adminStateRow) {
      const { error: salesAckError } = await supaClient
        .from('command_center_team_state')
        .upsert(
          [{
            event_id: eventId,
            organization_id: adminStateRow.organization_id,
            team_key: 'sales',
            is_unread: true,
            is_reviewed: true,
            reviewed_by_profile_id: adminStateRow.reviewed_by_profile_id,
            reviewed_at: adminStateRow.reviewed_at,
            status: 'acknowledged'
          }],
          { onConflict: 'event_id,team_key' }
        );

      if (salesAckError) {
        console.error('Sales acknowledgement notification failed:', salesAckError);
      }
    }
  } catch (err) {
    console.error('Sales acknowledgement propagation failed:', err);
  }
}

  try {
    if (window.Admin?.loadPassbookModuleInbox) {
      await window.Admin.loadPassbookModuleInbox();
    }

  } catch (err) {
    console.warn('Passbook acknowledge refresh failed:', err);
  }

  return true;
}

  async setCommandCenterFlagged(eventId, teamKey = 'admin_management', isFlagged = true) {
    if (!supaClient || !eventId) return false;

    const { data, error } = await supaClient.rpc('command_center_set_flagged', {
      p_event_id: eventId,
      p_team_key: teamKey,
      p_is_flagged: !!isFlagged
    });

    if (error) {
      console.error('setCommandCenterFlagged failed:', error);
      return false;
    }

    return !!data;
  }

  async setCommandCenterDone(eventId, teamKey = 'admin_management', isDone = true) {
    if (!supaClient || !eventId) return false;

    const { data, error } = await supaClient.rpc('command_center_set_done', {
      p_event_id: eventId,
      p_team_key: teamKey,
      p_is_done: !!isDone
    });

    if (error) {
      console.error('setCommandCenterDone failed:', error);
      return false;
    }

    return !!data;
  }

    formatMSTDateTimeShort(value) {
    if (!value) return '—';
    try {
      const dt = new Date(value);
      if (isNaN(dt.getTime())) return '—';

      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(dt) + ' MST';
    } catch (e) {
      return '—';
    }
  }

  async fetchCommandCenterNotes(limit = 50) {
    if (!supaClient) return [];

    const organizationId = this.getCurrentOrganizationId();
    if (!organizationId) return [];

    try {
      const { data, error } = await supaClient
        .from('command_center_notes')
        .select('*')
        .eq('organization_id', organizationId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('fetchCommandCenterNotes failed:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('fetchCommandCenterNotes exception:', err);
      return [];
    }
  }

  async createCommandCenterNote({
    body,
    noteType = 'note',
    title = null,
    moduleKey = 'notes',
    entityType = null,
    entityId = null,
    entityLabel = null,
    assignedTeamKey = 'admin_management'
  }) {
    if (!supaClient) return null;

    const organizationId = this.getCurrentOrganizationId();
    if (!organizationId) return null;

    try {
      const { data, error } = await supaClient
        .from('command_center_notes')
        .insert([{
          organization_id: organizationId,
          note_type: noteType,
          module_key: moduleKey,
          entity_type: entityType,
          entity_id: entityId,
          entity_label: entityLabel,
          title,
          body,
          created_by_profile_id: this.currentUser?.id || null,
          created_by_name: this.currentUser?.name || this.currentUser?.email || 'Unknown',
          created_by_role: this.currentUser?.role || null,
          assigned_team_key: assignedTeamKey,
          status: 'open'
        }])
        .select()
        .single();

      if (error) {
        console.error('createCommandCenterNote failed:', error);
        return null;
      }

      return data || null;
    } catch (err) {
      console.error('createCommandCenterNote exception:', err);
      return null;
    }
  }

  async setCommandCenterNoteDone(noteId, isDone = true) {
    if (!supaClient || !noteId) return false;

    try {
      const { error } = await supaClient
        .from('command_center_notes')
        .update({
          status: isDone ? 'done' : 'open',
          done_by_profile_id: isDone ? (this.currentUser?.id || null) : null,
          done_at: isDone ? new Date().toISOString() : null
        })
        .eq('id', noteId);

      if (error) {
        console.error('setCommandCenterNoteDone failed:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('setCommandCenterNoteDone exception:', err);
      return false;
    }
  }

    isManagementUser() {
    return String(this.currentUser?.role || '').toLowerCase() === 'management';
  }

  canEditOverviewPackageStatus() {
    return !this.isManagementUser();
  }

  canApproveTimeOffRequests() {
    return !this.isManagementUser();
  }

  canDeletePassbookClients() {
    return !this.isManagementUser();
  }

  updateDashboardIdentity() {
    const role = String(this.currentUser?.role || '').toLowerCase();
    const fullName =
      this.currentUser?.display_name ||
      this.currentUser?.full_name ||
      this.currentUser?.name ||
      this.currentUser?.email ||
      'Unknown User';

    const accessLabelEl = document.getElementById('sidebar-access-label');
    const userNameEl = document.getElementById('sidebar-user-name');
    const initialsEl = document.getElementById('sidebar-user-initials');

if (accessLabelEl) {
  if (role === 'management') accessLabelEl.textContent = 'Management Access';
  else if (role === 'admin') accessLabelEl.textContent = 'Admin Access';
  else if (role === 'sales_rep') accessLabelEl.textContent = 'Sales Rep Access';
  else if (role === 'sales' || role === 'team_leader' || role === 'team leader' || role === 'tl') accessLabelEl.textContent = 'Sales Access';
  else if (role === 'recruitment') accessLabelEl.textContent = 'Recruitment Access';
else accessLabelEl.textContent = 'Agent Access';
}

    if (userNameEl) {
      userNameEl.textContent = fullName;
    }

    if (initialsEl) {
      const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
      const initials = parts.length >= 2
        ? `${parts[0][0]}${parts[1][0]}`
        : String(fullName).slice(0, 2);

      initialsEl.textContent = String(initials || 'NA').toUpperCase();
    }
  }

 getCommandCenterTeamKey() {
    const role = String(this.currentUser?.role || '').toLowerCase();

    if (
      role === 'sales' ||
      role === 'sales_rep' ||
      role === 'team_leader' ||
      role === 'team leader' ||
      role === 'tl'
    ) {
      return 'sales';
    }

    return 'admin_management';
  }

  async deleteCommandCenterNote(noteId) {
  if (!supaClient || !noteId) return false;

  try {
    const { error } = await supaClient
      .from('command_center_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      console.error('deleteCommandCenterNote failed:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('deleteCommandCenterNote exception:', err);
    return false;
  }
}

  cleanupCommandCenterRealtime() {
  try {
    if (this._ccRealtimeChannel) {
      supaClient.removeChannel(this._ccRealtimeChannel);
      this._ccRealtimeChannel = null;
    }

    if (this._adminRealtimeChannel) {
      supaClient.removeChannel(this._adminRealtimeChannel);
      this._adminRealtimeChannel = null;
    }
  } catch (err) {
    console.warn('cleanupCommandCenterRealtime failed:', err);
  }
}

setupCommandCenterRealtime() {
  if (!supaClient) return;
  if (!this.currentUser) return;

  const organizationId = this.getCurrentOrganizationId();
  const teamKey = this.getCommandCenterTeamKey();

  if (!organizationId || !teamKey) return;

  this.cleanupCommandCenterRealtime();

// Notifications + notes realtime
this._ccRealtimeChannel = supaClient
  .channel(`cc-live:${organizationId}:${teamKey}`)
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "command_center_team_state",
      filter: `team_key=eq.${teamKey}`
    },
    async () => {
      try {
        const role = String(this.currentUser?.role || "").toLowerCase();

        if (role !== "management") {
          await window.Admin?.loadNotifications?.(true);
        }

        await window.Admin?.loadPassbookModuleInbox?.();
        await window.Admin?.loadSalesPassbookAckInbox?.();
      } catch (err) {
        console.error("Realtime notifications refresh failed:", err);
      }
    }
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "command_center_notes",
      filter: `organization_id=eq.${organizationId}`
    },
    async () => {
      try {
        const role = String(this.currentUser?.role || "").toLowerCase();

        if (role !== "management") {
          await window.Admin?.loadNotes?.();
        }
      } catch (err) {
        console.error("Realtime notes refresh failed:", err);
      }
    }
  )
  .subscribe(status => {
    console.log("Command Center realtime status:", status);
  });

  // Debounced admin data refresh for live operational updates
  const debouncedRefresh = () => {
    clearTimeout(this._adminRealtimeRefreshTimer);
    this._adminRealtimeRefreshTimer = setTimeout(() => {
  this.fetchAdminData(true);
}, 5000);
  };

  this._adminRealtimeChannel = supaClient
    .channel(`admin-live:${organizationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, debouncedRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'packages' }, debouncedRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_onboarding' }, debouncedRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_raw' }, debouncedRefresh)
    .subscribe((status) => {
      console.log('Admin dashboard realtime status:', status);
    });
}

  // ------------------------
  // Init / Routing
  // ------------------------
  async init() {
    await this.checkExistingSession();

    const path = (window.location.pathname || '').toLowerCase();
    const onIndex =
      path.endsWith('index.html') ||
      path === '/' ||
      path === '' ||
      path.endsWith('/index') ||
      path.endsWith('/index.html');

    if (onIndex && this.currentUser) {
      window.location.href = this.routeByRole(this.currentUser.role, this.currentUser);
      return;
    }

    if (onIndex) {
  this.bindIndexLoginForm();
}

this.updateDashboardIdentity();
this.enforceRoleRouting();
this.bindEvents();
this.bindPassbookUpdateButton();

    if (path.includes('passbook') || document.querySelector('[data-page="passbook-clients"]')) {
      setTimeout(() => this.loadPassbookClientsList(true), 300);
    }

   const pathName = (window.location.pathname || '').toLowerCase();
const isAgentPage = pathName.includes('agent-dashboard');
const isAdminPage = pathName.includes('admin-dashboard');
const isSalesPage = pathName.includes('salesdashboard');
const isSalesRepPage = pathName.includes('salesrep-dashboard');
const isManagementPage = pathName.includes('management-dashboard');
    const isRecruitmentPage = pathName.includes('recruitment-dashboard');
const isCommandCenter =
  isAdminPage ||
  isSalesPage ||
  isSalesRepPage ||
  isManagementPage ||
  isRecruitmentPage;
const isOldAgentDash = isAgentPage;

    // Load Agent Dashboard
   if (this.currentUser && isOldAgentDash && !isCommandCenter) {
  console.log("🔥 AGENT DASHBOARD ONLY");

  const isAgentDOM = document.getElementById('stat-appointments');

  if (!isAgentDOM) {
    console.log("⛔ Not agent DOM, skipping agent load");
    return;
  }

  setTimeout(async () => {
  await this.fetchAllData();
  await this.loadAgentLeadsWithFilters();
  this.startMSTClock();
  await this.loadTimeOffHistory();
}, 300);
}
   // Load Admin OR Sales Dashboard
if (isCommandCenter) {
  console.log("🟢 ADMIN DASHBOARD LOADING SAFE MODE");
  if (!isRecruitmentPage) {
  document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
}

  setTimeout(() => {
    this.fetchAdminData(false);
    this.setupCommandCenterRealtime();
    // this.loadPayrollData(false);
  }, 300);

  this.startAdminAutoRefresh();
}
  }

   enforceRoleRouting() {
  if (!this.currentUser) return;

  const path = (window.location.pathname || '').toLowerCase();
  const role = (this.currentUser.role || 'agent').toLowerCase();

  if (!path.includes('dashboard') && !path.includes('admin') && !path.includes('management') && !path.includes('salesrep')) return;

  const onAdmin = path.includes('admin-dashboard');
  const onAgent = path.includes('agent-dashboard');
  const onSales = path.includes('salesdashboard');
  const onSalesRep = path.includes('salesrep-dashboard');
  const onRecruitment = path.includes('recruitment-dashboard');
  const onManagement = path.includes('management-dashboard');

      if (role === 'admin' && !onAdmin) window.location.href = 'admin-dashboard.html';
    else if (role === 'management' && !onManagement) window.location.href = 'management-dashboard.html';
    else if ((role === 'sales' || role === 'team_leader' || role === 'team leader' || role === 'tl') && !onSales) window.location.href = 'salesdashboard.html';
    else if (role === 'sales_rep' && !path.includes('salesrep-dashboard')) window.location.href = 'salesrep-dashboard.html';
    else if (role === 'recruitment' && !onRecruitment) {
  window.location.href = 'recruitment-dashboard.html';
}
    
  else if (
  role === 'agent' &&
  this.currentUser?.can_access_recruitment_dashboard !== true &&
  !onAgent
) {
  window.location.href = 'agent-dashboard.html';
}
}
  
  // ------------------------
  // Session / Events (safe)
  // ------------------------
  async checkExistingSession() {
  try {
    if (!this.supabase) return;

    const { data, error } = await this.supabase.auth.getSession();

    if (error || !data?.session) {
      this.clearSession();
      return;
    }

    const authUser = data.session.user;

    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('id, auth_user_id, organization_id, email, full_name, display_name, role, is_active, can_access_recruitment_dashboard')
      .eq('auth_user_id', authUser.id)
      .single();

    if (profileError || !profile || !profile.is_active) {
      this.clearSession();
      return;
    }

    const user = {
  id: profile.id,
  auth_user_id: profile.auth_user_id,
  organization_id: profile.organization_id,
  email: profile.email,
  name: profile.display_name || profile.full_name || profile.email,
  full_name: profile.full_name,
  display_name: profile.display_name,
  role: profile.role,
  can_access_recruitment_dashboard: profile.can_access_recruitment_dashboard === true
};
    this.saveSession(user);

  } catch (e) {
    console.warn('Session validation failed:', e);
    this.clearSession();
  }
}

 bindEvents() {
  const pathName = (window.location.pathname || '').toLowerCase();
  const isAgentPage = pathName.includes('agent-dashboard');

  if (!isAgentPage) return;

   this.setupLeadSubmissionClientRoutes();

   // OVERVIEW FILTERS
const overviewTimeframe = document.getElementById('timeframe-filter');
if (overviewTimeframe && !overviewTimeframe.dataset.bound) {
  overviewTimeframe.addEventListener('change', async () => {
    const customStartEl = document.getElementById('custom-start');
    const customEndEl = document.getElementById('custom-end');

    if (overviewTimeframe.value !== 'custom') {
      if (customStartEl) customStartEl.value = '';
      if (customEndEl) customEndEl.value = '';
    }

    await this.fetchAllData();
  });
  overviewTimeframe.dataset.bound = 'true';
}

const overviewStart = document.getElementById('custom-start');
const overviewEnd = document.getElementById('custom-end');

const maybeAutoLoadOverviewCustom = async () => {
  const timeframeEl = document.getElementById('timeframe-filter');
  if (timeframeEl && timeframeEl.value !== 'custom') {
    timeframeEl.value = 'custom';
  }

  if (overviewStart?.value && overviewEnd?.value) {
    await this.fetchAllData();
  }
};

if (overviewStart && !overviewStart.dataset.bound) {
  overviewStart.addEventListener('change', maybeAutoLoadOverviewCustom);
  overviewStart.dataset.bound = 'true';
}

if (overviewEnd && !overviewEnd.dataset.bound) {
  overviewEnd.addEventListener('change', maybeAutoLoadOverviewCustom);
  overviewEnd.dataset.bound = 'true';
}

   this.bindTeamLeaderboardsUI();

  // LEADS TIMEFRAME FILTER
const leadsTimeframeFilter = document.getElementById('leads-timeframe');
if (leadsTimeframeFilter && !leadsTimeframeFilter.dataset.bound) {
  leadsTimeframeFilter.addEventListener('change', async () => {
    await this.loadAgentLeadsWithFilters();
  });
  leadsTimeframeFilter.dataset.bound = 'true';
}

  // STATUS FILTER (LEADS TAB)
  const statusFilter = document.getElementById('status-filter');
if (statusFilter && !statusFilter.dataset.bound) {
  statusFilter.addEventListener('change', async () => {
    await this.loadAgentLeadsWithFilters();
  });
  statusFilter.dataset.bound = 'true';
}

   // CUSTOM RANGE APPLY
// LEADS CUSTOM RANGE / CLEAR
const applyBtn = document.getElementById('apply-leads-range');
if (applyBtn && !applyBtn.dataset.bound) {
  applyBtn.addEventListener('click', async () => {
    const leadsTimeframeEl = document.getElementById('leads-timeframe');
    const leadsStartEl = document.getElementById('leads-start');
    const leadsEndEl = document.getElementById('leads-end');

    if (leadsTimeframeEl) leadsTimeframeEl.value = 'this-week';
    if (leadsStartEl) leadsStartEl.value = '';
    if (leadsEndEl) leadsEndEl.value = '';

    await this.loadAgentLeadsWithFilters();
  });
  applyBtn.dataset.bound = 'true';
}

const leadsStartEl = document.getElementById('leads-start');
const leadsEndEl = document.getElementById('leads-end');

const maybeAutoLoadLeadsCustom = async () => {
  if (leadsStartEl?.value && leadsEndEl?.value) {
    await this.loadAgentLeadsWithFilters();
  }
};

if (leadsStartEl && !leadsStartEl.dataset.bound) {
  leadsStartEl.addEventListener('change', maybeAutoLoadLeadsCustom);
  leadsStartEl.dataset.bound = 'true';
}

if (leadsEndEl && !leadsEndEl.dataset.bound) {
  leadsEndEl.addEventListener('change', maybeAutoLoadLeadsCustom);
  leadsEndEl.dataset.bound = 'true';
}

// AVATAR UPLOAD
const avatarInput = document.getElementById('profile-avatar-input');
const avatarSaveBtn = document.getElementById('profile-avatar-save');

if (avatarInput && !avatarInput.dataset.bound) {
  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    this._pendingAvatarFile = file;

    const previewUrl = URL.createObjectURL(file);
    const avatarEl = document.getElementById('profile-avatar-preview');
    if (avatarEl) avatarEl.src = previewUrl;

    if (avatarSaveBtn) avatarSaveBtn.classList.remove('hidden');
  });

  avatarInput.dataset.bound = 'true';
}

if (avatarSaveBtn && !avatarSaveBtn.dataset.bound) {
  avatarSaveBtn.addEventListener('click', async () => {
    const file = this._pendingAvatarFile;
    if (!file) return;

    const userId = this.currentUser?.auth_user_id;
    if (!userId) return alert('User not found');

    const filePath = `${userId}/${Date.now()}_${file.name}`;

    const { error: uploadError } = await this.supabase.storage
      .from('profile-pictures')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      console.error(uploadError);
      alert('Upload failed');
      return;
    }

    const { data } = this.supabase.storage
      .from('profile-pictures')
      .getPublicUrl(filePath);

    const publicUrl = data?.publicUrl;

    await this.supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('auth_user_id', userId);

    this._pendingAvatarFile = null;
    avatarSaveBtn.classList.add('hidden');
    alert('Profile photo saved.');
  });

  avatarSaveBtn.dataset.bound = 'true';
}

// ===== MY LEADS FILTERS =====
const leadsSearch = document.getElementById('leads-search');
const leadsTimeframe = document.getElementById('leads-timeframe');
const leadsApply = document.getElementById('apply-leads-range');

if (leadsSearch && !leadsSearch.dataset.bound) {
  leadsSearch.addEventListener('input', () => this.loadAgentLeadsWithFilters());
  leadsSearch.dataset.bound = 'true';
}

if (leadsTimeframe && !leadsTimeframe.dataset.bound) {
  leadsTimeframe.addEventListener('change', () => this.loadAgentLeadsWithFilters());
  leadsTimeframe.dataset.bound = 'true';
}

if (leadsApply && !leadsApply.dataset.bound) {
  leadsApply.addEventListener('click', () => {
    const leadsSearchEl = document.getElementById('leads-search');
    const leadsStatusEl = document.getElementById('status-filter');
    const leadsTimeframeEl = document.getElementById('leads-timeframe');
    const leadsStartEl = document.getElementById('leads-start');
    const leadsEndEl = document.getElementById('leads-end');

    if (leadsSearchEl) leadsSearchEl.value = '';
    if (leadsStatusEl) leadsStatusEl.value = 'all';
    if (leadsTimeframeEl) leadsTimeframeEl.value = 'this-week';
    if (leadsStartEl) leadsStartEl.value = '';
    if (leadsEndEl) leadsEndEl.value = '';

    this.loadAgentLeadsWithFilters();
  });
  leadsApply.dataset.bound = 'true';
}
   // ===== PAYROLL FILTERS =====
const payrollTimeframe = document.getElementById('payroll-timeframe');
const payrollApply = document.getElementById('apply-payroll-range');

if (payrollTimeframe && !payrollTimeframe.dataset.bound) {
  payrollTimeframe.addEventListener('change', () => this.loadAgentPayroll());
  payrollTimeframe.dataset.bound = 'true';
}

if (payrollApply && !payrollApply.dataset.bound) {
  payrollApply.addEventListener('click', () => {
    const payrollTimeframeEl = document.getElementById('payroll-timeframe');
    const payrollStartEl = document.getElementById('payroll-start');
    const payrollEndEl = document.getElementById('payroll-end');

    if (payrollTimeframeEl) payrollTimeframeEl.value = '4-weeks';
    if (payrollStartEl) payrollStartEl.value = '';
    if (payrollEndEl) payrollEndEl.value = '';

    this.loadAgentPayroll();
  });
  payrollApply.dataset.bound = 'true';
}
   const payrollStart = document.getElementById('payroll-start');
const payrollEnd = document.getElementById('payroll-end');

const maybeAutoLoadPayrollCustom = () => {
  if (payrollStart?.value && payrollEnd?.value) {
    this.loadAgentPayroll();
  }
};

if (payrollStart && !payrollStart.dataset.bound) {
  payrollStart.addEventListener('change', maybeAutoLoadPayrollCustom);
  payrollStart.dataset.bound = 'true';
}

if (payrollEnd && !payrollEnd.dataset.bound) {
  payrollEnd.addEventListener('change', maybeAutoLoadPayrollCustom);
  payrollEnd.dataset.bound = 'true';
}
}

async setupLeadSubmissionClientRoutes() {
  if (!this.supabase) return;

  const clientSelect = document.getElementById('submit-client');
  const calendarWrapper = document.getElementById('client-calendar-wrapper');
  const calendarFrame = document.getElementById('client-calendar-frame');
  const calendarLabel = document.getElementById('selected-calendar-label');

  if (!clientSelect || !calendarWrapper || !calendarFrame) return;

  try {
    const { data, error } = await this.supabase
      .from('client_submission_routes')
      .select('*')
      .eq('is_active', true)
      .order('company_name', { ascending: true });

    if (error) {
      console.error('Failed loading client routes:', error);
      return;
    }

    const routes = data || [];

    clientSelect.innerHTML = `
      <option value="">Select Client</option>
      ${routes.map(route => `
        <option value="${route.id}">
          ${route.company_name}
        </option>
      `).join('')}
    `;

    clientSelect.addEventListener('change', () => {
      const selected = routes.find(r => r.id === clientSelect.value);

      if (!selected) {
        calendarWrapper.classList.add('hidden');
        calendarFrame.src = '';
        if (calendarLabel) calendarLabel.textContent = '';
        return;
      }

      const agentName =
        this.currentUser?.display_name ||
        this.currentUser?.full_name ||
        this.currentUser?.name ||
        '';

      const agentEmail = this.currentUser?.email || '';

      const url = new URL(selected.ghl_calendar_url);

      url.searchParams.set('chl_agent_name', agentName);
      url.searchParams.set('chl_agent_email', agentEmail);
      url.searchParams.set('chl_client_code', selected.client_code || '');
      url.searchParams.set('chl_client_name', selected.company_name || '');
      url.searchParams.set('chl_calendar_id', selected.ghl_calendar_id || '');
      url.searchParams.set('chl_timezone', selected.timezone || '');

      calendarWrapper.classList.remove('hidden');
      calendarFrame.src = url.toString();

      if (calendarLabel) {
        calendarLabel.textContent = selected.company_name || 'Selected Client';
      }

      clientSelect.dataset.clientCode = selected.client_code || '';
      clientSelect.dataset.companyName = selected.company_name || '';
      clientSelect.dataset.calendarId = selected.ghl_calendar_id || '';
      clientSelect.dataset.timezone = selected.timezone || '';
    });

  } catch (err) {
    console.error('setupLeadSubmissionClientRoutes failed:', err);
  }
}
  
  // ------------------------
  // Helpers
  // ------------------------
  normalizeKey(obj, key) {
    if (!obj) return '';
    const foundKey = Object.keys(obj).find(k => (k || '').toLowerCase() === (key || '').toLowerCase());
    return foundKey ? obj[foundKey] : '';
  }

  getAny(obj, keys, fallback = '') {
    if (!obj) return fallback;
    for (const k of keys) {
      const v = this.normalizeKey(obj, k);
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return fallback;
  }

  toNumberSafe(v, fallback = 0) {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'number') return isNaN(v) ? fallback : v;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? fallback : n;
  }

  normalizeCompanyKey(str) {
    if (!str) return 'unknown';
    return String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  }

  parseDateSafe(value) {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number' && isFinite(value)) {
      if (value > 20000) {
        const base = new Date(Date.UTC(1899, 11, 30));
        const ms = base.getTime() + value * 24 * 60 * 60 * 1000;
        const dt = new Date(ms);
        return isNaN(dt.getTime()) ? null : dt;
      }
      if (value > 1e12) {
        const dt = new Date(value);
        return isNaN(dt.getTime()) ? null : dt;
      }
      if (value > 1e9) {
        const dt = new Date(value * 1000);
        return isNaN(dt.getTime()) ? null : dt;
      }
    }

    const raw = value.toString().trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10) - 1;
      const d = parseInt(isoMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const m = parseInt(slashMatch[1], 10) - 1;
      const d = parseInt(slashMatch[2], 10);
      const y = parseInt(slashMatch[3], 10);
      const dt = new Date(y, m, d, 12, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // ------------------------
  // ✅ Status Helpers
  // ------------------------
  isQualifiedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CONFIRM') || s.includes('APPROV');
  }
  isRejectedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('REJECT');
  }
  isCreditedStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('CREDIT');
  }
  isPendingStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s.includes('PENDING');
  }

  formatCurrency(v) {
    const n = this.toNumberSafe(v, 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  // ------------------------
  // ✅ MST + Payroll week helpers
  // ------------------------
  toMST(date) {
    const d = new Date(date);
    const mstOffset = -7 * 60; 
    const localOffset = d.getTimezoneOffset();
    return new Date(d.getTime() + (mstOffset + localOffset) * 60000);
  }

  formatMSTTime(date = new Date()) {
    const mst = this.toMST(date);
    return mst.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  startMSTClock() {
    const el = document.getElementById('mst-clock');
    if (!el) return;
    const tick = () => { el.textContent = `${this.formatMSTTime()} MST`; };
    tick();
    clearInterval(this._mstClockInterval);
    this._mstClockInterval = setInterval(tick, 1000);
  }

  getPayrollWeekStart(date = new Date()) {
    const mst = this.toMST(date);
    const d = new Date(mst);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); 
    const diffToSat = (day - 6 + 7) % 7; 
    d.setDate(d.getDate() - diffToSat);
    return d;
  }

  getPayrollWeekRange(date = new Date()) {
    const start = this.getPayrollWeekStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  getPreviousPayrollWeekRange(date = new Date()) {
    const thisWeek = this.getPayrollWeekRange(date);
    const prevStart = new Date(thisWeek.start);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(thisWeek.end);
    prevEnd.setDate(prevEnd.getDate() - 7);
    return { start: prevStart, end: prevEnd };
  }

  // ------------------------
  // ✅ ADMIN ANALYTICS
  // ------------------------
  getLeadDateValue(lead) {
    return this.getAny(lead, ['lead_date', 'Lead Date', 'DATE', 'Date', 'created_at', 'Created At', 'timestamp', 'Timestamp', 'TimeStamp', 'Submitted At', 'submitted_at', 'Appointment Date', 'appointment_date', 'Date Submitted', 'date_submitted', 'Submission Date', 'submission_date'], '');
  }

  getLeadStatusValue(lead) {
    return this.getAny(lead, ['status', 'Status', 'Lead Status', 'LEAD STATUS', 'lead_status', 'Disposition', 'disposition'], '');
  }

  getSelectedAdminRangeKey() {
    const candidates = Array.from(document.querySelectorAll('button, a'))
      .filter(el => /today|this week|previous week|4 weeks|6 weeks|all-time/i.test(el.textContent || ''))
      .filter(el => el.classList.contains('active') || el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-selected') === 'true');

    const text = (candidates[0]?.textContent || 'today').toLowerCase();
    if (text.includes('all')) return 'all-time';
    if (text.includes('previous')) return 'previous-week';
    if (text.includes('6')) return '6-weeks';
    if (text.includes('4')) return '4-weeks';
    if (text.includes('this week')) return 'this-week';
    return 'today';
  }

  computeAdminDateRange(rangeKey) {
    const now = new Date();
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };

    const day = now.getDay(); 
    const monday = addDays(startOfDay(now), (day === 0 ? -6 : 1 - day)); 

    if (rangeKey === 'all-time') return { start: new Date(2000,0,1), end: endOfDay(now) };
    if (rangeKey === 'today') return { start: startOfDay(now), end: endOfDay(now) };
    if (rangeKey === 'this-week') return { start: monday, end: endOfDay(now) };
    if (rangeKey === 'previous-week') {
      const prevMon = addDays(monday, -7);
      const prevSun = addDays(prevMon, 6);
      return { start: prevMon, end: endOfDay(prevSun) };
    }
    if (rangeKey === '4-weeks') return { start: addDays(startOfDay(now), -28), end: endOfDay(now) };
    if (rangeKey === '6-weeks') return { start: addDays(startOfDay(now), -42), end: endOfDay(now) };

    return { start: startOfDay(now), end: endOfDay(now) };
  }

  setMetricByLabel(labelText, valueText) {
    const label = String(labelText || '').toLowerCase();
    const all = Array.from(document.querySelectorAll('*'))
      .filter(el => (el.textContent || '').trim().toLowerCase() === label);

    for (const lbl of all) {
      let card = lbl.closest('div');
      for (let i = 0; i < 6 && card; i++) {
        const candidates = Array.from(card.querySelectorAll('div,span,p,h1,h2,h3'))
          .filter(x => /\d|%/.test((x.textContent || '').trim()))
          .sort((a,b) => (b.textContent || '').trim().length - (a.textContent || '').trim().length);

        const big = candidates.find(x => /^[\d,]+(\.\d+)?%?$/.test((x.textContent || '').trim()));
        if (big) { big.textContent = valueText; return true; }
        card = card.parentElement;
      }
    }
    return false;
  }

  refreshAdminAnalyticsFromRawLeads() {
    const leads = Array.isArray(this.adminState.leads) ? this.adminState.leads : [];
    if (!leads.length) return;

    const rangeKey = this.getSelectedAdminRangeKey();
    const { start, end } = this.computeAdminDateRange(rangeKey);

    const inRange = leads.filter(l => {
      const dt = this.parseDateSafe(this.getLeadDateValue(l));
      if (!dt) return false;
      return dt >= start && dt <= end;
    });

    const total = inRange.length;
    let qualified = 0, qcRejected = 0, credited = 0, pending = 0;

    for (const l of inRange) {
      const status = this.getLeadStatusValue(l);
      if (this.isQualifiedStatus(status)) qualified++;
      else if (this.isRejectedStatus(status)) qcRejected++;
      else if (this.isCreditedStatus(status)) credited++;
      else pending++; 
    }

    const denom = qualified + credited;
    const cancelRate = denom > 0 ? Math.round((credited / denom) * 100) : 0;

    this.setMetricByLabel('TOTAL LEADS', String(total));
    this.setMetricByLabel('QUALIFIED', String(qualified));
    this.setMetricByLabel('QC REJECTED', String(qcRejected));
    this.setMetricByLabel('CREDITED', String(credited));
    this.setMetricByLabel('PENDING', String(pending));
    this.setMetricByLabel('CANCELLATION RATE', `${cancelRate}%`);
  }

  // ------------------------
  // ✅ AGENT DATA FETCHING
  // ------------------------
 async fetchAllData() {
  if (!this.currentUser) return;

  try {
    const timeframe = document.getElementById('timeframe-filter')?.value || 'this-week';

const customStart = document.getElementById('custom-start')?.value || null;
const customEnd = document.getElementById('custom-end')?.value || null;

const useCustom = customStart && customEnd;

if ((customStart && !customEnd) || (!customStart && customEnd)) {
  alert('Please select both start and end date.');
  return;
}
    const selectedStatus = document.getElementById('status-filter')?.value || 'all';

    // =========================
    // OVERVIEW
    // =========================
    const { data: overview, error: overviewError } = await this.supabase.rpc('get_my_agent_overview', {
  p_period: useCustom ? 'custom' : timeframe,
  p_custom_start: customStart,
  p_custom_end: customEnd
});

    if (overviewError) {
      console.error('❌ Agent overview load failed:', overviewError);
      return;
    }

    const ov = overview?.[0] || {};

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    };

    setText('stat-appointments', ov.total_appointments || 0);
    setText('stat-cancel-rate', `${ov.cancellation_rate || 0}%`);
    setText('stat-incentives', this.formatCurrency(ov.total_incentives ?? ov.auto_incentive_total ?? 0));
    setText('stat-hours', ov.hours_worked || 0);

    setText('monthly-incentive-status-ov', ov.monthly_incentive_status || 'Not qualified yet');
    setText('monthly-raffle-status-ov', ov.monthly_raffle_status || 'No raffle entry yet');

    // =========================
    // TIER PROGRESS
    // =========================
    const approvedCount = Number(ov.total_appointments || 0);
const cancelRate = Number(ov.cancellation_rate || 0);
const isHighPerf = approvedCount >= 6 && cancelRate < 25;
const percentage = approvedCount >= 6 ? 100 : Math.min(100, (approvedCount / 6) * 100);

setText('tier-count-display', `${approvedCount} qualified appointments`);
setText(
  'tier-status-text',
  approvedCount < 6
    ? 'Not yet on incentive tier'
    : (isHighPerf ? 'High Performance Tier' : 'Standard Tier')
);

const progressBar = document.getElementById('tier-progress-bar');
if (progressBar) progressBar.style.width = `${percentage}%`;

    // =========================
    // LEADS
    // =========================
    await this.loadAgentLeadsWithFilters();

    // =========================
    // PROFILE
    // =========================
    const { data: profile, error: profileError } = await this.supabase.rpc('get_my_agent_profile_snapshot');

    if (profileError) {
      console.error('❌ Agent profile load failed:', profileError);
    }

    const p = profile?.[0] || {};

    this.updateProfileUI({
  name: p.display_name,
  email: p.email,
  role: p.agent_position,
  employmentStatus: p.employment_status,
  baseRate: p.base_rate,
  weeklyHours: p.weekly_hours,
  startDate: p.start_date,
  avatar_url: p.avatar_url,
  monthlyIncentiveStatus: ov.monthly_incentive_status,
  raffleStatus: ov.monthly_raffle_status
});

    const navRoleEl = document.getElementById('nav-user-role');
    if (navRoleEl) navRoleEl.innerText = p.agent_position || 'Agent';

    // =========================
    // TRENDS
    // =========================
    const { data: trends, error: trendsError } = await this.supabase.rpc('get_my_agent_weekly_trends', {
  p_period: useCustom ? 'custom' : timeframe,
  p_custom_start: customStart,
  p_custom_end: customEnd
});

    if (trendsError) {
      console.error('❌ Agent trends load failed:', trendsError);
    }

    const labels = (trends || []).map(t => this.formatDate(t.week_start));
    const appts = (trends || []).map(t => t.approved_appointments);
    const earnings = (trends || []).map(t => t.incentive_amount);

    this.renderCharts({
      labels,
      appointments: appts,
      earnings
    });

    await this.loadAgentPayroll();

  } catch (err) {
    console.error('❌ Agent dashboard load failed:', err);
  }
}

  async loadAgentLeadsWithFilters() {
  const status = document.getElementById('status-filter')?.value || 'all';
  const timeframe = document.getElementById('leads-timeframe')?.value || 'this-week';
  const search = document.getElementById('leads-search')?.value || '';

  const start = document.getElementById('leads-start')?.value || null;
  const end = document.getElementById('leads-end')?.value || null;

  const useCustom = start && end;

  if ((start && !end) || (!start && end)) {
    alert('Select both start and end date.');
    return;
  }

  try {
    const { data: leads, error } = await this.supabase.rpc('get_my_agent_leads', {
      p_status: status,
      p_search: search,
      p_period: useCustom ? 'custom' : timeframe,
      p_custom_start: start,
      p_custom_end: end,
      p_limit: 200,
      p_offset: 0
    });

    if (error) {
      console.error('Leads filter error:', error);
      return;
    }

    const countEl = document.getElementById('leads-count-display');
if (countEl) {
  const count = (leads || []).length;
  countEl.innerText = `${count} lead${count === 1 ? '' : 's'}`;
}

    this.renderLeadsTable(
  (leads || []).map(l => ({
    date: l.date_submitted,
    homeowner: l.homeowner_names,
    status: l.status,
    feedback: l.feedback || l.rejection_reason || ''
  }))
);

  } catch (err) {
    console.error('Leads filter failed:', err);
  }
}

  updateAgentDashboard(data) {
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    };

    setText('stat-appointments', data.totalAppointments || 0);
    setText('stat-cancel-rate', (data.cancellationRate || 0) + '%');
    setText('stat-incentives', this.formatCurrency(data.totalIncentives || 0));
    setText('stat-hours', data.weeklyHours || 0);

    setText('monthly-incentive-status-ov', data.monthlyIncentiveStatus || 'Not qualified yet');
    setText('monthly-raffle-status-ov', data.raffleStatus || '0 / 4 weeks qualified');

    const tierCount = data.approvedAppointments || 0;
    const tierMax = 6; 
    const percentage = Math.min(100, (tierCount / tierMax) * 100);
      
    setText('tier-count-display', `${tierCount} / ${tierMax} approved appointments`);
    const progressBar = document.getElementById('tier-progress-bar');
    if (progressBar) progressBar.style.width = `${percentage}%`;
      
    const tierStatusText = document.getElementById('tier-status-text');
    if(tierStatusText) tierStatusText.innerText = 'Tier 1 Progress';
  }

  renderLeadsTable(leads) {
    const tbody = document.getElementById('leads-table-body');
    if (!tbody) return;

    if (leads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">No leads found for this period.</td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map(lead => {
      let badgeClass = 'bg-gray-100 text-gray-800';
      const status = (lead.status || 'Pending').toLowerCase();
      
      if (status.includes('confirm') || status.includes('approv')) badgeClass = 'bg-green-100 text-green-800';
      else if (status.includes('reject')) badgeClass = 'bg-red-100 text-red-800';
      else if (status.includes('pending')) badgeClass = 'bg-yellow-100 text-yellow-800';

      return `
  <tr>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.formatDate(lead.date)}</td>
    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${lead.homeowner || 'Unknown'}</td>
    <td class="px-6 py-4 whitespace-nowrap">
      <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${badgeClass}">
        ${lead.status || 'Pending'}
      </span>
    </td>
    <td class="px-6 py-4 text-sm text-gray-600">${lead.feedback || '—'}</td>
  </tr>
`;
    }).join('');
  }

  renderCharts(chartData) {
    const aptChartDom = document.getElementById('appointmentsChart');
    if (aptChartDom && window.echarts) {
      if (!this.charts) this.charts = {};
      this.charts.appointments = echarts.init(aptChartDom);
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: chartData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { type: 'value' },
        series: [{ data: chartData.appointments || [0, 0, 0, 0, 0], type: 'bar', itemStyle: { color: '#FBBF24' }, barWidth: '40%' }]
      };
      this.charts.appointments.setOption(option);
    }

    const incChartDom = document.getElementById('incentivesChart');
    if (incChartDom && window.echarts) {
      this.charts.incentives = echarts.init(incChartDom);
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: chartData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
        yAxis: { type: 'value' },
        series: [{ data: chartData.earnings || [0, 0, 0, 0, 0], type: 'line', smooth: true, lineStyle: { color: '#D97706', width: 3 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{offset: 0, color: 'rgba(251, 191, 36, 0.5)'}, {offset: 1, color: 'rgba(251, 191, 36, 0.01)'}]) } }]
      };
      this.charts.incentives.setOption(option);
    }
  }

 bindTeamLeaderboardsUI() {
  const buttons = document.querySelectorAll('[data-leaderboard-period]');
  const weekSelect = document.getElementById('leaderboard-week-select');
  const customWrap = document.getElementById('leaderboard-custom-wrap');
  const start = document.getElementById('leaderboard-start');
  const end = document.getElementById('leaderboard-end');

  if (!buttons.length || this._leaderboardBound) return;

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
     buttons.forEach(b => {
  b.classList.remove('bg-gray-900', 'text-white', 'border-yellow-400', 'bg-yellow-50', 'text-yellow-800');
  b.classList.add('bg-white', 'text-gray-700', 'border-gray-200');
});

btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200');
btn.classList.add('bg-yellow-50', 'text-yellow-800', 'border-yellow-400');

      const period = btn.dataset.leaderboardPeriod;

      if (weekSelect) weekSelect.classList.toggle('hidden', period !== 'selected-week');
      if (customWrap) customWrap.classList.toggle('hidden', period !== 'custom');

      await this.loadTeamLeaderboards();
    });
  });

  if (weekSelect) weekSelect.addEventListener('change', () => this.loadTeamLeaderboards());

  const maybeCustom = () => {
    if (start?.value && end?.value) this.loadTeamLeaderboards();
  };

  if (start) start.addEventListener('change', maybeCustom);
  if (end) end.addEventListener('change', maybeCustom);

  this._leaderboardBound = true;
  this.populateLeaderboardWeekSelect();
  this.loadTeamLeaderboards();
}

async populateLeaderboardWeekSelect() {
  const weekSelect = document.getElementById('leaderboard-week-select');
  if (!weekSelect || !this.supabase) return;

  const { data, error } = await this.supabase
    .from('payroll_weekly_fact_v2')
    .select('week_start, week_end')
    .order('week_start', { ascending: false });

  if (error) {
    console.error('Leaderboard week dropdown load failed:', error);
    return;
  }

  const seen = new Set();
  const weeks = [];

  (data || []).forEach(row => {
    const key = `${row.week_start}|${row.week_end}`;
    if (!row.week_start || !row.week_end || seen.has(key)) return;
    seen.add(key);
    weeks.push(row);
  });

  weekSelect.innerHTML = `
    <option value="">Select week</option>
    ${weeks.map(w => `<option value="${w.week_start}|${w.week_end}">${w.week_start} → ${w.week_end}</option>`).join('')}
  `;
}

async loadTeamLeaderboards() {
  const activeBtn = document.querySelector('[data-leaderboard-period].border-yellow-400');
  const weekSelect = document.getElementById('leaderboard-week-select');
  const startEl = document.getElementById('leaderboard-start');
  const endEl = document.getElementById('leaderboard-end');

  let period = activeBtn?.dataset.leaderboardPeriod || 'today';
  let customStart = null;
  let customEnd = null;

  if (period === 'selected-week') {
    const raw = weekSelect?.value || '';
    if (!raw.includes('|')) return;
    [customStart, customEnd] = raw.split('|');
    period = 'custom';
  }

  if (period === 'custom') {
    customStart = customStart || startEl?.value || null;
    customEnd = customEnd || endEl?.value || null;
    if (!customStart || !customEnd) return;
  }

  const { data, error } = await this.supabase.rpc('get_agent_team_leaderboard', {
    p_period: period,
    p_custom_start: customStart,
    p_custom_end: customEnd
  });

  if (error) {
    console.error('Team leaderboard load failed:', error);
    document.getElementById('team-leaderboard-body').innerHTML =
      `<tr><td colspan="8" class="p-6 text-center text-red-500">Leaderboard failed to load. Check console.</td></tr>`;
    return;
  }

  this.renderTeamLeaderboards(data || []);
}

  renderTeamLeaderboards(rows) {
  const body = document.getElementById('team-leaderboard-body');
  const highlights = document.getElementById('leaderboard-highlights');

  if (!body) return;

  const sorted = (Array.isArray(rows) ? rows : [])
    .map(r => ({
      agent_name: r.agent_name || 'Unknown',
      total_leads: Number(r.total_leads || 0),
      qc_rejected: Number(r.qc_rejected || 0),
      qualified_leads: Number(r.qualified_leads || 0),
      credited_leads: Number(r.credited_leads || 0),
      pending_leads: Number(r.pending_leads || 0),
      cancellation_rate: Number(r.cancellation_rate || 0),
      latest_highlight: r.latest_highlight || '',
      latest_highlight_date: r.latest_highlight_date || ''
    }))
    .filter(r => String(r.agent_name).trim().toLowerCase() !== 'call hammer leads')
    .sort((a, b) =>
      (b.qualified_leads - a.qualified_leads) ||
      (a.cancellation_rate - b.cancellation_rate) ||
      (b.total_leads - a.total_leads) ||
      (a.qc_rejected - b.qc_rejected) ||
      a.agent_name.localeCompare(b.agent_name)
    );

  let lastRank = 0;
  let lastQualified = null;
  let lastCancel = null;
  let lastTotal = null;
  let lastRejected = null;

  const ranked = sorted.map((a, index) => {
    const sameAsPrev =
      lastQualified === a.qualified_leads &&
      lastCancel === a.cancellation_rate &&
      lastTotal === a.total_leads &&
      lastRejected === a.qc_rejected;

    const rank = sameAsPrev ? lastRank : index + 1;

    lastRank = rank;
    lastQualified = a.qualified_leads;
    lastCancel = a.cancellation_rate;
    lastTotal = a.total_leads;
    lastRejected = a.qc_rejected;

    return { ...a, rank };
  });

  const placeLabel = (rank) => {
    if (rank === 1) return '🥇 Top 1';
    if (rank === 2) return '🥈 Top 2';
    if (rank === 3) return '🥉 Top 3';
    return `#${rank}`;
  };

  body.innerHTML = ranked.length ? ranked.map(r => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 font-black text-gray-900">${placeLabel(r.rank)}</td>
      <td class="px-6 py-4 font-bold text-gray-900">${r.agent_name}</td>
      <td class="px-6 py-4 text-center font-bold text-gray-700">${r.total_leads}</td>
      <td class="px-6 py-4 text-center font-bold text-red-500">${r.qc_rejected}</td>
      <td class="px-6 py-4 text-center font-black text-blue-600">${r.qualified_leads}</td>
      <td class="px-6 py-4 text-center font-bold text-purple-600">${r.credited_leads}</td>
      <td class="px-6 py-4 text-center font-bold text-yellow-600">${r.pending_leads}</td>
      <td class="px-6 py-4 text-center font-bold text-gray-700">${r.cancellation_rate}%</td>
    </tr>
  `).join('') : `
    <tr>
      <td colspan="8" class="p-6 text-center text-gray-400 italic">
        No leaderboard data found.
      </td>
    </tr>
  `;

  const highlighted = ranked.filter(r => r.latest_highlight).slice(0, 5);

  if (highlights) {
    highlights.innerHTML = highlighted.length ? highlighted.map(r => `
      <div class="rounded-2xl bg-white border border-yellow-100 p-4 shadow-sm">
        <div class="text-sm font-black text-gray-900">🎉 ${r.agent_name}</div>
        <div class="text-sm text-gray-700 mt-1">${r.latest_highlight}</div>
        <div class="text-xs text-gray-400 mt-2">${r.latest_highlight_date || ''}</div>
      </div>
    `).join('') : `
      <div class="text-sm text-gray-400 italic">
        No highlighted feedback for this timeframe yet.
      </div>
    `;
  }
}

  async loadTimeOffHistory() {
 const { data, error } = await this.supabase
  .from('time_off_requests')
  .select('*')
  .eq('requester_profile_id', this.currentUser.id)
  .order('created_at', { ascending: false });

if (error) {
  console.error('Time off history load failed:', error);
  return;
}

  const container = document.getElementById('timeoff-history-list');

  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = `<p class="text-xs text-gray-400 italic">No history found.</p>`;
    return;
  }

  container.innerHTML = data.map(r => `
    <div class="text-xs border p-2 rounded">
      <div class="font-bold">${r.reason}</div>
      <div>${r.start_date} → ${r.end_date}</div>
      <div class="text-gray-400">${r.status}</div>
    </div>
  `).join('');
}

  updateProfileUI(profile) {
  if (!profile) return;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val ?? '—';
  };

  setText('nav-user-name', profile.name || this.currentUser.name);
  setText('profile-full-name', profile.name);
  setText('profile-email', profile.email);
  setText('profile-position', profile.role || 'Agent');
  setText('profile-employment-status', profile.employmentStatus || 'Active');
  setText('profile-base-rate', this.formatCurrency(profile.baseRate || 0));
  setText('profile-weekly-hours', profile.weeklyHours || 0);
  setText('profile-start-date', profile.startDate || '—');

  const avatarEl = document.getElementById('profile-avatar-preview');
  if (avatarEl) {
    avatarEl.src = profile.avatar_url || 'https://placehold.co/200x200?text=Avatar';
  }

  setText('monthly-incentive-status-prof', profile.monthlyIncentiveStatus || 'Not qualified yet');
  setText('monthly-raffle-status-prof', profile.raffleStatus || 'No raffle entry yet');
}

formatDate(dateString) {
  if (!dateString) return '-';

  const raw = String(dateString).trim();

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const safeDate = new Date(y, m, d, 12, 0, 0);
    return safeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const date = new Date(raw);
  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
  getAgentPayrollRange() {
  const timeframe = document.getElementById('payroll-timeframe')?.value || '4-weeks';
  const customStart = document.getElementById('payroll-start')?.value || null;
  const customEnd = document.getElementById('payroll-end')?.value || null;

  if ((customStart && !customEnd) || (!customStart && customEnd)) {
    alert('Please select both payroll start and end date.');
    return null;
  }

  const today = new Date();
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  if (customStart && customEnd) {
    return {
      start: customStart,
      end: customEnd
    };
  }

  let start;
  let end = endOfDay(today);

  switch (timeframe) {
    case 'today':
      start = startOfDay(today);
      break;
    case 'this-week': {
  const week = this.getPayrollWeekRange(today);
  start = week.start;
  end = week.end;
  break;
}
case 'previous-week': {
  const prevWeek = this.getPreviousPayrollWeekRange(today);
  start = prevWeek.start;
  end = prevWeek.end;
  break;
}
    case '30-days':
      start = addDays(startOfDay(today), -30);
      break;
    case '4-weeks':
      start = addDays(startOfDay(today), -28);
      break;
    case '6-weeks':
      start = addDays(startOfDay(today), -42);
      break;
    case 'all-time':
      start = new Date(2000, 0, 1);
      break;
    default:
      start = addDays(startOfDay(today), -28);
      break;
  }

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0]
  };
}

async loadAgentPayroll() {
  if (!this.currentUser?.email || !this.supabase) return;

  const range = this.getAgentPayrollRange();
  if (!range) return;

  try {
    const { data: weeklyRows, error: weeklyError } = await this.supabase
      .from('payroll_weekly_fact_v2')
      .select('*')
      .eq('worker_email', this.currentUser.email)
      .gte('week_start', range.start)
      .lte('week_start', range.end)
      .order('week_start', { ascending: false });

    if (weeklyError) {
      console.error('❌ Agent weekly payroll load failed:', weeklyError);
      return;
    }

    const weekly = weeklyRows || [];

    const totalHours = weekly.reduce((sum, row) => sum + this.toNumberSafe(row.adjusted_hours, 0), 0);
    const totalBonus = weekly.reduce((sum, row) => sum + this.toNumberSafe(row.auto_incentive_delta, 0), 0);
    const totalFinalPay = weekly.reduce((sum, row) => sum + this.toNumberSafe(row.final_pay, 0), 0);

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    };

    setText('payroll-week-count', weekly.length);
    setText('payroll-total-hours', totalHours.toFixed(2));
    setText('payroll-total-bonus', this.formatCurrency(totalBonus));
    setText('payroll-final-pay', this.formatCurrency(totalFinalPay));

    this.renderAgentPayrollWeekly(weekly);

    // Daily logs fallback-safe
    let dailyRows = [];
    try {
      const { data: dailyData, error: dailyError } = await this.supabase
        .from('payroll_daily_hours_view')
        .select('*')
        .eq('worker_email', this.currentUser.email)
        .gte('work_date', range.start)
        .lte('work_date', range.end)
        .order('work_date', { ascending: false });

      if (!dailyError) {
        dailyRows = dailyData || [];
      } else {
        console.warn('⚠️ Daily payroll view not loaded:', dailyError);
      }
    } catch (dailyErr) {
      console.warn('⚠️ Daily payroll fetch skipped:', dailyErr);
    }

    this.renderAgentPayrollDaily(dailyRows);

  } catch (err) {
    console.error('❌ Agent payroll load crashed:', err);
  }
}

renderAgentPayrollWeekly(rows) {
  const tbody = document.getElementById('payroll-weekly-body');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-4 text-sm text-gray-400 italic">No payroll records found for this range.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const approved = this.toNumberSafe(row.approved_leads, 0);
    const rejected = this.toNumberSafe(row.rejected_leads, 0);
    const total = this.toNumberSafe(row.total_leads, 0);
    const credited = row.credited_leads !== undefined && row.credited_leads !== null
  ? this.toNumberSafe(row.credited_leads, 0)
  : Math.max(0, total - approved - rejected);
    const paidBadge = row.is_paid
      ? '<span class="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Paid</span>'
      : '<span class="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">Unpaid</span>';

    return `
      <tr class="border-b border-gray-100">
        <td class="py-3 pr-4 font-medium text-gray-900">${this.formatDate(row.week_start)} - ${this.formatDate(row.week_end)}</td>
        <td class="py-3 pr-4 text-gray-700">${this.toNumberSafe(row.adjusted_hours, 0).toFixed(2)}</td>
        <td class="py-3 pr-4 text-gray-700">${approved}</td>
        <td class="py-3 pr-4 text-gray-700">${rejected}</td>
        <td class="py-3 pr-4 text-gray-700">${credited}</td>
        <td class="py-3 pr-4 text-yellow-700 font-bold">${this.formatCurrency(row.auto_incentive_delta || 0)}</td>
        <td class="py-3 pr-4 text-blue-700 font-bold">${this.formatCurrency(row.manual_incentive_delta || 0)}</td>
        <td class="py-3 pr-4 text-green-700 font-bold">${this.formatCurrency(row.final_pay || 0)}</td>
        <td class="py-3 pr-4">${paidBadge}</td>
      </tr>
    `;
  }).join('');
}

renderAgentPayrollDaily(rows) {
  const tbody = document.getElementById('payroll-daily-body');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-4 text-sm text-gray-400 italic">No daily time logs found for this range.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const workDate = this.getAny(row, ['work_date', 'date', 'day'], '');
    const firstIn = this.getAny(row, ['first_in', 'first_clock_in', 'clock_in_at'], '—');
    const lastOut = this.getAny(row, ['last_out', 'last_clock_out', 'clock_out_at'], '—');
    const hours = this.toNumberSafe(this.getAny(row, ['total_hours', 'hours_worked', 'hours'], 0), 0);
    const sessions = this.toNumberSafe(this.getAny(row, ['sessions', 'session_count'], 0), 0);

    return `
      <tr class="border-b border-gray-100">
        <td class="py-3 pr-4 font-medium text-gray-900">${this.formatDate(workDate)}</td>
        <td class="py-3 pr-4 text-gray-700">${firstIn || '—'}</td>
        <td class="py-3 pr-4 text-gray-700">${lastOut || '—'}</td>
        <td class="py-3 pr-4 text-gray-700">${hours.toFixed(2)}</td>
        <td class="py-3 pr-4 text-gray-700">${sessions}</td>
      </tr>
    `;
  }).join('');
}

    // ------------------------
  // ✅ COMMAND CENTER HELPERS
  // ------------------------
  getCurrentOrganizationId() {
    return this.currentUser?.organization_id || null;
  }

  getCurrentProfileId() {
    return this.currentUser?.id || null;
  }

  buildFieldChanges(oldObj = {}, newObj = {}, allowedKeys = []) {
    const changes = [];

    for (const key of allowedKeys) {
      const oldVal = oldObj?.[key] ?? null;
      const newVal = newObj?.[key] ?? null;

      const oldStr = oldVal === null ? null : String(oldVal);
      const newStr = newVal === null ? null : String(newVal);

      if (oldStr !== newStr) {
        changes.push({
          field: key,
          old_value: oldVal,
          new_value: newVal
        });
      }
    }

    return changes;
  }

      async createCommandCenterEvent({
    moduleKey,
    entityType,
    entityId,
    entityCode = null,
    entityLabel = null,
    eventType = 'updated',
    summaryText = '',
    fieldChanges = [],
    oldData = null,
    newData = null,
    severity = 'normal',
    teamKeys = ['admin_management']
  }) {
    if (!supaClient) {
      console.warn('Command center event skipped: supaClient missing.');
      return null;
    }

    const organizationId = this.getCurrentOrganizationId();
    if (!organizationId) {
      console.warn('Command center event skipped: organization_id missing.');
      return null;
    }

    try {
      const { data, error } = await supaClient.rpc('command_center_create_event', {
        p_organization_id: organizationId,
        p_module_key: moduleKey,
        p_entity_type: entityType,
        p_entity_id: String(entityId || ''),
        p_entity_code: entityCode,
        p_entity_label: entityLabel,
        p_event_type: eventType,
        p_summary_text: summaryText,
        p_field_changes: fieldChanges || [],
        p_old_data: oldData,
        p_new_data: newData,
        p_severity: severity,
        p_team_keys: teamKeys
      });

      if (error) {
  console.error('❌ command_center_create_event failed:', error);

  const { data: fallbackEvent, error: fallbackError } = await supaClient
    .from('command_center_events')
    .insert([{
      organization_id: organizationId,
      module_key: moduleKey,
      entity_type: entityType,
      entity_id: String(entityId || ''),
      entity_code: entityCode,
      entity_label: entityLabel,
      event_type: eventType,
      summary_text: summaryText,
      field_changes: fieldChanges || [],
      old_data: oldData,
      new_data: newData,
      actor_profile_id: this.currentUser?.id || null,
      actor_name: this.currentUser?.name || this.currentUser?.email || 'Unknown',
      actor_role: this.currentUser?.role || null,
      severity,
      is_system_event: false,
      is_archived: false
    }])
    .select('id')
    .single();

  if (fallbackError) {
    console.error('❌ fallback command_center_events insert failed:', fallbackError);
    return null;
  }

  return fallbackEvent?.id || null;
}

if (data) return data;

console.warn("command_center_create_event returned no event id. Running fallback insert.");

const { data: fallbackEvent2, error: fallbackError2 } = await supaClient
  .from('command_center_events')
  .insert([{
    organization_id: organizationId,
    module_key: moduleKey,
    entity_type: entityType,
    entity_id: String(entityId || ''),
    entity_code: entityCode,
    entity_label: entityLabel,
    event_type: eventType,
    summary_text: summaryText,
    field_changes: fieldChanges || [],
    old_data: oldData,
    new_data: newData,
    actor_profile_id: this.currentUser?.id || null,
    actor_name: this.currentUser?.name || this.currentUser?.email || 'Unknown',
    actor_role: this.currentUser?.role || null,
    severity,
    is_system_event: false,
    is_archived: false
  }])
  .select('id')
  .single();

if (fallbackError2) {
  console.error('❌ fallback command_center_events insert failed after empty RPC:', fallbackError2);
  return null;
}

return fallbackEvent2?.id || null;
    } catch (err) {
      console.error('❌ createCommandCenterEvent exception:', err);
      return null;
    }
  }

 getPassbookTeamKeys(clientRow = {}, updates = {}) {
  const role = String(this.currentUser?.role || "").toLowerCase();

  // Sales + Sales Rep changes should notify Admin.
  if (
    role === "sales" ||
    role === "sales_rep" ||
    role === "team_leader" ||
    role === "team leader" ||
    role === "tl"
  ) {
    return ["admin_management"];
  }

  // Admin / Management changes should notify Sales.
  if (role === "admin" || role === "management") {
    return ["sales"];
  }

  return ["admin_management"];
}

  getPassbookTrackedFields() {
    return [
      'client_code',
      'company_name',
      'phone',
      'contact_person',
      'area',
      'area_codes_to_use',
      'email',
      'website',
      'client_status',
      'company_address',
      'sales_rep_count',
      'regions',
      'days_of_operation',
      'hours_of_operation',
      'appointment_interval',
      'roof_types',
      'leads_per_day_limit',
      'double_bookings',
      'additional_notes',
      'shared_with_sales',
      'is_serving',
      'daily_agents',
      'daily_goal'
    ];
  }

  getOnboardingTrackedFields() {
    return [
      'client_paid',
      'contract_sent',
      'contract_completed',
      'onboarding_link_sent',
      'onboarding_link_completed',
      'ghl_account_created',
      'client_portal_created',
      'live_lead_tracker_created',
      'client_portal_demo_completed',
      'ready_to_receive_leads',
      'notes'
    ];
  }

  // ------------------------
  // ✅ ADMIN: Fetch + Normalize
  // ------------------------
async fetchAdminData(forceRefresh = false) {
    if (this._adminFetchInFlight) {
      console.log('Admin data fetch skipped: another refresh is already running.');
      return this.adminState;
    }

    this._adminFetchInFlight = true;
    try {
      console.log('📡 Fetching Master Data...');
      const response = await fetch(this.webhooks.fetchAdminData);
      const result = await response.json();
      const dataRoot = result?.data || result || {};

      let supaLeads = [],
    supaPackages = [],
    supaClients = [],
    supaTime = [],
    supaAgents = [],
    supaClientHealth = [],
    supaAgentPerformance = [],
    supaClientPackageStatus = [],
    supaClientPackageAllocation = [],
    supaProfiles = [],
    supaAgentCurrentRates = [],
    supaPayrollWeeklyFactView = [],
    supaPayrollWorkers = [],
    supaClientOnboarding = [],
    supaHRTrainingPerformance = [],
    supaHRTrainingGroups = [],
supaPayrollConsistencyBonusStatus = [];

// ==========================================
// PAYROLL INITIAL LOAD RANGE
// Current payroll week + previous 3 weeks
// ==========================================
const payrollCurrentWeekStart = this.getPayrollWeekStart(new Date());

const payrollFourWeekStart = new Date(payrollCurrentWeekStart);
payrollFourWeekStart.setDate(payrollFourWeekStart.getDate() - 21);

const formatPayrollDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
};

const payrollCurrentWeekKey =
  formatPayrollDateKey(payrollCurrentWeekStart);

const payrollFourWeekStartKey =
  formatPayrollDateKey(payrollFourWeekStart);

console.log(
  'Loading initial payroll range:',
  payrollFourWeekStartKey,
  '→',
  payrollCurrentWeekKey
);

if (supaClient) {
  const [
  lRes,
  pRes,
  cRes,
  tRes,
  aRes,
  chRes,
  apRes,
  cpsRes,
  cpaRes,
  profRes,
  acrRes,
  pwfRes,
  pwwRes,
  coRes,
  hrPerfRes,
  hrGroupRes,
consistencyBonusRes
] = await Promise.all([
  supaClient.from('leads_raw').select('*'),
  supaClient.from('sales_pipeline_financials_view').select('*'),
  supaClient.from('clients').select('*'),
  supaClient.from('time_events').select('*'),
  supaClient.from('agents').select('*'),
  supaClient.from('client_health_view').select('*'),
  supaClient.from('agent_performance_view').select('*'),
  supaClient.from('client_package_status_view').select('*'),
  supaClient.from('client_package_allocation_view').select('*'),
  supaClient.from('profiles').select('*'),
  supaClient.from('agent_current_rate_view').select('*'),

    //payroll 3 weeks only
  supaClient
  .from('payroll_weekly_fact_v2')
  .select('*')
  .gte('week_start', payrollFourWeekStartKey)
  .lte('week_start', payrollCurrentWeekKey)
  .order('week_start', { ascending: false }),
  supaClient.from('payroll_workers').select('*'),
  supaClient.from('client_onboarding').select('*'),
  supaClient.from('hr_training_group_performance_v2').select('*'),
  supaClient.from('hr_training_group_summary_v2').select('*'),
supaClient.from('payroll_consistency_bonus_status_view').select('*')
]);

  console.log('pwfRes error:', pwfRes.error);
console.log('pwwRes error:', pwwRes.error);
console.log('pwfRes rows:', pwfRes.data?.length || 0);
console.log('pwwRes rows:', pwwRes.data?.length || 0);

  supaLeads = lRes.data || [];
  supaPackages = pRes.data || [];
  supaClients = cRes.data || [];
  supaTime = tRes.data || [];
  supaAgents = aRes.data || [];
  supaClientHealth = chRes.data || [];
  supaAgentPerformance = apRes.data || [];
  supaClientPackageStatus = cpsRes.data || [];
  supaClientPackageAllocation = cpaRes.data || [];
  supaProfiles = profRes.data || [];
   supaAgentCurrentRates = acrRes.data || [];

  if (pwfRes.error) {
    console.error('Payroll weekly fact load failed; keeping last good payroll rows:', pwfRes.error);
    supaPayrollWeeklyFactView = Array.isArray(this.adminState.payrollWeeklyFactView)
      ? this.adminState.payrollWeeklyFactView
      : [];
    this.adminState.payrollFetchError = pwfRes.error;
  } else {
    supaPayrollWeeklyFactView = pwfRes.data || [];
    this.adminState.payrollFetchError = null;
  }

  if (pwwRes.error) {
    console.error('Payroll workers load failed; keeping last good worker rows:', pwwRes.error);
    supaPayrollWorkers = Array.isArray(this.adminState.payrollWorkers)
      ? this.adminState.payrollWorkers
      : [];
  } else {
    supaPayrollWorkers = pwwRes.data || [];
  }

supaClientOnboarding = coRes.data || [];
supaHRTrainingPerformance = hrPerfRes.data || [];
supaHRTrainingGroups = hrGroupRes.data || [];
  supaPayrollConsistencyBonusStatus = consistencyBonusRes.error
    ? (Array.isArray(this.adminState.payrollConsistencyBonusStatus) ? this.adminState.payrollConsistencyBonusStatus : [])
    : (consistencyBonusRes.data || []);
}
      
      this.adminState.rawClients = supaClients.length > 0 ? supaClients : (dataRoot.clients || []);
this.adminState.leads = supaLeads.length > 0 ? supaLeads : (dataRoot.leads || []);
this.adminState.packages = supaPackages.length > 0 ? supaPackages : (dataRoot.packages || []);
this.adminState.timeEvents = supaTime;
this.adminState.agents = supaAgents.length > 0 ? supaAgents : (dataRoot.agents || []);
this.adminState.rawProfiles = supaProfiles || [];
this.adminState.agentCurrentRates = supaAgentCurrentRates || [];
// Merge refreshed recent payroll with any historical weeks
// that were lazy-loaded earlier.
const existingPayrollRows = Array.isArray(this.adminState.payrollWeeklyFactView)
  ? this.adminState.payrollWeeklyFactView
  : [];

const payrollRowKey = (row) => {
  const week =
    row.week_id ||
    row.week_start ||
    '';

  const worker =
    row.worker_id ||
    row.agent_id ||
    row.worker_email ||
    row.agent_email ||
    row.worker_name ||
    row.agent_name ||
    '';

  return `${String(week)}|${String(worker)}`;
};

const payrollRowMap = new Map(
  existingPayrollRows.map(row => [
    payrollRowKey(row),
    row
  ])
);

// Fresh current 4 weeks overwrite cached copies
(supaPayrollWeeklyFactView || []).forEach(row => {
  payrollRowMap.set(
    payrollRowKey(row),
    row
  );
});

this.adminState.payrollWeeklyFactView =
  Array.from(payrollRowMap.values());
this.adminState.payrollWorkers = supaPayrollWorkers || [];
this.adminState.clientOnboarding = supaClientOnboarding || [];

/* temporary backward compatibility */
this.adminState.weeklyPayroll =
  this.adminState.payrollWeeklyFactView;

this.adminState.clientHealthView = supaClientHealth;
this.adminState.agentPerformanceView = supaAgentPerformance;
this.adminState.clientPackageStatusView = supaClientPackageStatus;
this.adminState.clientPackageAllocationView = supaClientPackageAllocation;
this.adminState.hrTrainingPerformance = supaHRTrainingPerformance;
this.adminState.hrTrainingGroups = supaHRTrainingGroups;
this.adminState.payrollConsistencyBonusStatus = supaPayrollConsistencyBonusStatus;

      console.log('clientPackageStatusView rows:', this.adminState.clientPackageStatusView.length);

if (this.adminState.clientHealthView.length > 0) {
  this.normalizeAdminFromHealthMonitor(this.adminState.clientHealthView);
} else {
  this.adminState.clients = this.adminState.rawClients;
}
      const arrowheadDebug = this.adminState.clientHealthView.find(
  x => String(x.company_name || '').toLowerCase().includes('arrowhead')
);
      console.log('DEBUG clientHealthView Arrowhead:', arrowheadDebug);

      console.log('clientHealthView rows:', this.adminState.clientHealthView.length);
      console.log('agentPerformanceView rows:', this.adminState.agentPerformanceView.length);
      console.log('clientPackageAllocationView rows:', this.adminState.clientPackageAllocationView.length);
      console.log('payrollWeeklyFactView rows:', this.adminState.payrollWeeklyFactView.length);
      console.log('payrollWorkers rows:', this.adminState.payrollWorkers.length);

      this.triggerAdminRefresh();
       } catch (err) {
      console.error('❌ fetchAdminData failed:', err);
    } finally {
      this._adminFetchInFlight = false;
    }
  }

  triggerAdminRefresh() {
  console.log('triggerAdminRefresh called');
  console.log('window.adminDashboard exists:', !!window.adminDashboard);
  console.log('window.Admin exists:', !!window.Admin);

  if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
    console.log('Refreshing via window.adminDashboard.refreshDashboard()');
    window.adminDashboard.refreshDashboard();
    return;
  }

  if (window.Admin && typeof window.Admin.refreshDashboard === 'function') {
    console.log('Refreshing via window.Admin.refreshDashboard()');
    window.Admin.refreshDashboard();
    return;
  }

  console.warn('No admin refresh handler found.');
}

  normalizeAdminFromHealthMonitor(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const rawClients = Array.isArray(this.adminState.rawClients) ? this.adminState.rawClients : [];

  const normalizeKey = (v) => String(v || '').trim().toLowerCase();

  const rawByCode = new Map();
  const rawByCompany = new Map();

  rawClients.forEach(c => {
    const code = normalizeKey(this.getAny(c, ['client_code', 'code_name', 'codeName', 'CODE NAME', 'CODE', 'code'], ''));
    const company = normalizeKey(this.getAny(c, ['company_name', 'roofing_company', 'Roofing Company', 'Company Name', 'COMPANY NAME'], ''));

    if (code) rawByCode.set(code, c);
    if (company) rawByCompany.set(company, c);
  });

  this.adminState.clients = list.map(r => {
    const status = this.getAny(r, ['client_status', 'status', 'Client Status', 'CLIENT STATUS'], 'NOT STARTED');
    const codeName = this.getAny(r, ['client_code', 'code_name', 'codeName', 'CODE NAME', 'CODE', 'code'], 'N/A');
    const roofingCompany = this.getAny(r, ['company_name', 'roofing_company', 'Roofing Company', 'Roofing Company Name', 'Company Name', 'COMPANY NAME'], '—');

    const matchedRaw =
      rawByCode.get(normalizeKey(codeName)) ||
      rawByCompany.get(normalizeKey(roofingCompany)) ||
      {};

    const cityState = this.getAny(
      r,
      ['area', 'city_state', 'CITY STATE', 'City State', 'location', 'Location'],
      this.getAny(matchedRaw, ['area', 'city_state', 'CITY STATE', 'City State', 'location', 'Location'], '—')
    );

    const clientName = this.getAny(
      r,
      ['client_name', 'CLIENT NAME', 'Client Name', 'contact_person', 'Contact Person'],
      this.getAny(matchedRaw, ['client_name', 'CLIENT NAME', 'Client Name', 'contact_person', 'Contact Person'], '—')
    );

    const lastLeadReceived = this.getAny(r, ['last_lead_received', 'Last Lead Received'], '');
    const hoursSinceLastLead = 0;
    const leadsToday = this.toNumberSafe(this.getAny(r, ['leads_today', 'Leads Today'], 0), 0);
    const leadsYesterday = this.toNumberSafe(this.getAny(r, ['leads_yesterday', 'Leads Yesterday'], 0), 0);
    const purchasedLeads = this.toNumberSafe(this.getAny(r, ['purchased_leads', 'Purchased Leads'], 0), 0);
    const owedLeads = this.toNumberSafe(this.getAny(r, ['owed_leads', 'Owed Leads'], 0), 0);
    const packageStatus = this.getAny(r, ['package_status', 'Package Status'], '');
    const purchaseDate = this.getAny(r, ['purchase_date', 'Purchase Date'], '');

        return {
      status,
      client_status: status,
      code_name: codeName,
      client_code: codeName,
      roofing_company: roofingCompany,
      company_name: roofingCompany,
      city_state: cityState,
      area: cityState,
      client_name: clientName,
      contact_person: clientName,
      shared_with_sales: this.getAny(
        matchedRaw,
        ['shared_with_sales', 'share_with_sales', 'Shared With Sales', 'shared with sales'],
        false
      ),
      last_lead_received: lastLeadReceived,
      hours_since_last_lead: hoursSinceLastLead,
      leads_today: leadsToday,
      leads_yesterday: leadsYesterday,
      purchased_leads: purchasedLeads,
      owed_leads: owedLeads,
      package_status: packageStatus,
      purchase_date: purchaseDate,
    };
  });
}

  normalizeAdminData(rawClients, rawLeads, rawAgents, rawStatuses, rawPackages) {
    this.adminState.rawStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    this.adminState.rawPackages = Array.isArray(rawPackages) ? rawPackages : [];
    this.adminState.leads = Array.isArray(rawLeads) ? rawLeads : [];
    this.adminState.agents = Array.isArray(rawAgents) ? rawAgents : [];

    const clientsArr = Array.isArray(rawClients) ? rawClients : [];
    this.adminState.clients = clientsArr.map(c => ({
      status: this.getAny(c, ['STATUS', 'Status', 'Client Status', 'CLIENT STATUS'], 'NOT STARTED'),
      code_name: this.getAny(c, ['CODE NAME', 'Code Name', 'CODE', 'Client Code'], 'N/A'),
      roofing_company: this.getAny(c, ['COMPANY NAME', 'Company Name', 'Roofing Company'], '—'),
      city_state: this.getAny(c, ['area', 'city_state', 'CITY STATE', 'City State', 'Location'], '—'),
      client_name: this.getAny(c, ['client_name', 'CLIENT NAME', 'Client Name', 'contact_person', 'Contact Person'], '—'),
      last_lead_received: '', hours_since_last_lead: 0, leads_today: 0, leads_yesterday: 0,
      purchased_leads: 0, owed_leads: 0, package_status: '', purchase_date: ''
    }));
  }

  // ==========================================
  // ✅ PASSBOOK & PAYROLL LOADING
  // ==========================================
  async loadPassbookClientsList(force = false) {
    try {
      const url = new URL(this.webhooks.passbookClientsList);
      url.searchParams.set('ts', Date.now());

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Passbook list failed (HTTP ${res.status}).`);

      const data = await res.json();
      const clients = data?.clients || data?.data?.clients || data?.data || [];

      const countEl = document.querySelector('#passbookClientsCount');
      if (countEl) countEl.textContent = `Showing ${clients.length} clients`;

      this.adminState.passbookClients = clients;
      return clients;
    } catch (e) {
      console.error('❌ loadPassbookClientsList error:', e);
      return [];
    }
  }
  
  async loadPayrollData(force = false) {
    try {
      const url = new URL(this.webhooks.payrollData);
      url.searchParams.set('ts', Date.now());

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Payroll data failed (HTTP ${res.status}).`);

      const json = await res.json();
      const root = json?.data || json || {};

      const weeklyPayroll = root.weeklyPayroll || root.weekly_payroll || root.weekly || [];
      const payrollHistory = root.payrollHistory || root.payroll_history || root.history || [];

      this.weeklyPayroll = Array.isArray(weeklyPayroll) ? weeklyPayroll : [];
      this.timeTracker = Array.isArray(root.timeTracker || root.time_tracker) ? (root.timeTracker || root.time_tracker) : [];

      this.adminState.weeklyPayroll = this.weeklyPayroll;
      this.adminState.payrollHistory = Array.isArray(payrollHistory) ? payrollHistory : [];

      return this.adminState;
    } catch (e) {
      console.error('❌ loadPayrollData error:', e);
      this.adminState.weeklyPayroll = [];
      this.adminState.payrollHistory = [];
      return this.adminState;
    }
  }

  bindPassbookUpdateButton() {
    const btn =
      document.querySelector('#passbookSaveButton') ||
      document.querySelector('#saveClientButton') ||
      document.querySelector('button[data-action="passbook-save"]') ||
      document.querySelector('button[data-action="save-client"]') ||
      document.querySelector('button[data-passbook-save="true"]');

    const form =
      document.querySelector('#passbookClientForm') ||
      document.querySelector('form[data-passbook-form="client"]') ||
      document.querySelector('form[data-form="passbook-client"]');

    if (!btn && !form) return;

    const handler = async (e) => {
      if (e) e.preventDefault();

      try {
        const payload = this.collectPassbookUpdatePayloadFromForm(form || document);
        if (!payload.codeName) {
          alert('Missing client code. Please reload the client details and try again.');
          return;
        }

        if (!payload.updates || Object.keys(payload.updates).length === 0) {
          alert('No fields detected to update.');
          return;
        }

        await this.submitPassbookClientUpdate(payload);
        await this.refreshPassbookClientDetails(payload.codeName);
        alert('Client updated successfully.');
      } catch (err) {
        console.error('❌ Passbook update failed:', err);
        alert(err?.message || 'Update failed. Please try again.');
      }
    };

    if (btn) {
  btn.onclick = null;
  btn.onclick = handler;
}

if (form) {
  form.onsubmit = null;
  form.onsubmit = handler;
    } 
  }

  collectPassbookUpdatePayloadFromForm(rootEl) {
    const root = rootEl || document;
    // We grab the ORIGINAL code from the hidden input before it was changed
    const originalCodeName = (root.querySelector('#codeName')?.value || '').trim();
    const updates = {};
    
    const fields = Array.from(root.querySelectorAll('#passbook-form-body input[name], #passbook-form-body textarea[name]'));
    for (const el of fields) {
      const name = el.getAttribute('name');
      if (name) { 
          updates[name] = el.value;
      }
    }
    
    // FIXED: We return BOTH names so it passes the hidden validation check!
    return { codeName: originalCodeName, originalCodeName, updates };
  }

    async submitPassbookClientUpdate(payload) {
    if (typeof supaClient === 'undefined' || !supaClient) throw new Error("Database connection missing.");

    const newClientCode = payload.updates['client_code'];
    const originalCode = payload.originalCodeName || payload.codeName;

    // 1. Load old row first for diff tracking
    const { data: existingClient, error: fetchErr } = await supaClient
      .from('clients')
      .select('*')
      .eq('client_code', originalCode)
      .single();

    if (fetchErr) {
      console.error("Failed to fetch existing client before update:", fetchErr);
      throw new Error(fetchErr.message || "Failed to load existing client before update.");
    }

    // 2. Update client profile
    const { error } = await supaClient
      .from('clients')
      .update(payload.updates)
      .eq('client_code', originalCode);

    if (error) {
      console.error("Supabase Update Error:", error);
      if (error.code === 'PGRST204' || error.message.includes('column')) {
        throw new Error("One of the form fields is missing a matching column in your Supabase table!");
      }
      throw new Error(error.message || "Failed to update client in database.");
    }

    // 3. If client code changed, sync packages too
    if (newClientCode && newClientCode !== originalCode) {
      const { error: pkgErr } = await supaClient
        .from('packages')
        .update({ client_code: newClientCode })
        .eq('client_code', originalCode);

      if (pkgErr) console.error("Failed to update related sales packages:", pkgErr);
    }

    // 4. Read fresh row after update
    const finalClientCode = newClientCode || originalCode;
    const { data: updatedClient, error: updatedFetchErr } = await supaClient
      .from('clients')
      .select('*')
      .eq('client_code', finalClientCode)
      .single();

    if (updatedFetchErr) {
      console.error("Failed to fetch updated client after save:", updatedFetchErr);
    }

    const oldRow = existingClient || {};
    const newRow = updatedClient || { ...oldRow, ...payload.updates };

    const trackedFields = this.getPassbookTrackedFields();
    const fieldChanges = this.buildFieldChanges(oldRow, newRow, trackedFields);

    if (fieldChanges.length > 0) {
      const eventId = await this.createCommandCenterEvent({
        moduleKey: 'passbook_clients',
        entityType: 'client',
        entityId: String(newRow.id || oldRow.id || finalClientCode),
        entityCode: newRow.client_code || finalClientCode,
        entityLabel: newRow.company_name || oldRow.company_name || finalClientCode,
        eventType: 'updated',
        summaryText: `${this.currentUser?.name || 'User'} updated passbook client ${newRow.company_name || finalClientCode}.`,
        fieldChanges,
        oldData: oldRow,
        newData: newRow,
        severity: 'normal',
        teamKeys: this.getPassbookTeamKeys(oldRow, newRow)
            });

      if (eventId) {
        const { error: teamStateError } = await supaClient
          .from('command_center_team_state')
          .upsert(
            [{
              event_id: eventId,
              organization_id: this.getCurrentOrganizationId(),
              team_key: 'admin_management',
              is_unread: true,
              is_reviewed: false,
              status: 'new'
            }],
            { onConflict: 'event_id,team_key' }
          );

        if (teamStateError) {
          console.error("Passbook notification team_state insert failed:", teamStateError);
        }
      }

      if (!eventId) {
  console.error("Passbook update saved, but notification event was not created.", {
    finalClientCode,
    fieldChanges,
    actor: this.currentUser
  });

  alert("Client saved, but the admin notification was not created. Check console.");
}
    }

    // 5. Refresh dashboard views
    if (window.portal && typeof window.portal.fetchAdminData === 'function') {
      window.portal.fetchAdminData(true);
    }
    if (typeof fetchAdminClients === 'function') {
      fetchAdminClients('All');
    }

    return { success: true };
  }

  async refreshPassbookClientDetails(codeName) {
    // Because we use Supabase now, we can just call the read function again to instantly show the new data!
    if (window.Admin && typeof window.Admin._fetchAndRenderPassbookClient === 'function') {
        await window.Admin._fetchAndRenderPassbookClient(codeName);
    }
  }

  startAdminAutoRefresh() {
    clearInterval(this._adminAutoRefreshInterval);

    this._adminAutoRefreshInterval = setInterval(() => {
      if (!document.hidden) this.fetchAdminData(true);
    }, 60000);

    if (!this._adminVisibilityRefreshBound) {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.fetchAdminData(true);
      });
      this._adminVisibilityRefreshBound = true;
    }
  }
}

window.portal = window.portal || new CallHammerPortal();

// ==========================================
// SUPABASE CLIENT INITIALIZATION
// ==========================================
const supabaseUrl = 'https://api.supabase.callhammerleads.com';
const supabaseKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTcwMjI2MCwiZXhwIjo0OTI3Mzc1ODYwLCJyb2xlIjoiYW5vbiJ9.XuWCdGs0XSSSlWhsF6gR4gHMp50C-v6xra9ABgSVRoU';
const supaClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// ==========================================
// PASSBOOK CONTROLS (ADMIN & SALES)
// ==========================================
async function fetchAdminClients(status = 'Active') {
    if (!supaClient) return;
    
    // Fetch ALL clients first to beat Supabase's strict case-sensitivity
    const { data: clients, error } = await supaClient.from('clients').select('*');
    if (error) return console.error("Error fetching clients:", error);
    
    let filtered = clients || [];
    
    // Javascript filter ignores Capitalization and invisible spaces
    if (status !== 'All') {
        filtered = filtered.filter(c => {
            const dbStatus = String(c.client_status || c.status || '').trim().toLowerCase();
            return dbStatus === String(status).toLowerCase();
        });
    }
    
    if (window.Admin && typeof window.Admin.applyPassbookFilters === 'function') {
        window.Admin.applyPassbookFilters(filtered);
    }
}

async function fetchSalesClients(status = 'Active') {
    if (!supaClient) return;
    let query = supaClient.from('clients').select('*').eq('shared_with_sales', true);
    if (status !== 'All') query = query.eq('client_status', status);
    const { data: clients, error } = await query;
    if (!error && window.Admin && typeof window.Admin.applyPassbookFilters === 'function') {
        window.Admin.applyPassbookFilters(clients);
    }
}

async function toggleShareWithSales(codeName, checkboxElement) {
    if (!supaClient) { checkboxElement.checked = !checkboxElement.checked; return; }
    const isShared = checkboxElement.checked;
    // FIX: Match the actual Supabase column name 'client_code'
    const { error } = await supaClient.from('clients').update({ shared_with_sales: isShared }).eq('client_code', codeName); 
    if (error) {
        alert('Database error. Check the console.');
        checkboxElement.checked = !isShared; 
    }
}

// ==========================================
// SALES PIPELINE CONTROLS (UPGRADED HYBRID LEDGER)
// ==========================================
window.fetchSalesPipeline = function() {
  console.warn("⚠️ OLD fetchSalesPipeline DISABLED");
  return;
    const state = window.portal?.adminState;
    if (!state || !state.packages) return;

    const packages = state.packages; 
    const clients = state.rawClients || state.clients || [];

    const tbody = document.getElementById('admin-sales-table-body');
    if (!tbody) return;

    const query = (document.getElementById('admin-sales-search')?.value || "").toLowerCase().trim();
    const pkgFilter = document.getElementById('admin-sales-package-filter')?.value || "all";
    const catFilter = document.getElementById('admin-sales-category-filter')?.value || "All";

    let totalSalesValue = 0;

    let rows = packages.map(pkg => {
        const code = String(pkg.client_code || "").trim();
        const client = clients.find(c =>
  String(c.client_code || c.code_name || "").trim().toLowerCase() === code.toLowerCase()
) || {};
        
        let pStatus = String(pkg.status || "COMPLETED").toUpperCase();
        if (pStatus === 'ACTIVE') pStatus = 'ONGOING';

        const rawAmt = pkg.amount ? String(pkg.amount).replace(/[^0-9.-]+/g,"") : "0";
        const valNum = parseFloat(rawAmt) || 0;
        const valFormatted = valNum.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        // Math for Total Commission (Purchased Leads * Commission Per Lead)
        const purchasedAmount = Number(pkg.purchased_leads) || 0;
        const commPerLead = Number(pkg.commission_per_lead) || 0;
        const totalComm = purchasedAmount * commPerLead;
        const commFormatted = totalComm.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        return {
            id: pkg.id,
            purchaseDateRaw: new Date(pkg.purchase_date || 0),
            purchaseDate: window.portal.formatDate(pkg.purchase_date) || "—",
            txn: pkg.external_package_id || pkg.transaction_id || "—",
            company: client.company_name || client.roofing_company || "—",
            poc: client.contact_person || client.client_name || client.contact_name || "—",
            packageLeads: purchasedAmount,
            dealValueNum: valNum,
            dealValue: valFormatted,
            totalComm: commFormatted,
            pkgStatus: pStatus,
            dealStatus: pkg.deal_status || "—", // <--- NEW LINE
            soldBy: pkg.sales_category || pkg.sold_by || "CHL", 
            dateStarted: window.portal.formatDate(pkg.package_start_date) || "—",
            searchStr: `${code} ${client.company_name} ${pkg.external_package_id}`.toLowerCase()
        };
    });

    // 1. Apply Filters
    if (pkgFilter !== "all") {
        const filterTarget = pkgFilter === "Active" ? "ONGOING" : pkgFilter.toUpperCase();
        rows = rows.filter(r => r.pkgStatus === filterTarget);
    }
    if (catFilter !== "All") {
        rows = rows.filter(r => r.soldBy === catFilter);
    }
    if (query) rows = rows.filter(r => r.searchStr.includes(query));

    // 2. Sort by Latest Sale First
    rows.sort((a, b) => b.purchaseDateRaw - a.purchaseDateRaw);

    // 3. Render Table & Calculate Total KPI
    tbody.innerHTML = rows.map(r => {
        totalSalesValue += r.dealValueNum; // Add to total

        // We put the PKG Colors back!
        let pkgColor = "bg-gray-100 text-gray-700";
        if (r.pkgStatus === 'ONGOING') pkgColor = "bg-blue-100 text-blue-800";
        if (r.pkgStatus === 'COMPLETED') pkgColor = "bg-purple-100 text-purple-800";
        if (r.pkgStatus === 'REFUNDED') pkgColor = "bg-orange-100 text-orange-800";
        if (r.pkgStatus === 'PAUSE') pkgColor = "bg-yellow-100 text-yellow-800";

        // New Deal Status Colors
        let dealColor = "bg-gray-100 text-gray-700";
        if (r.dealStatus === 'Paid') dealColor = "bg-emerald-100 text-emerald-800";
        if (r.dealStatus === 'Negotiating') dealColor = "bg-yellow-100 text-yellow-800";
        if (r.dealStatus === 'Refunded') dealColor = "bg-red-100 text-red-800";
      
        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition-colors">
            <td class="p-4 text-sm text-gray-500">${r.purchaseDate}</td>
            <td class="p-4 text-xs font-mono text-gray-400 font-bold">${r.txn}</td>
            <td class="p-4 font-bold text-gray-900">${r.company}</td>
            <td class="p-4 text-sm text-gray-600">${r.poc}</td>
            <td class="p-4 font-bold text-gray-900">${r.packageLeads} Leads</td>
            <td class="p-4 font-bold text-emerald-600">${r.dealValue}</td>
            <td class="p-4 font-bold text-purple-600">${r.totalComm}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-extrabold uppercase ${pkgColor}">${r.pkgStatus}</span></td>
            <td class="p-4 text-sm text-gray-600">${r.soldBy}</td>
            <td class="p-4 text-sm text-gray-500 font-bold">${r.dateStarted}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-extrabold uppercase ${dealColor}">${r.dealStatus}</span></td>
            <td class="p-4 text-center flex justify-center gap-1">
                <button onclick="window.editDealModal('${r.id}')" class="px-3 py-1 bg-gray-100 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded shadow-sm transition-colors">Edit</button>
                <button onclick="window.deleteDeal('${r.id}', '${r.company.replace(/'/g, "\\'")}')" class="px-3 py-1 bg-gray-100 hover:bg-red-100 text-red-700 text-xs font-bold rounded shadow-sm transition-colors">Delete</button>
            </td>
        </tr>`;
    }).join('');

    // Update KPI
    const kpiEl = document.getElementById('sales-total-kpi');
    if (kpiEl) kpiEl.textContent = totalSalesValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Opens confirm dialog to delete a deal
window.deleteDeal = async function(pkgId, companyName) {
    if (!supaClient) return alert("Database connection missing.");

    const confirmed = confirm(`Are you sure you want to permanently delete the deal for ${companyName}? This cannot be undone.`);
    if (!confirmed) return;

    const { data: existingPkg, error: fetchErr } = await supaClient
        .from('packages')
        .select('*')
        .eq('id', pkgId)
        .single();

    if (fetchErr) {
        console.error("Delete fetch package error:", fetchErr);
    }

    const { error } = await supaClient.from('packages').delete().eq('id', pkgId);

    if (error) {
        console.error("Delete Deal Error:", error);
        alert("Failed to delete deal.");
    } else {
        await window.portal.createCommandCenterEvent({
            moduleKey: 'sales_pipeline',
            entityType: 'package',
            entityId: String(pkgId),
            entityCode: existingPkg?.client_code || null,
            entityLabel: companyName || existingPkg?.client_code || 'Deleted deal',
            eventType: 'deleted',
            summaryText: `${window.portal.currentUser?.name || 'User'} deleted a sales deal for ${companyName}.`,
            fieldChanges: [],
            oldData: existingPkg || null,
            newData: null,
            severity: 'high',
            teamKeys: ['admin_management', 'sales']
        });

        window.portal.fetchAdminData(true);
    }
};

function isSalesRepDealEntryContext() {
    // Every access level now uses the same category/date commission policy.
    return false;
}

function parseSalesMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
    const n = Number(cleaned);

    return Number.isFinite(n) ? n : 0;
}

function normalizeSalesCategoryForRates(value) {
    const raw = String(value || '').trim();
    const lower = raw.toLowerCase();

    if (lower === 'chl' || lower === 'chl team') return 'CHL Team';
    if (lower === 'trb') return 'TRB';
    if (lower === 'hammer') return 'Hammer';
    if (lower === 'mikaela') return 'Mikaela';
    if (lower === 'sales team') return 'Sales Team';

    return raw;
}

function isAutoCommissionSalesCategory(category) {
    const normalized = normalizeSalesCategoryForRates(category);
    return ['CHL Team', 'TRB', 'Hammer', 'Mikaela', 'Sales Team'].includes(normalized);
}

const SALES_RATE_POLICY = Object.freeze({
    standardEffectiveDate: '2026-03-09',
    mikaelaEffectiveDate: '2026-08-08',
    historicalRate: 125,
    standardRate: 135,
    trbRate: 100,
    mikaelaRate: 150
});

function getSalesLeadRateForDeal(category, purchaseDateValue) {
    const normalizedCategory = normalizeSalesCategoryForRates(category);
    const rawDate = String(purchaseDateValue || '').trim();
    const dateMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    let purchaseDateKey = dateMatch ? dateMatch[1] : '';

    if (!purchaseDateKey && purchaseDateValue) {
        const parsedDate = new Date(purchaseDateValue);
        if (!isNaN(parsedDate.getTime())) {
            const year = parsedDate.getFullYear();
            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const day = String(parsedDate.getDate()).padStart(2, '0');
            purchaseDateKey = `${year}-${month}-${day}`;
        }
    }

    if (!purchaseDateKey || purchaseDateKey < SALES_RATE_POLICY.standardEffectiveDate) {
        return SALES_RATE_POLICY.historicalRate;
    }

    if (
        normalizedCategory === 'Mikaela' &&
        purchaseDateKey >= SALES_RATE_POLICY.mikaelaEffectiveDate
    ) {
        return SALES_RATE_POLICY.mikaelaRate;
    }

    if (normalizedCategory === 'TRB') {
        return SALES_RATE_POLICY.trbRate;
    }

    return SALES_RATE_POLICY.standardRate;
}

function calculateAutoSalesCommission(leadsValue, dealValue, category, purchaseDateValue) {
    const leads = parseSalesMoney(leadsValue);
    const amount = parseSalesMoney(dealValue);
    const rate = getSalesLeadRateForDeal(category, purchaseDateValue);

    if (!isAutoCommissionSalesCategory(category)) {
        return {
            rate,
            profit: amount,
            commission: 0
        };
    }

    const profit = Math.min(leads * rate, amount);
    const commission = Math.max(0, amount - profit);

    return {
        rate,
        profit,
        commission
    };
}

function configureSaleCommissionField() {
    const commissionInput = document.getElementById('sale-commission');
    if (!commissionInput) return;

    const manualEntry = isSalesRepDealEntryContext();

    commissionInput.readOnly = !manualEntry;

    if (manualEntry) {
        commissionInput.placeholder = 'e.g. 500';
        commissionInput.classList.remove('bg-gray-50', 'text-gray-700', 'cursor-not-allowed');
    } else {
        commissionInput.placeholder = 'Auto-calculated';
        commissionInput.classList.add('bg-gray-50', 'text-gray-700', 'cursor-not-allowed');
    }
}

function updateSaleCommissionField() {
    if (isSalesRepDealEntryContext()) return;

    const commissionInput = document.getElementById('sale-commission');
    const categorySelect = document.getElementById('sale-category');

    if (!commissionInput) return;

    const selectedOption = categorySelect?.options?.[categorySelect.selectedIndex];
    const selectedCategory = categorySelect?.value;

    const isUnsupportedHistoricalCategory =
        selectedOption?.dataset?.historical === 'true' &&
        !isAutoCommissionSalesCategory(selectedCategory);

    if (isUnsupportedHistoricalCategory) return;

    const calc = calculateAutoSalesCommission(
        document.getElementById('sale-leads')?.value,
        document.getElementById('sale-value')?.value,
        selectedCategory,
        document.getElementById('sale-date')?.value
    );

    commissionInput.value = calc.commission.toFixed(2);
    commissionInput.dataset.ratePerLead = String(calc.rate);
    commissionInput.dataset.autoProfit = calc.profit.toFixed(2);
}

function installSaleCommissionAutoCalc() {
    if (isSalesRepDealEntryContext()) {
        configureSaleCommissionField();
        return;
    }

    configureSaleCommissionField();

    ['sale-leads', 'sale-value', 'sale-category', 'sale-date'].forEach(id => {
        const el = document.getElementById(id);

        if (!el || el.dataset.salesAutoCalcBound === 'true') return;

        el.dataset.salesAutoCalcBound = 'true';
        el.addEventListener('input', updateSaleCommissionField);
        el.addEventListener('change', updateSaleCommissionField);
    });

    updateSaleCommissionField();
}

function removeHistoricalSaleCategoryOptions() {
    const select = document.getElementById('sale-category');
    if (!select) return;

    Array.from(select.querySelectorAll('option[data-historical="true"]')).forEach(opt => opt.remove());

    delete select.dataset.originalSalesCategory;
}

function setSaleCategoryValueSafely(categoryValue) {
    const select = document.getElementById('sale-category');
    if (!select) return;

    removeHistoricalSaleCategoryOptions();

    const rawCategory = String(categoryValue || '').trim();
    select.dataset.originalSalesCategory = rawCategory;

    if (!rawCategory) {
        updateSaleCommissionField();
        return;
    }

    const existingOption = Array.from(select.options).find(opt =>
        String(opt.value || '').trim().toLowerCase() === rawCategory.toLowerCase()
    );

    if (existingOption) {
        select.value = existingOption.value;
    } else {
        const opt = document.createElement('option');
        opt.value = rawCategory;
        opt.textContent = `${rawCategory} (historical)`;
        opt.dataset.historical = 'true';
        opt.disabled = true;

        select.appendChild(opt);
        select.value = rawCategory;
    }

    updateSaleCommissionField();
}

window.SALES_RATE_POLICY = SALES_RATE_POLICY;
window.getSalesLeadRateForDeal = getSalesLeadRateForDeal;
window.calculateAutoSalesCommission = calculateAutoSalesCommission;
window.updateSaleCommissionField = updateSaleCommissionField;
window.installSaleCommissionAutoCalc = installSaleCommissionAutoCalc;

window.openAddDealModal = function() {
    document.getElementById('add-sale-form').reset();
    document.getElementById('sale-package-id').value = ""; 
    document.getElementById('sale-client-code').value = ""; 
    document.getElementById('sale-deal-type').value = "New Client";

    removeHistoricalSaleCategoryOptions();
    configureSaleCommissionField();

    document.getElementById('sale-modal-title').innerText = "Log New Deal";
    document.getElementById('save-sale-btn').innerText = "Save Deal";

    window.populateSalesClientDropdown();
    installSaleCommissionAutoCalc();

    document.getElementById('add-sale-modal').classList.remove('hidden');
}

window.editDealModal = function(pkgId) {
    const pkg = window.portal.adminState.packages.find(p => p.id == pkgId);
    if (!pkg) return;

    window.populateSalesClientDropdown();
    const clients = window.portal?.adminState?.rawClients || window.portal?.adminState?.clients || [];
    const client = clients.find(c =>
  String(c.client_code || c.code_name || "").trim().toLowerCase() === String(pkg.client_code || "").trim().toLowerCase()
) || {};

    document.getElementById('sale-package-id').value = pkg.id;
    document.getElementById('sale-client-code').value = pkg.client_code || "";
    document.getElementById('sale-company').value = client.company_name || "";
    document.getElementById('sale-poc').value = client.contact_person || "";
    
    document.getElementById('sale-leads').value = pkg.purchased_leads || "";
    document.getElementById('sale-value').value = String(pkg.amount || "").replace(/[^0-9.-]+/g,"");
    configureSaleCommissionField();
document.getElementById('sale-commission').value = pkg.commission_per_lead || 0;
    
    if (pkg.purchase_date) {
  const rawDate = String(pkg.purchase_date).trim();
  const isoOnly = rawDate.match(/^\d{4}-\d{2}-\d{2}$/);
  document.getElementById('sale-date').value = isoOnly ? rawDate : '';
}

    document.getElementById('sale-transaction-id').value = pkg.external_package_id || "";
    document.getElementById('sale-deal-status').value = pkg.deal_status || "Paid";
    document.getElementById('sale-deal-type').value = pkg.deal_type || "New Client";
    setSaleCategoryValueSafely(pkg.sales_category || "");
installSaleCommissionAutoCalc();

    document.getElementById('sale-modal-title').innerText = "Edit Deal Details";
    document.getElementById('save-sale-btn').innerText = "Update Deal";
    document.getElementById('add-sale-modal').classList.remove('hidden');
}

window.populateSalesClientDropdown = function() {
    const companyInput = document.getElementById('sale-company');
    const suggestionBox = document.getElementById('custom-client-suggestions');
    if (!companyInput || !suggestionBox) return;

    const clients = window.portal?.adminState?.rawClients || window.portal?.adminState?.clients || [];
    
    // 1. Hide dropdown when clicking outside of it
    document.addEventListener('click', (e) => {
        if (e.target !== companyInput && e.target !== suggestionBox) {
            suggestionBox.classList.add('hidden');
        }
    });

    // 2. Filter and build the list as you type
    companyInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        suggestionBox.innerHTML = ''; // Clear old suggestions
        
        if (!val) {
            suggestionBox.classList.add('hidden');
            document.getElementById('sale-client-code').value = "";
            document.getElementById('sale-deal-type').value = "New Client";
            document.getElementById('sale-poc').value = "";
            return;
        }

        const matches = clients.filter(c => String(c.company_name || "").toLowerCase().includes(val));
        
        if (matches.length > 0) {
            suggestionBox.classList.remove('hidden');
            matches.forEach(match => {
                const div = document.createElement('div');
                div.className = "px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm font-bold text-gray-700 border-b border-gray-50 last:border-0";
                div.textContent = match.company_name;
                
                // 3. What happens when you click a suggestion
                div.onclick = () => {
                    companyInput.value = match.company_name;
                    document.getElementById('sale-poc').value = match.contact_person || "";
                    document.getElementById('sale-client-code').value = match.client_code || match.code_name || "";
                    document.getElementById('sale-deal-type').value = "Renewal";
                    suggestionBox.classList.add('hidden');
                };
                suggestionBox.appendChild(div);
            });
        } else {
            // If no match, treat as a New Client
            suggestionBox.classList.add('hidden');
            document.getElementById('sale-client-code').value = "";
            document.getElementById('sale-deal-type').value = "New Client";
        }
    });
}

window.submitNewSale = async function(e) {
    e.preventDefault();
    if (!supaClient) return alert("Database connection missing.");

    const btn = document.getElementById('save-sale-btn');
    btn.innerText = "Saving...";
    btn.disabled = true;

    const pkgId = document.getElementById('sale-package-id').value;
    let clientCode = document.getElementById('sale-client-code').value;
    const companyName = document.getElementById('sale-company').value.trim();
    const poc = document.getElementById('sale-poc').value.trim();

    if (!companyName) {
        alert("Roofing Company name is required.");
        btn.innerText = "Save Deal";
        btn.disabled = false;
        return;
    }

    let oldPackage = null;

    if (pkgId) {
        const { data: existingPkg, error: existingPkgErr } = await supaClient
            .from('packages')
            .select('*')
            .eq('id', pkgId)
            .single();

        if (existingPkgErr) {
            console.error("Failed to fetch existing package:", existingPkgErr);
        } else {
            oldPackage = existingPkg;
        }
    }

    // Auto-create new client if needed
    if (!clientCode) {
        clientCode = "NEW-" + Math.floor(Date.now() / 1000);

        const newClientPayload = {
            client_code: clientCode,
            company_name: companyName,
            contact_person: poc,
            client_status: "Active"
        };

        const { error: cErr } = await supaClient.from('clients').insert([newClientPayload]);

        if (cErr) {
            console.error("Auto-Client Creation Error:", cErr);
            alert("Failed to auto-create client profile.");
            btn.innerText = "Save Deal";
            btn.disabled = false;
            return;
        }
    }

    const purchasedLeads = parseInt(document.getElementById('sale-leads').value) || 0;
const dealAmount = parseFloat(document.getElementById('sale-value').value) || 0;
const purchaseDate = document.getElementById('sale-date').value;
const salesCategory = document.getElementById('sale-category').value;

const categorySelect = document.getElementById('sale-category');
const selectedOption = categorySelect?.options?.[categorySelect.selectedIndex];

const isUnsupportedHistoricalCategory =
    selectedOption?.dataset?.historical === 'true' &&
    !isAutoCommissionSalesCategory(salesCategory);

const commissionValue = (isSalesRepDealEntryContext() || isUnsupportedHistoricalCategory)
    ? (parseFloat(document.getElementById('sale-commission').value) || 0)
    : calculateAutoSalesCommission(purchasedLeads, dealAmount, salesCategory, purchaseDate).commission;

if (!isSalesRepDealEntryContext() && !isUnsupportedHistoricalCategory) {
    document.getElementById('sale-commission').value = commissionValue.toFixed(2);
}

const payload = {
    client_code: clientCode,
    purchased_leads: purchasedLeads,
    amount: dealAmount,
    commission_per_lead: commissionValue,
    purchase_date: purchaseDate,
    external_package_id: document.getElementById('sale-transaction-id').value,
    status: "Active",
    deal_status: document.getElementById('sale-deal-status').value,
    deal_type: document.getElementById('sale-deal-type').value,
    sales_category: salesCategory
};

    let error;
    let savedPackage = null;
    let actionType = pkgId ? 'updated' : 'created';

    if (pkgId) {
        const res = await supaClient
            .from('packages')
            .update(payload)
            .eq('id', pkgId)
            .select()
            .single();

        error = res.error;
        savedPackage = res.data || null;
    } else {
        const res = await supaClient
            .from('packages')
            .insert([payload])
            .select()
            .single();

        error = res.error;
        savedPackage = res.data || null;
    }

    if (error) {
        console.error("Sale Save Error:", error);
        alert("Failed to save deal.");
    } else {
        const trackedFields = [
            'client_code',
            'purchased_leads',
            'amount',
            'commission_per_lead',
            'purchase_date',
            'external_package_id',
            'status',
            'deal_status',
            'deal_type',
            'sales_category'
        ];

        const oldRow = oldPackage || {};
        const newRow = savedPackage || payload;
        const fieldChanges = window.portal.buildFieldChanges(oldRow, newRow, trackedFields);

        await window.portal.createCommandCenterEvent({
            moduleKey: 'sales_pipeline',
            entityType: 'package',
            entityId: String(newRow.id || pkgId || newRow.external_package_id || clientCode),
            entityCode: clientCode,
            entityLabel: companyName,
            eventType: actionType,
            summaryText: pkgId
                ? `${window.portal.currentUser?.name || 'User'} updated a sales deal for ${companyName}.`
                : `${window.portal.currentUser?.name || 'User'} added a new sales deal for ${companyName}.`,
            fieldChanges,
            oldData: oldRow,
            newData: newRow,
            severity: 'normal',
            teamKeys: ['admin_management', 'sales']
        });

        document.getElementById('add-sale-modal').classList.add('hidden');
        window.portal.fetchAdminData(true);
    }

    btn.innerText = pkgId ? "Update Deal" : "Save Deal";
    btn.disabled = false;
};

// ==========================================
// GLOBAL EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('clientStatusFilter') && !document.getElementById('salesClientStatusFilter')) {
        fetchAdminClients('Active');
    }
    if (document.getElementById('salesClientStatusFilter')) {
        fetchSalesClients('Active');
    }
    // ❌ OLD SALES PIPELINE DISABLED COMPLETELY
// All rendering is now handled by Admin.renderSalesTab()
});

// ==========================================
// INTERACTIVE LEADS TRACKER (SUPABASE DIRECT + GSHEET SYNC)
// ==========================================

async function updateLeadStatus(leadId, newStatus, rejectionReason = null) {
    if (!supaClient) return alert("Database connection missing.");
    if (!leadId || leadId === "unknown") return alert("Cannot update: Lead ID is missing.");

    const normalizedStatus = String(newStatus || "").trim().toUpperCase();
    const normalizedReason = rejectionReason === null
        ? null
        : String(rejectionReason || "").trim();

    const updatePayload = { status: normalizedStatus };

   if (normalizedStatus.includes("REJECT")) {
    updatePayload.rejection_reason = normalizedReason || "";
    updatePayload.feedback = normalizedReason || "";
}
  
    const { data: oldLead, error: oldLeadError } = await supaClient
        .from('leads_raw')
        .select('*')
        .eq('lead_id', leadId)
        .limit(1)
        .maybeSingle();

    if (oldLeadError) {
        console.error("Failed to load lead before update:", oldLeadError);
    }

    const { error } = await supaClient
        .from('leads_raw')
        .update(updatePayload)
        .eq('lead_id', leadId);

    if (error) {
        console.error("Failed to update lead status:", error);
        alert("Failed to update status in Supabase.");
        return;
    }

    try {
        const trackedFields = ["status", "feedback", "feedback_highlight", "rejection_reason"];
        const newLead = { ...(oldLead || {}), ...updatePayload };

        await window.portal?.createCommandCenterEvent?.({
            moduleKey: 'leads_tracker',
            entityType: 'lead',
            entityId: String(leadId),
            entityCode: String(leadId),
            entityLabel: oldLead?.homeowner_names || oldLead?.homeowner_name || String(leadId),
            eventType: 'updated',
            summaryText: `${window.portal?.currentUser?.name || 'User'} updated lead ${leadId}.`,
            fieldChanges: window.portal?.buildFieldChanges
                ? window.portal.buildFieldChanges(oldLead || {}, newLead, trackedFields)
                : [],
            oldData: oldLead || null,
            newData: newLead,
            severity: 'normal',
            teamKeys: ['admin_management']
        });
    } catch (evtErr) {
        console.error("Command center event failed for lead update:", evtErr);
    }

    console.log(`Success! Lead ${leadId} is now ${normalizedStatus}`);
    window.portal.fetchAdminData(true);

    try {
        fetch('https://automate.callhammerleads.com/webhook/update-lead-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lead_id: leadId,
                status: normalizedStatus
            })
        });
    } catch (e) {
        console.error("Sheet sync failed", e);
    }
}

function handleLeadStatusChange(selectEl, leadId, existingReason = "") {
    const nextStatus = String(selectEl?.value || "").trim().toUpperCase();
    const previousStatus = String(selectEl?.dataset?.previousValue || "").trim().toUpperCase();
    const safeExistingReason = String(existingReason || "").trim();

    if (!leadId || leadId === "unknown") {
        alert("Cannot update: Lead ID is missing.");
        if (selectEl) selectEl.value = previousStatus || "PENDING REVIEW";
        return;
    }

    if (nextStatus.includes("REJECT")) {
        if (selectEl) {
            selectEl.value = previousStatus || "PENDING REVIEW";
        }

        if (window.Admin?.openRejectionReasonModal) {
            window.Admin.openRejectionReasonModal(leadId, nextStatus, safeExistingReason);
        } else {
            alert("Rejection modal is not available.");
        }
        return;
    }

    if (selectEl) {
        selectEl.dataset.previousValue = nextStatus;
    }

    updateLeadStatus(leadId, nextStatus, "");
}

async function deleteLead(leadId) {
    if (!supaClient) return alert("Database connection missing.");
    if (!leadId || leadId === "unknown") return alert("Cannot delete: Lead ID is missing.");

    const confirmDelete = confirm(`Are you sure you want to permanently delete Lead ID: ${leadId}?`);
    if (!confirmDelete) return;

    const { data: oldLead, error: oldLeadError } = await supaClient
        .from('leads_raw')
        .select('*')
        .eq('lead_id', leadId)
        .limit(1)
        .maybeSingle();

    if (oldLeadError) {
        console.error("Failed to load lead before delete:", oldLeadError);
    }

    const { error } = await supaClient
        .from('leads_raw')
        .delete()
        .eq('lead_id', leadId);

    if (error) {
        console.error("Failed to delete lead:", error);
        alert("Failed to delete lead from Supabase.");
        return;
    }

    try {
        await window.portal?.createCommandCenterEvent?.({
            moduleKey: 'leads_tracker',
            entityType: 'lead',
            entityId: String(leadId),
            entityCode: String(leadId),
            entityLabel: oldLead?.homeowner_names || oldLead?.homeowner_name || String(leadId),
            eventType: 'deleted',
            summaryText: `${window.portal?.currentUser?.name || 'User'} deleted lead ${leadId}.`,
            fieldChanges: [],
            oldData: oldLead || null,
            newData: null,
            severity: 'high',
            teamKeys: ['admin_management']
        });
    } catch (evtErr) {
        console.error("Command center event failed for lead delete:", evtErr);
    }

    console.log(`Success! Lead ${leadId} deleted.`);
    window.portal.fetchAdminData(true);

    try {
        fetch('https://automate.callhammerleads.com/webhook/delete-lead-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_id: leadId })
        }).then(res => console.log("Google Sheets sync triggered:", res.status));
    } catch (e) {
        console.error("Sheet sync failed", e);
    }
}

async function updateLeadFeedback(leadId, feedback = "", feedbackHighlight = false) {
  if (!supaClient) return alert("Database connection missing.");
  if (!leadId || leadId === "unknown") return alert("Cannot update: Lead ID is missing.");

  const updatePayload = {
    feedback: String(feedback || "").trim(),
    feedback_highlight: !!feedbackHighlight
  };

  const { error } = await supaClient
    .from("leads_raw")
    .update(updatePayload)
    .eq("lead_id", leadId);

  if (error) {
    console.error("Failed to update lead feedback:", error);
    alert("Failed to save feedback.");
    return;
  }

  window.portal.fetchAdminData(true);
}

// ==========================================
// PASSBOOK CLIENT MANAGEMENT
// ==========================================

function getClientStatusColor(status) {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'ACTIVE') return 'bg-green-100 text-green-800 border-green-200';
    if (s === 'PAUSE') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (s === 'BLACKLISTED') return 'bg-red-100 text-red-800 border-red-200';
    if (s === 'INACTIVE') return 'bg-gray-100 text-gray-800 border-gray-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

async function updateClientStatus(clientId, newStatus) {
    if (!supaClient) return alert("Database connection missing.");
    
    const selectEl = document.getElementById(`status-select-${clientId}`);
    if (selectEl) {
        selectEl.className = `px-2 py-1 rounded-full text-xs font-extrabold border outline-none cursor-pointer transition-all shadow-sm ${getClientStatusColor(newStatus)}`;
    }

    const { error } = await supaClient.from('clients').update({ client_status: newStatus }).eq('id', clientId);
    
    if (error) {
        console.error("Failed to update status:", error);
        alert("Failed to update client status in database.");
        return;
    }

    try {
      const { data: updatedClient } = await supaClient
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

      await window.portal?.createCommandCenterEvent?.({
        moduleKey: 'passbook_clients',
        entityType: 'client',
        entityId: String(updatedClient?.id || clientId),
        entityCode: updatedClient?.client_code || null,
        entityLabel: updatedClient?.company_name || 'Client',
        eventType: 'updated',
        summaryText: `${window.portal?.currentUser?.name || 'User'} updated passbook client ${updatedClient?.company_name || ''}.`,
        fieldChanges: [],
        oldData: null,
        newData: updatedClient,
        severity: 'normal',
        teamKeys: ['admin_management', 'sales']
      });
    } catch (err) {
      console.error('Fallback passbook event failed:', err);
    }
}

async function deletePassbookClient(clientId, companyName) {
      if (window.portal?.isManagementUser?.()) {
        alert("Management access cannot delete passbook clients.");
        return;
    }
  
    if (!supaClient) return;
    
    const confirmDelete = confirm(`⚠️ WARNING: Are you absolutely sure you want to permanently delete ${companyName}?\nThis action cannot be undone.`);
    if (!confirmDelete) return;

    const { error } = await supaClient.from('clients').delete().eq('id', clientId);
    
    if (error) {
        console.error("Delete Error:", error);
        alert("Failed to delete client.");
    } else {
        alert(`${companyName} has been deleted successfully.`);
        fetchAdminClients('All'); 
    }
}

async function submitNewClient(e) {
    e.preventDefault();
    if (!supaClient) return;

    const btn = document.getElementById('save-client-btn');
    btn.innerText = "Saving...";
    btn.disabled = true;

    const payload = {
        client_code: document.getElementById('new-client-code').value,
        company_name: document.getElementById('new-client-name').value,
        client_status: document.getElementById('new-client-status').value
    };

    const { error } = await supaClient.from('clients').insert([payload]);

    if (error) {
        console.error("Add Client Error:", error);
        alert("Failed to add new client.");
    } else {
        document.getElementById('add-client-modal').classList.add('hidden');
        document.getElementById('add-client-form').reset();
        fetchAdminClients('All'); 
    }

    btn.innerText = "Add Client";
    btn.disabled = false;
}

// ==========================================
// ✅ CLIENT HEALTH MONITOR (MISSION CONTROL)
// ==========================================
window.updateClientPackageStatus = async function(packageId, newPackageStatus) {
    if (!supaClient) {
        alert("Database connection missing.");
        return;
    }

    const cleanId = String(packageId || "").trim();
    if (!cleanId || cleanId === "null" || cleanId === "undefined") {
        console.error("Missing packageId in updateClientPackageStatus:", packageId);
        alert("Package ID is missing for this row. Cannot update status.");
        return;
    }

    let normalized = String(newPackageStatus || "").trim().toUpperCase();

// 🔥 FIX: map UI values → system values
if (normalized === 'ACTIVE') normalized = 'ONGOING';
  
    console.log("Updating package status", { packageId: cleanId, newPackageStatus: normalized });

    try {
        const { data: oldPackageRows, error: oldFetchErr } = await supaClient
            .from('packages')
            .select('*')
            .eq('id', cleanId)
            .limit(1);

        if (oldFetchErr) {
            console.error("Failed to load package before update:", oldFetchErr);
        }

        const oldPackage = (oldPackageRows && oldPackageRows[0]) ? oldPackageRows[0] : null;

        let pauseUntilDate = null;

        if (normalized === 'PAUSE') {
            const pauseChoice = await window.showPauseDatePickerModal();

            if (pauseChoice === null) {
                // user cancelled
                if (window.portal && typeof window.portal.fetchAdminData === 'function') {
                    await window.portal.fetchAdminData(true);
                }
                if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
                    window.adminDashboard.refreshDashboard();
                } else if (window.Admin && typeof window.Admin.refreshDashboard === 'function') {
                    window.Admin.refreshDashboard();
                }
                return;
            }

            pauseUntilDate = pauseChoice || null;
        }

        let updatePayload = {
            status_override_updated_at: new Date().toISOString(),
            status_override_updated_by: window.portal?.currentUser?.name || window.portal?.currentUser?.email || 'admin'
        };

        if (normalized === 'PAUSE') {
            updatePayload.status = 'Pause';
            updatePayload.manual_status_override = 'PAUSE';
            updatePayload.pause_until_date = pauseUntilDate;
        } else if (normalized === 'REFUNDED') {
            updatePayload.status = 'Refunded';
            updatePayload.manual_status_override = 'REFUNDED';
            updatePayload.pause_until_date = null;
        } else if (normalized === 'ONGOING') {
            updatePayload.status = 'Active';
            updatePayload.manual_status_override = null;
            updatePayload.pause_until_date = null;
        } else if (normalized === 'COMPLETED') {
            updatePayload.status = 'Completed';
            updatePayload.manual_status_override = null;
            updatePayload.pause_until_date = null;
        } else {
            alert(`Unsupported package status: ${newPackageStatus}`);
            return;
        }

        const { data, error: updateErr } = await supaClient
            .from('packages')
            .update(updatePayload)
            .eq('id', cleanId)
            .select();

        const updatedPackage = (data && data[0]) ? data[0] : null;

        if (updateErr) {
            console.error("Status Update Error:", updateErr);
            alert("Failed to update package in ledger.");
            return;
        }

        console.log("Package status updated:", updatedPackage);

        try {
            if (oldPackage && updatedPackage) {
                await window.portal?.createCommandCenterEvent?.({
                    moduleKey: 'overview',
                    entityType: 'package',
                    entityId: String(updatedPackage.id || cleanId),
                    entityCode: updatedPackage.client_code || null,
                    entityLabel: updatedPackage.client_code || 'Package',
                    eventType: 'updated',
                    summaryText: `${window.portal?.currentUser?.name || 'User'} changed package status for ${updatedPackage.client_code || 'client'}.`,
                    fieldChanges: window.portal?.buildFieldChanges
                        ? window.portal.buildFieldChanges(
                            oldPackage,
                            updatedPackage,
                            ['status', 'manual_status_override', 'pause_until_date', 'status_override_updated_at', 'status_override_updated_by']
                          )
                        : [],
                    oldData: oldPackage,
                    newData: updatedPackage,
                    severity: 'normal',
                    teamKeys: ['admin_management', 'sales']
                });
            }
        } catch (evtErr) {
            console.error('Overview notification event failed:', evtErr);
        }

        if (window.portal && typeof window.portal.fetchAdminData === 'function') {
            await window.portal.fetchAdminData(true);
        }

        if (window.adminDashboard && typeof window.adminDashboard.refreshDashboard === 'function') {
            window.adminDashboard.refreshDashboard();
        } else if (window.Admin && typeof window.Admin.refreshDashboard === 'function') {
            window.Admin.refreshDashboard();
        } else {
            location.reload();
        }

    } catch (error) {
        console.error("Status Update Error:", error);
        alert("An error occurred while updating.");
    }
};

window.showPauseDatePickerModal = function() {
    return new Promise((resolve) => {
        const existing = document.getElementById('pause-date-modal');
        if (existing) existing.remove();

        const today = new Date().toISOString().split('T')[0];

        const modal = document.createElement('div');
        modal.id = 'pause-date-modal';
        modal.innerHTML = `
            <div style="
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.45);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
            ">
                <div style="
                    background: #fff;
                    width: 100%;
                    max-width: 420px;
                    border-radius: 16px;
                    padding: 24px;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.2);
                    font-family: inherit;
                ">
                    <h3 style="margin: 0 0 10px; font-size: 20px; font-weight: 700; color: #111827;">
                        Pause Package
                    </h3>
                    <p style="margin: 0 0 16px; font-size: 14px; color: #6B7280;">
                        Choose until when this package should stay paused. Leave it blank for permanent pause.
                    </p>

                    <input
                        id="pause-until-input"
                        type="date"
                        min="${today}"
                        style="
                            width: 100%;
                            padding: 12px 14px;
                            border: 1px solid #D1D5DB;
                            border-radius: 10px;
                            font-size: 14px;
                            margin-bottom: 18px;
                            box-sizing: border-box;
                        "
                    />

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button
                            id="pause-cancel-btn"
                            type="button"
                            style="
                                padding: 10px 14px;
                                border: 1px solid #D1D5DB;
                                background: #fff;
                                border-radius: 10px;
                                font-weight: 600;
                                cursor: pointer;
                            "
                        >
                            Cancel
                        </button>

                        <button
                            id="pause-permanent-btn"
                            type="button"
                            style="
                                padding: 10px 14px;
                                border: none;
                                background: #F59E0B;
                                color: #fff;
                                border-radius: 10px;
                                font-weight: 700;
                                cursor: pointer;
                            "
                        >
                            Permanent Pause
                        </button>

                        <button
                            id="pause-save-btn"
                            type="button"
                            style="
                                padding: 10px 14px;
                                border: none;
                                background: #2563EB;
                                color: #fff;
                                border-radius: 10px;
                                font-weight: 700;
                                cursor: pointer;
                            "
                        >
                            Save Pause
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const input = document.getElementById('pause-until-input');
        const cancelBtn = document.getElementById('pause-cancel-btn');
        const permanentBtn = document.getElementById('pause-permanent-btn');
        const saveBtn = document.getElementById('pause-save-btn');

        const cleanup = () => {
            modal.remove();
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        permanentBtn.addEventListener('click', () => {
            cleanup();
            resolve('');
        });

        saveBtn.addEventListener('click', () => {
            const selectedDate = String(input?.value || '').trim();

            if (!selectedDate) {
                alert('Please choose a date, or click Permanent Pause.');
                return;
            }

            cleanup();
            resolve(selectedDate);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal.firstElementChild) {
                cleanup();
                resolve(null);
            }
        });

        setTimeout(() => {
            if (input) input.showPicker?.();
            if (input) input.focus();
        }, 50);
    });
};

document.getElementById('btn-submit-timeoff')?.addEventListener('click', async () => {
  const reasonInput = document.getElementById('timeoff-reason');
  const reason = reasonInput?.value?.trim() || '';

  const startDate =
    typeof rangeStart !== 'undefined' && rangeStart
      ? rangeStart.toISOString().split('T')[0]
      : '';

  const endDate =
    typeof rangeEnd !== 'undefined' && rangeEnd
      ? rangeEnd.toISOString().split('T')[0]
      : '';

  if (!startDate || !endDate) {
    alert('Select start and end date first.');
    return;
  }

  if (!reason) {
    alert('Please enter a reason.');
    return;
  }

  try {
    const { data, error } = await portal.supabase.rpc('submit_my_time_off_request', {
      p_reason: reason,
      p_start_date: startDate,
      p_end_date: endDate,
      p_notes: ''
    });

    if (error) {
      console.error('Time off RPC error:', error);
      alert(`Failed to submit request: ${error.message || 'Unknown error'}`);
      return;
    }

    console.log('Time off RPC success:', data);

    const requestId = data;

    try {
      await window.portal?.createCommandCenterEvent?.({
        moduleKey: 'time_off',
        entityType: 'time_off_request',
        entityId: String(requestId),
        entityCode: String(requestId),
        entityLabel: window.portal?.currentUser?.name || window.portal?.currentUser?.email || 'Agent',
        eventType: 'submitted',
        summaryText: `${window.portal?.currentUser?.name || 'Agent'} submitted a time off request.`,
        fieldChanges: [],
        oldData: null,
        newData: {
          id: requestId,
          requester_profile_id: window.portal?.currentUser?.id || null,
          requester_name: window.portal?.currentUser?.name || null,
          requester_email: window.portal?.currentUser?.email || null,
          reason,
          start_date: startDate,
          end_date: endDate,
          notes: null,
          status: 'pending'
        },
        severity: 'normal',
        teamKeys: ['admin_management']
      });
    } catch (eventErr) {
      console.error('Time off notification event failed:', eventErr);
    }

    alert('Time off request submitted!');

    if (typeof window.portal?.loadTimeOffHistory === 'function') {
      await window.portal.loadTimeOffHistory();
    }

    if (typeof updateRangeUI === 'function') {
      rangeStart = null;
      rangeEnd = null;
      updateRangeUI();
      if (typeof renderCalendar === 'function') renderCalendar();
    }
  } catch (err) {
    console.error('Time off request failed:', err);
    alert('Failed to submit request');
  }
});
