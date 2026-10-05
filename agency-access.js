/* Agency-only portal. Never fall back to employee RPCs or raw business tables. */
(function (root) {
  'use strict';
  const PAGE_SIZE = 50;
  const allowedViews = new Set(['submitlead', 'leads']);
  const viewFromHash = hash => allowedViews.has(String(hash).replace(/^#/, '')) ? String(hash).replace(/^#/, '') : 'submitlead';
  const badgeClass = status => {
    const value = String(status || '').toLowerCase();
    if (value.includes('credit')) return 'credited';
    if (value.includes('reject')) return 'rejected';
    if (value.includes('approv') || value.includes('confirm')) return 'approved';
    if (value.includes('pending')) return 'pending';
    return '';
  };
  function safeCalendarUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid calendar URL.');
    return url.href;
  }
  async function start(portal) {
    const doc = root.document;
    const el = id => doc.getElementById(id);
    let ready = false, stopped = false, offset = 0, querySequence = 0, calendarSequence = 0, debounce;
    let page = viewFromHash(root.location.hash);
    const message = text => { el('agency-message').textContent = text || ''; el('agency-message').hidden = !text; };
    const empty = text => {
      const row = doc.createElement('tr'), cell = doc.createElement('td');
      cell.colSpan = 4; cell.className = 'empty'; cell.textContent = text;
      row.append(cell); el('leads-table-body').replaceChildren(row);
    };
    const clearCalendar = () => {
      el('client-calendar-frame').src = 'about:blank';
      el('client-calendar-wrapper').hidden = true;
      el('calendar-placeholder').hidden = false;
    };
    const stop = () => {
      stopped = true; ready = false; querySequence++; calendarSequence++;
      clearTimeout(debounce); clearCalendar(); empty('Sign in to view your agency’s leads.');
      el('submit-client').disabled = true;
      el('agency-prev').disabled = true; el('agency-next').disabled = true;
      el('leads-count-display').textContent = '';
    };
    const rpc = async (name, args) => {
      const result = await portal.supabase.rpc(name, args);
      if (result.error) throw result.error;
      return result.data;
    };
    el('agency-logout').addEventListener('click', async () => { stop(); await portal.logout(); });
    const subscription = portal.supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { stop(); root.location.replace('index.html'); }
    });
    const showPage = () => {
      page = viewFromHash(root.location.hash);
      if (root.location.hash !== '#' + page) root.history.replaceState(null, '', '#' + page);
      for (const view of allowedViews) el('view-' + view).hidden = view !== page;
      doc.querySelectorAll('.nav-item').forEach(link => {
        if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      if (ready && page === 'leads') { offset = 0; loadLeads(); }
    };
    root.addEventListener('hashchange', showPage);
    showPage();
    async function loadLeads() {
      if (!ready || stopped) return;
      const sequence = ++querySequence;
      el('agency-prev').disabled = true; el('agency-next').disabled = true;
      el('leads-count-display').textContent = '';
      const startDate = el('leads-start').value || null, endDate = el('leads-end').value || null;
      if (!!startDate !== !!endDate || (startDate && startDate > endDate)) {
        empty('Select a valid start and end date.'); message('Select both dates, with the end date on or after the start date.'); return;
      }
      message(''); empty('Loading your agency’s leads…');
      try {
        const rows = await rpc('get_my_agency_leads', {
          p_status: el('status-filter').value, p_search: el('leads-search').value,
          p_period: startDate ? 'custom' : el('leads-timeframe').value,
          p_custom_start: startDate, p_custom_end: endDate,
          p_limit: PAGE_SIZE, p_offset: offset
        });
        if (sequence !== querySequence || stopped) return;
        if (!Array.isArray(rows)) throw new Error('Invalid tracker response.');
        const total = rows.length ? Number(rows[0].total_count) : 0;
        if (!Number.isSafeInteger(total) || total < rows.length) throw new Error('Invalid tracker count.');
        if (!rows.length && offset) { offset = 0; return loadLeads(); }
        const fragment = doc.createDocumentFragment();
        for (const lead of rows) {
          const row = doc.createElement('tr');
          const date = /^\d{4}-\d{2}-\d{2}$/.test(lead.date_submitted || '')
            ? new Date(lead.date_submitted + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}) : '—';
          for (const [index, value] of [date, lead.homeowner_names || 'Unknown', lead.status || 'Pending Review', lead.feedback || '—'].entries()) {
            const cell = doc.createElement('td');
            if (index === 2) { const badge = doc.createElement('span'); badge.className = 'badge ' + badgeClass(value); badge.textContent = value; cell.append(badge); }
            else cell.textContent = value;
            row.append(cell);
          }
          fragment.append(row);
        }
        if (rows.length) el('leads-table-body').replaceChildren(fragment);
        else empty('No agency leads match these filters. Try All Time or clear the filters.');
        el('leads-count-display').textContent = total ? `${offset + 1}–${offset + rows.length} of ${total} leads` : '0 leads';
        el('agency-prev').disabled = offset === 0;
        el('agency-next').disabled = offset + rows.length >= total;
      } catch (error) {
        if (sequence !== querySequence || stopped) return;
        empty('Lead Tracker could not be loaded.');
        message('Unable to load agency leads. Refresh to retry; contact your administrator if this continues.');
      }
    }
    function resetAndLoad() { offset = 0; loadLeads(); }
    el('agency-filters').addEventListener('submit', event => { event.preventDefault(); resetAndLoad(); });
    el('leads-search').addEventListener('input', () => { clearTimeout(debounce); querySequence++; debounce = setTimeout(resetAndLoad, 250); });
    for (const id of ['status-filter', 'leads-timeframe', 'leads-start', 'leads-end']) el(id).addEventListener('change', resetAndLoad);
    el('clear-leads-filters').addEventListener('click', () => { el('agency-filters').reset(); resetAndLoad(); });
    el('refresh-agency-leads').addEventListener('click', resetAndLoad);
    el('agency-prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); loadLeads(); });
    el('agency-next').addEventListener('click', () => { offset += PAGE_SIZE; loadLeads(); });
    el('submit-client').addEventListener('change', async () => {
      const sequence = ++calendarSequence, routeId = el('submit-client').value;
      clearCalendar(); message('');
      if (!routeId || !ready || stopped) return;
      try {
        // The server chooses identity, organization, calendar, and one-time ticket.
        const booking = await rpc('open_my_agency_calendar', {p_route_id: routeId});
        if (sequence !== calendarSequence || stopped) return;
        if (!booking || !booking.calendar_url) throw new Error('Missing calendar.');
        el('client-calendar-frame').src = safeCalendarUrl(booking.calendar_url);
        el('selected-calendar-label').textContent = booking.company_name || 'Selected Client';
        el('client-calendar-wrapper').hidden = false; el('calendar-placeholder').hidden = true;
      } catch (error) {
        if (sequence === calendarSequence && !stopped) message('The calendar could not be opened. Choose the client again to retry.');
      }
    });
    const onFocus = () => { if (page === 'leads' && !doc.hidden) loadLeads(); };
    root.addEventListener('focus', onFocus);
    doc.addEventListener('visibilitychange', onFocus);
    root.addEventListener('pagehide', () => { stop(); subscription?.data?.subscription?.unsubscribe(); }, {once: true});
    root.addEventListener('pageshow', event => { if (event.persisted) root.location.reload(); });
    try {
      const context = await rpc('get_my_agency_context');
      if (stopped) return;
      if (!context || context.enabled !== true) throw new Error('Agency access not enabled.');
      el('agency-name').textContent = context.agency_name || 'Agency Access';
      el('agency-user-name').textContent = portal.currentUser?.name || '';
      const routes = await rpc('get_my_agency_submission_routes');
      if (stopped) return;
      if (!Array.isArray(routes)) throw new Error('Invalid calendar response.');
      const options = doc.createDocumentFragment();
      const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = routes.length ? 'Select Client' : 'No active client calendars'; options.append(placeholder);
      for (const route of routes) { const option = doc.createElement('option'); option.value = route.id; option.textContent = route.company_name; options.append(option); }
      el('submit-client').replaceChildren(options); el('submit-client').disabled = !routes.length;
      ready = true; if (page === 'leads') loadLeads();
    } catch (error) {
      el('submit-client').replaceChildren();
      const option = doc.createElement('option'); option.textContent = 'Agency Access is not activated'; el('submit-client').append(option);
      message('Agency Access is not activated or your permission has expired. Please contact your administrator.');
      empty('Agency Access must be activated before leads can be displayed.');
    }
  }
  root.CHLAgencyAccess = Object.freeze({start, viewFromHash, badgeClass, safeCalendarUrl});
})(typeof window !== 'undefined' ? window : globalThis);
