# Agency Access — staged frontend, NOT activated

## Status
Built for the OLD dashboard in `trbreychelle/CHL-Operations`, based on main commit `8c32bfff0ccf10cebc663c45d323dc18eea0aab1`. The new application in `chl-web-v2` is untouched.

This change implements the two-tab page, restricted routing, and the frontend contract for agency-scoped data. **The new backend RPCs, restricted database role, Auth hook, trusted booking attribution, and agency-account provisioning are NOT implemented or applied by this pull request. Do not merge/deploy or give external users credentials until those steps and the live negative tests below are complete.** Missing or denied agency RPCs fail closed: no fallback to staff data or raw tables.

No production data, accounts, bookings, calendars, payroll, database grants, or deployments have been changed by this work.

## Implemented interface
- Exactly two navigation tabs: **Submit Lead** and **Lead Tracker**, under **Agency Access**.
- Submit Lead retains the legacy client-calendar iframe workflow. The backend calendar list must include every active client submission calendar within the CHL organization, not a staff-assignment subset. Preserve current booking restrictions and the complete existing client form.
- Lead Tracker has the existing four columns: Date Submitted, Homeowner Name, Status, Feedback. Includes homeowner search, status/date filters, refresh, and 50-row pagination.
- No payroll, leaderboards, time tracking, employee profile, time-off, performance or command-center initialization.
- Validated Supabase authentication remains required before page content is revealed. Agency role redirects to `agency-access.html`; staff roles redirect to their existing homes. Recruitment permissions cannot extend Agency Access.
- Text is rendered with textContent, unsafe calendar URL schemes are rejected, stale responses are ignored, and failed requests/logout clear previously displayed lead data.

## Required backend contract — implement and verify before activation
The old privileged agent-leads RPC must NOT be reused. Historical schema evidence shows a security-definer overload matching coordinator display names. Names and browser-supplied email are not safe agency ownership keys. Inspect CURRENT database definitions and permissions; historical snapshots are not live validation.

Use a distinct, least-privilege PostgreSQL role `chl_agency` (NOLOGIN, NOBYPASSRLS, no authenticated-role membership and no direct business-table grants). A server-controlled Supabase access-token hook must assign it from trusted membership records. Do not use user-editable metadata. Preserve existing hooks/claims. Audit inherited PUBLIC table, view, sequence, schema and function grants and anonymous webhooks: a dedicated role does not by itself remove PUBLIC access. The browser decodes the claim only to select the profile transport; the server must enforce authorization independently.

Store agency membership and lead ownership by immutable IDs, including CHL organization, agency, authenticated submitting member and canonical lead row. Membership/role/organization/ownership fields must not be writable by agency clients. Require active membership and agency status on every request; do not accept a client-supplied agency ID. Deny all operations not expressly allowed below, including lead edits/deletion/status changes.

Required RPC responses (the names are implemented in the UI, NOT yet in the live database):

| RPC | Arguments | Required response and checks |
| --- | --- | --- |
| `get_my_agency_session` | none | Exactly one row: id, auth_user_id, organization_id, email, full_name, display_name, role='agency', is_active, can_access_recruitment_dashboard=false. Require signed role `chl_agency`, auth.uid(), and active trusted membership. No raw profile-table grant. |
| `get_my_agency_context` | none | JSON object `{enabled: true, agency_name: '...'}` only after activation preflight passes. Disabled agencies return enabled=false or permission denied. |
| `get_my_agency_submission_routes` | none | Array of `{id, company_name}` for all eligible active client_submission_routes in the member's verified CHL organization. No calendar credentials or unrelated client fields. |
| `open_my_agency_calendar` | p_route_id UUID | JSON object `{calendar_url, company_name}`. Verify route/organization/active status; return HTTPS booking URL, server-derived legacy tracking metadata, and an unpredictable single-use booking ticket valid for two hours. No caller-provided identity or raw route URL. |
| `get_my_agency_leads` | p_status text, p_search text, p_period text, p_custom_start date, p_custom_end date, p_limit integer, p_offset integer | Array of `{date_submitted: 'YYYY-MM-DD', homeowner_names, status, feedback, total_count}`. Join canonical leads through immutable agency ownership and organization. total_count repeats the filtered total on every row. Empty page returns []. Bound limits and offset, parameterize search, preserve MST date semantics and the legacy Saturday–Friday week. Stable sort by submitted date and canonical ID. |

Allowed UI periods: today, this-week, previous-week, 30-days, 4-weeks, 6-weeks, all-time, custom. Status choices: all, approved, rejected, credited, pending review. Validate these on the server. Derive display status/feedback from the same canonical lead that internal reviewers update, rather than a disconnected agency copy.

## Trusted calendar-to-lead attribution
Configure the existing GHL form to preserve the opaque agency booking ticket in a dedicated hidden custom field. In the trusted n8n intake, verify the provider/webhook authentication, resolve the canonical lead/client/calendar, then consume that ticket atomically and bind the lead to its agency and submitting member. The browser must not be able to call the privileged ownership-linking function.

Reject expired tickets, wrong calendars/clients/organizations, inactive members, attempts to reuse a ticket for a different lead, and forged email/name ownership. Make retries for the same confirmed event and lead idempotent. A ticket is a short-lived bearer credential: do not log it, persist it in browser storage, or include it in error reports. Retain an auditable ownership record. Booking submission success and downstream tracker appearance must both be checked end to end.

## Release gate
1. Reconnect the old Supabase/Coolify and n8n administration sessions. Inspect and back up current schema, grants, hooks and the live booking workflow. Build and review the backend above without changing staff business data.
2. In isolated test data, verify agencies A and B can both see the full permitted client calendar list, but neither can read/count/search/export/update/delete the other's leads or internal employee/payroll/client records. Test raw API/RPC/view access and unauthenticated legacy webhooks, not just sidebar visibility. Verify inactive users, forged claims, changed names, user switching and expired sessions.
3. Submit a synthetic booking using the full existing client form. Verify exactly one canonical lead, the correct immutable agency owner, internal visibility, external own-lead visibility, status-change propagation and idempotent retries. Verify no spurious payroll or employee record is created.
4. Re-test existing staff login, calendars and tracker. Only then merge the frontend, deploy, provision the user-specified agency identity and issue its login. Do not invent an agency name or email.

## Local verification
`node --check main.js`, `node --check agency-access.js`, and `node --test tests/agency-access.test.cjs` pass (27 tests). These exercise source-level frontend routing and fake RPC responses, not live database isolation.

An offline Chromium controller check also passed: exactly two tabs, client selection, tracker rendering, literal HTML-like text, error cleanup, forbidden hash normalization, 390px layout, and logout cleanup. Its screenshots use clearly labeled synthetic data. Real GHL booking, deployed login, server-side isolation and account activation remain untested.

`tools/apply-agency-routing.py` is a guarded source transformation, not a database migration. It accepts only the verified original main.js blob and refuses unrelated source revisions. The resulting reviewed main.js blob is `0611011a020d3df70352de96c396722815bee443`.
