/*
 * CHL Leads Tracker review modal
 * Loaded by both admin-dashboard.html and management-dashboard.html.
 */
(() => {
  'use strict';

  const PATCH_FLAG = '__chlLeadsReviewModalInstalled';
  const MODAL_ID = 'chl-lead-review-modal';
  const REQUIRED_REVIEW_FIELDS = [
    'homeowner_names',
    'email_of_homeowner',
    'homeowner_phone_numbers',
    'appointment_date_time',
    'address',
    'age_of_roof',
    'insurance_company',
    'additional_notes'
  ];

  const FIELD_KEYS = {
    date_submitted: ['date_submitted', 'Date Submitted', 'DATE'],
    lead_id: ['lead_id', 'LEAD ID', 'ID'],
    company_name: ['company_name', 'Company Name', 'roofing_company', 'Roofing Company', 'client_code', 'Client Code'],
    appointment_coordinator_name: ['appointment_coordinator_name', 'Appointment Coordinator Name', 'agent_name'],
    homeowner_names: ['homeowner_names', 'Homeowner Name(s)', 'homeowner_name'],
    email_of_homeowner: ['email_of_homeowner', 'Email of Homeowner', 'email'],
    homeowner_phone_numbers: ['homeowner_phone_numbers', 'Homeowner Phone Number(s)', 'Homeowner Phone Number', 'phone'],
    appointment_date_time: ['appointment_date_time', 'Appointment Date /Time', 'Appointment Date / Time'],
    address: ['address', 'Address'],
    age_of_roof: ['age_of_roof', 'Age of Roof'],
    insurance_company: ['insurance_company', 'Insurance Company'],
    additional_notes: ['additional_notes', 'Additional Notes'],
    feedback: ['feedback', 'Feedback', 'rejection_reason', 'Rejection Reason'],
    feedback_highlight: ['feedback_highlight'],
    status: ['status', 'Status', 'STATUS', 'Lead_Status']
  };

  const leadRowsById = new Map();
  let activeLeadId = '';
  let lastFocusedElement = null;
  let saving = false;

  function getAdmin() {
    return window.Admin || window.adminDashboard || null;
  }

  function getSupabaseClient() {
    if (typeof supaClient !== 'undefined' && supaClient) return supaClient;
    return window.portal?.supabase || null;
  }

  function pick(obj, keys, fallback = '') {
    if (!obj || typeof obj !== 'object') return fallback;
    const sourceKeys = Object.keys(obj);
    for (const key of keys || []) {
      const match = sourceKeys.find(candidate => String(candidate).toLowerCase() === String(key).toLowerCase());
      if (!match) continue;
      const value = obj[match];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return fallback;
  }

  function fieldValue(lead, key, fallback = '') {
    return pick(lead, FIELD_KEYS[key] || [key], fallback);
  }

  function normalizeStatus(value) {
    const status = String(value || '').trim().toUpperCase();
    if (status.includes('APPROV') || status.includes('CONFIRM')) return 'APPROVED';
    if (status.includes('CREDIT')) return 'CREDITED';
    if (status.includes('REJECT')) return 'REJECTED';
    return 'PENDING REVIEW';
  }

  function statusClasses(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'APPROVED') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (normalized === 'CREDITED') return 'bg-purple-100 text-purple-800 border-purple-200';
    if (normalized === 'REJECTED') return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-yellow-100 text-yellow-800 border-yellow-200';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function isTrue(value) {
    return value === true || String(value).toLowerCase() === 'true';
  }

  function modalField({ id, label, value = '', type = 'text', requiredReview = false, textarea = false, rows = 3, placeholder = '' }) {
    const reviewControl = requiredReview
      ? `<label class="inline-flex items-center gap-2 text-xs font-extrabold text-gray-600 cursor-pointer select-none">
          <input type="checkbox" class="chl-lead-review-check w-4 h-4 accent-emerald-600" data-review-field="${escapeAttribute(id)}">
          Reviewed
        </label>`
      : '';

    const control = textarea
      ? `<textarea id="chl-lead-${escapeAttribute(id)}" rows="${rows}" placeholder="${escapeAttribute(placeholder)}" class="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 resize-y">${escapeHtml(value)}</textarea>`
      : `<input id="chl-lead-${escapeAttribute(id)}" type="${escapeAttribute(type)}" value="${escapeAttribute(value)}" placeholder="${escapeAttribute(placeholder)}" class="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400">`;

    return `<div class="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-2">
        <label for="chl-lead-${escapeAttribute(id)}" class="text-[11px] font-black uppercase tracking-wide text-gray-500">${escapeHtml(label)}</label>
        ${reviewControl}
      </div>
      ${control}
    </div>`;
  }

  function readOnlyField(label, value) {
    const display = String(value ?? '').trim() || '—';
    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-3 min-w-0">
      <div class="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-1">${escapeHtml(label)}</div>
      <div class="text-sm font-bold text-gray-800 whitespace-pre-wrap break-words">${escapeHtml(display)}</div>
    </div>`;
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'hidden fixed inset-0';
    modal.style.zIndex = '240';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black/55 backdrop-blur-[1px]" data-lead-review-close="true"></div>
      <div class="relative h-full w-full overflow-y-auto p-3 sm:p-6">
        <section role="dialog" aria-modal="true" aria-labelledby="chl-lead-review-title" class="relative mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-gray-100 bg-gray-50 shadow-2xl">
          <header class="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-5 py-4 sm:px-6">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 id="chl-lead-review-title" class="text-xl sm:text-2xl font-black text-gray-900">Review Lead</h3>
                <span id="chl-lead-review-status-badge" class="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black">PENDING REVIEW</span>
              </div>
              <p id="chl-lead-review-subtitle" class="mt-1 truncate text-sm text-gray-500">Review every required lead detail before changing its status.</p>
            </div>
            <button type="button" data-lead-review-close="true" class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Close lead review modal">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </header>

          <div class="px-4 py-5 sm:px-6">
            <div id="chl-lead-review-static" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"></div>

            <div class="mt-5 flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-xs font-black uppercase tracking-wide text-blue-700">Required quality review</div>
                <div class="mt-1 text-sm text-blue-900">Check all eight reviewed boxes to unlock the status selector.</div>
              </div>
              <div id="chl-lead-review-progress" class="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-black text-blue-700 shadow-sm">0 / 8 reviewed</div>
            </div>

            <div id="chl-lead-review-fields" class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2"></div>

            <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
              <div class="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <label for="chl-lead-feedback" class="text-[11px] font-black uppercase tracking-wide text-gray-500">Feedback</label>
                  <button id="chl-lead-highlight-toggle" type="button" aria-pressed="false" class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-600 transition hover:border-yellow-300 hover:bg-yellow-50">
                    <i class="fa-regular fa-star"></i>
                    <span>Spotlight</span>
                  </button>
                </div>
                <textarea id="chl-lead-feedback" rows="6" placeholder="Enter QC feedback for this lead..." class="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 resize-y"></textarea>
                <p class="mt-2 text-xs text-gray-400">The star marks this feedback as a Spotlight highlight.</p>
              </div>

              <div class="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <label for="chl-lead-status" class="text-[11px] font-black uppercase tracking-wide text-gray-500">Lead Status</label>
                <select id="chl-lead-status" disabled class="mt-2 w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 px-3 py-3 text-sm font-black text-gray-400 opacity-70 outline-none">
                  <option value="PENDING REVIEW">PENDING REVIEW</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="CREDITED">CREDITED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
                <div id="chl-lead-status-lock-message" class="mt-3 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs font-bold text-gray-500">
                  <i class="fa-solid fa-lock mt-0.5"></i>
                  <span>Status is locked until all required fields are reviewed.</span>
                </div>
              </div>
            </div>

            <div id="chl-lead-review-message" class="hidden mt-4 rounded-xl border px-4 py-3 text-sm font-bold" role="status"></div>
          </div>

          <footer class="sticky bottom-0 z-20 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
            <button type="button" data-lead-review-close="true" class="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-extrabold text-gray-700 hover:bg-gray-50">Cancel</button>
            <button id="chl-lead-review-save" type="button" class="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60">
              <i class="fa-solid fa-floppy-disk mr-2"></i>Save Changes
            </button>
          </footer>
        </section>
      </div>`;

    document.body.appendChild(modal);

    modal.addEventListener('click', event => {
      if (event.target.closest('[data-lead-review-close="true"]')) {
        closeModal();
      }
    });

    modal.querySelector('#chl-lead-highlight-toggle')?.addEventListener('click', toggleHighlight);
    modal.querySelector('#chl-lead-review-save')?.addEventListener('click', saveLeadReview);
    modal.addEventListener('change', event => {
      if (event.target.matches('.chl-lead-review-check')) updateReviewGate();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });

    return modal;
  }

  function setMessage(message = '', tone = 'info') {
    const el = document.getElementById('chl-lead-review-message');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className = 'hidden mt-4 rounded-xl border px-4 py-3 text-sm font-bold';
      return;
    }

    const tones = {
      error: 'border-red-200 bg-red-50 text-red-700',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      info: 'border-blue-200 bg-blue-50 text-blue-700'
    };
    el.textContent = message;
    el.className = `mt-4 rounded-xl border px-4 py-3 text-sm font-bold ${tones[tone] || tones.info}`;
  }

  function setHighlightState(highlighted) {
    const button = document.getElementById('chl-lead-highlight-toggle');
    if (!button) return;
    button.dataset.highlighted = highlighted ? 'true' : 'false';
    button.setAttribute('aria-pressed', highlighted ? 'true' : 'false');
    button.className = highlighted
      ? 'inline-flex items-center gap-2 rounded-full border border-yellow-300 bg-yellow-100 px-3 py-1.5 text-xs font-black text-yellow-800 transition hover:bg-yellow-200'
      : 'inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-600 transition hover:border-yellow-300 hover:bg-yellow-50';
    const icon = button.querySelector('i');
    if (icon) icon.className = highlighted ? 'fa-solid fa-star' : 'fa-regular fa-star';
  }

  function toggleHighlight() {
    const button = document.getElementById('chl-lead-highlight-toggle');
    const next = button?.dataset.highlighted !== 'true';
    setHighlightState(next);
  }

  function updateReviewGate() {
    const checks = Array.from(document.querySelectorAll(`#${MODAL_ID} .chl-lead-review-check`));
    const reviewed = checks.filter(check => check.checked).length;
    const total = REQUIRED_REVIEW_FIELDS.length;
    const unlocked = reviewed === total;

    const progress = document.getElementById('chl-lead-review-progress');
    if (progress) {
      progress.textContent = `${reviewed} / ${total} reviewed`;
      progress.className = unlocked
        ? 'shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm'
        : 'shrink-0 rounded-full bg-white px-4 py-2 text-sm font-black text-blue-700 shadow-sm';
    }

    const status = document.getElementById('chl-lead-status');
    if (status) {
      status.disabled = !unlocked;
      status.className = unlocked
        ? 'mt-2 w-full cursor-pointer rounded-xl border border-emerald-300 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none focus:ring-2 focus:ring-emerald-400'
        : 'mt-2 w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-100 px-3 py-3 text-sm font-black text-gray-400 opacity-70 outline-none';
    }

    const lockMessage = document.getElementById('chl-lead-status-lock-message');
    if (lockMessage) {
      lockMessage.className = unlocked
        ? 'mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700'
        : 'mt-3 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs font-bold text-gray-500';
      lockMessage.innerHTML = unlocked
        ? '<i class="fa-solid fa-unlock mt-0.5"></i><span>Status is unlocked. Choose the appropriate QC result.</span>'
        : '<i class="fa-solid fa-lock mt-0.5"></i><span>Status is locked until all required fields are reviewed.</span>';
    }

    return unlocked;
  }

  function openModal(leadId) {
    const id = String(leadId || '').trim();
    const lead = leadRowsById.get(id) || findLeadInState(id);
    if (!lead) {
      window.alert('This lead could not be loaded. Refresh the Leads Tracker and try again.');
      return;
    }

    const modal = ensureModal();
    activeLeadId = id;
    lastFocusedElement = document.activeElement;
    saving = false;
    setMessage();

    const status = normalizeStatus(fieldValue(lead, 'status'));
    const homeowner = String(fieldValue(lead, 'homeowner_names') || '').trim();
    const leadLabel = homeowner || id;

    const title = document.getElementById('chl-lead-review-title');
    const subtitle = document.getElementById('chl-lead-review-subtitle');
    const badge = document.getElementById('chl-lead-review-status-badge');
    if (title) title.textContent = 'Review Lead';
    if (subtitle) subtitle.textContent = `${leadLabel} • Lead ID ${id}`;
    if (badge) {
      badge.textContent = status;
      badge.className = `inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${statusClasses(status)}`;
    }

    const staticFields = document.getElementById('chl-lead-review-static');
    if (staticFields) {
      staticFields.innerHTML = [
        readOnlyField('Date Submitted', fieldValue(lead, 'date_submitted')),
        readOnlyField('Lead ID', id),
        readOnlyField('Roofing Company', fieldValue(lead, 'company_name')),
        readOnlyField('Appointment Coordinator', fieldValue(lead, 'appointment_coordinator_name'))
      ].join('');
    }

    const fields = document.getElementById('chl-lead-review-fields');
    if (fields) {
      fields.innerHTML = [
        modalField({ id: 'homeowner_names', label: 'Homeowner Name(s)', value: fieldValue(lead, 'homeowner_names'), requiredReview: true }),
        modalField({ id: 'email_of_homeowner', label: 'Email of Homeowner', value: fieldValue(lead, 'email_of_homeowner'), type: 'email', requiredReview: true }),
        modalField({ id: 'homeowner_phone_numbers', label: 'Homeowner Phone Number', value: fieldValue(lead, 'homeowner_phone_numbers'), type: 'tel', requiredReview: true }),
        modalField({ id: 'appointment_date_time', label: 'Appointment Date / Time', value: fieldValue(lead, 'appointment_date_time'), requiredReview: true }),
        modalField({ id: 'address', label: 'Address', value: fieldValue(lead, 'address'), requiredReview: true, textarea: true, rows: 3 }),
        modalField({ id: 'age_of_roof', label: 'Age of Roof', value: fieldValue(lead, 'age_of_roof'), requiredReview: true }),
        modalField({ id: 'insurance_company', label: 'Insurance Company', value: fieldValue(lead, 'insurance_company'), requiredReview: true }),
        modalField({ id: 'additional_notes', label: 'Additional Notes', value: fieldValue(lead, 'additional_notes'), requiredReview: true, textarea: true, rows: 4 })
      ].join('');
    }

    const feedback = document.getElementById('chl-lead-feedback');
    if (feedback) feedback.value = String(fieldValue(lead, 'feedback') || '');
    setHighlightState(isTrue(fieldValue(lead, 'feedback_highlight')));

    const statusSelect = document.getElementById('chl-lead-status');
    if (statusSelect) {
      statusSelect.value = status;
      statusSelect.dataset.originalStatus = status;
    }

    modal.querySelectorAll('.chl-lead-review-check').forEach(check => {
      check.checked = false;
    });
    updateReviewGate();

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => modal.querySelector('button[data-lead-review-close="true"]')?.focus(), 30);
  }

  function closeModal() {
    if (saving) return;
    const modal = document.getElementById(MODAL_ID);
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    activeLeadId = '';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  function findLeadInState(leadId) {
    const admin = getAdmin();
    const state = admin?.getState?.() || window.portal?.adminState || {};
    const leads = Array.isArray(state?.leads) ? state.leads : [];
    return leads.find(lead => String(fieldValue(lead, 'lead_id')) === String(leadId)) || null;
  }

  function inputValue(id) {
    return String(document.getElementById(`chl-lead-${id}`)?.value || '').trim();
  }

  async function saveLeadReview() {
    if (saving) return;
    const leadId = String(activeLeadId || '').trim();
    const oldLead = leadRowsById.get(leadId) || findLeadInState(leadId);
    const client = getSupabaseClient();
    if (!leadId || !oldLead) {
      setMessage('The lead is no longer available. Refresh the tracker and try again.', 'error');
      return;
    }
    if (!client) {
      setMessage('Database connection is unavailable. Refresh the page and try again.', 'error');
      return;
    }

    const currentStatus = normalizeStatus(fieldValue(oldLead, 'status'));
    const statusSelect = document.getElementById('chl-lead-status');
    const nextStatus = normalizeStatus(statusSelect?.value || currentStatus);
    const statusChanged = nextStatus !== currentStatus;
    const allReviewed = updateReviewGate();

    if (statusChanged && !allReviewed) {
      setMessage('Review and check all eight required fields before changing the lead status.', 'error');
      return;
    }

    const feedback = String(document.getElementById('chl-lead-feedback')?.value || '').trim();
    const highlighted = document.getElementById('chl-lead-highlight-toggle')?.dataset.highlighted === 'true';
    const updatePayload = {
      homeowner_names: inputValue('homeowner_names'),
      email_of_homeowner: inputValue('email_of_homeowner'),
      homeowner_phone_numbers: inputValue('homeowner_phone_numbers'),
      appointment_date_time: inputValue('appointment_date_time'),
      address: inputValue('address'),
      age_of_roof: inputValue('age_of_roof'),
      insurance_company: inputValue('insurance_company'),
      additional_notes: inputValue('additional_notes'),
      feedback,
      feedback_highlight: highlighted
    };

    if (statusChanged) updatePayload.status = nextStatus;
    if (nextStatus === 'REJECTED') updatePayload.rejection_reason = feedback;

    const saveButton = document.getElementById('chl-lead-review-save');
    const originalButtonHtml = saveButton?.innerHTML || '';
    saving = true;
    setMessage('Saving lead changes…', 'info');
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Saving…';
    }

    try {
      const { error } = await client
        .from('leads_raw')
        .update(updatePayload)
        .eq('lead_id', leadId);

      if (error) throw error;

      // The database write is complete. Update the in-memory row immediately so
      // Management Access can repaint without waiting for the full dashboard fetch.
      const newLead = { ...oldLead, ...updatePayload };
      leadRowsById.set(leadId, newLead);

      const admin = getAdmin();
      const state = admin?.getState?.() || window.portal?.adminState || {};
      if (Array.isArray(state?.leads)) {
        const stateIndex = state.leads.findIndex(lead =>
          String(fieldValue(lead, 'lead_id')) === leadId
        );
        if (stateIndex >= 0) {
          state.leads[stateIndex] = { ...state.leads[stateIndex], ...newLead };
          leadRowsById.set(leadId, state.leads[stateIndex]);
        }
      }

      // Paint the status badge immediately. The normal filtered refresh below
      // will reconcile every other visible field without keeping the modal open.
      if (statusChanged) {
        const encodedLeadId = encodeURIComponent(leadId);
        const row = Array.from(document.querySelectorAll('#leads-table-body > tr'))
          .find(candidate => candidate.dataset.chlLeadId === encodedLeadId);
        const visibleColumns = Array.isArray(admin?._leadsCols) && admin?._leadsVisibleCols
          ? admin._leadsCols.filter(column => admin._leadsVisibleCols.has(column.key))
          : [];
        const statusIndex = visibleColumns.findIndex(column => column.key === 'status');
        const statusCell = statusIndex >= 0 ? row?.children?.[statusIndex] : null;
        if (statusCell) {
          statusCell.innerHTML = `<span class="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${statusClasses(nextStatus)}" title="Use the pencil button to review or change status">${escapeHtml(nextStatus)}</span>`;
        }
      }

      // Finish the user-facing save flow now. Audit logging, sheet sync, and the
      // filtered table refresh are intentionally non-blocking background work.
      setMessage('Lead changes saved successfully.', 'success');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Saved';
      }
      saving = false;
      window.setTimeout(() => {
        closeModal();
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.innerHTML = originalButtonHtml;
        }
      }, 180);

      window.setTimeout(() => {
        const trackedFields = Object.keys(updatePayload);
        try {
          Promise.resolve(window.portal?.createCommandCenterEvent?.({
            moduleKey: 'leads_tracker',
            entityType: 'lead',
            entityId: leadId,
            entityCode: leadId,
            entityLabel: updatePayload.homeowner_names || fieldValue(oldLead, 'homeowner_names') || leadId,
            eventType: 'updated',
            summaryText: `${window.portal?.currentUser?.name || 'User'} reviewed and updated lead ${leadId}.`,
            fieldChanges: window.portal?.buildFieldChanges
              ? window.portal.buildFieldChanges(oldLead || {}, newLead, trackedFields)
              : [],
            oldData: oldLead || null,
            newData: newLead,
            severity: 'normal',
            teamKeys: ['admin_management']
          })).catch(eventError => {
            console.error('Lead review audit event failed:', eventError);
          });
        } catch (eventError) {
          console.error('Lead review audit event failed:', eventError);
        }

        if (statusChanged) {
          try {
            window.fetch('https://automate.callhammerleads.com/webhook/update-lead-sheet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lead_id: leadId, status: nextStatus })
            }).catch(syncError => console.error('Lead sheet sync failed:', syncError));
          } catch (syncError) {
            console.error('Lead sheet sync failed:', syncError);
          }
        }

        const latestAdmin = getAdmin();
        if (latestAdmin?.applyLeadsFilters) {
          Promise.resolve(latestAdmin.applyLeadsFilters(latestAdmin._leadsPage || 1))
            .catch(refreshError => {
              console.error('Lead review background refresh failed:', refreshError);
            });
        }
      }, 0);
    } catch (error) {
      console.error('Lead review save failed:', error);
      setMessage(error?.message || 'The lead could not be saved. Please try again.', 'error');
      saving = false;
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.innerHTML = originalButtonHtml;
      }
    }
  }

  function decorateRenderedLeads(leads) {
    const admin = getAdmin();
    const tbody = document.getElementById('leads-table-body');
    if (!admin || !tbody || !Array.isArray(leads)) return;

    const visibleColumns = Array.isArray(admin._leadsCols) && admin._leadsVisibleCols
      ? admin._leadsCols.filter(column => admin._leadsVisibleCols.has(column.key))
      : [];
    const statusIndex = visibleColumns.findIndex(column => column.key === 'status');
    const rows = Array.from(tbody.querySelectorAll(':scope > tr'));

    rows.forEach((row, index) => {
      const lead = leads[index];
      if (!lead) return;
      const leadId = String(fieldValue(lead, 'lead_id') || '').trim();
      if (!leadId || leadId === 'unknown') return;
      leadRowsById.set(leadId, lead);
      row.dataset.chlLeadId = encodeURIComponent(leadId);

      if (statusIndex >= 0 && row.children[statusIndex]) {
        const status = normalizeStatus(fieldValue(lead, 'status'));
        const cell = row.children[statusIndex];
        cell.innerHTML = `<span class="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${statusClasses(status)}" title="Use the pencil button to review or change status">${escapeHtml(status)}</span>`;
      }

      const actionCell = row.lastElementChild;
      if (!actionCell || actionCell.querySelector('[data-lead-review-edit="true"]')) return;
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.dataset.leadReviewEdit = 'true';
      editButton.dataset.leadId = encodeURIComponent(leadId);
      editButton.className = 'mr-3 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700';
      editButton.title = 'Review and edit lead';
      editButton.setAttribute('aria-label', `Review and edit lead ${leadId}`);
      editButton.innerHTML = '<i class="fa-solid fa-pen"></i>';
      actionCell.insertBefore(editButton, actionCell.firstChild);
    });
  }

  function install() {
    const admin = getAdmin();
    if (!admin || admin[PATCH_FLAG] || typeof admin.renderLeads !== 'function') return false;
    admin[PATCH_FLAG] = true;
    ensureModal();

    const originalRenderLeads = admin.renderLeads;
    admin.renderLeads = function patchedRenderLeads(leads) {
      const result = originalRenderLeads.apply(this, arguments);
      decorateRenderedLeads(Array.isArray(leads) ? leads : []);
      return result;
    };

    document.addEventListener('click', event => {
      const button = event.target.closest('[data-lead-review-edit="true"]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      openModal(decodeURIComponent(button.dataset.leadId || ''));
    });

    // Refresh once so a table rendered just before this patch also receives the edit controls.
    window.setTimeout(() => {
      const body = document.getElementById('leads-table-body');
      const hasUndecoratedRows = body && body.querySelector('tr') && !body.querySelector('[data-lead-review-edit="true"]');
      if (hasUndecoratedRows && typeof admin.applyLeadsFilters === 'function') {
        Promise.resolve(admin.applyLeadsFilters(admin._leadsPage || 1)).catch(error => {
          console.error('Lead review initial refresh failed:', error);
        });
      }
    }, 300);

    admin.openLeadReviewModal = openModal;
    admin.closeLeadReviewModal = closeModal;
    return true;
  }

  if (!install()) {
    const timer = window.setInterval(() => {
      if (install()) window.clearInterval(timer);
    }, 200);
    window.setTimeout(() => window.clearInterval(timer), 15000);
  }
})();
