# Old Supabase payroll query repair — 2026-10-13

## Applied change
Applied a database-side optimization to the existing self-hosted Supabase at `supabase.callhammerleads.com` / `api.supabase.callhammerleads.com`. The new application and new Supabase were not changed.

Only the matching portions of `public.payroll_time_events_view` and `public.payroll_leads_weekly` were replaced. The former OR/correlated-EXISTS matching repeatedly compared time entries and leads against workers and aliases. The equivalent implementation uses separate email/alias joins with duplicate worker/event matches removed, and a deduplicated normalized worker-name mapping for leads.

The time-segment pairing, 16-hour maximum segment rule, status buckets, payroll formula view, rates, bonuses, approvals, locks, existing view owners, grants, and options were preserved. No payroll, time-entry, lead, worker, payment or approval records were edited. No authentication policies were changed and no global query timeouts were increased.

## Measured checks
The target payroll week was October 3–9, 2026 (week id `56485693-b922-47f7-a602-1a1e262ae42c`).

| Check | Result |
| --- | --- |
| Original selected-week query | 19 rows; 9,598.022 ms execution |
| Temporary candidate selected-week query | 19 rows; 540.253 ms execution |
| Complete time-segment comparison | 10,919 original / 10,919 candidate; 0 differences |
| Complete lead-summary comparison | 1,111 original / 1,111 candidate; 0 differences |
| Selected-week full payroll comparison | 19 original / 19 candidate; 0 differences |
| Production all-history comparison | 1,391 original / 1,391 optimized rows across 41 weeks; 0 differences |
| Existing view ownership/grants/options | Unchanged |
| Main payroll formula definition | Unchanged |
| Post-commit query under existing `authenticated` role | 19 rows; 536.944 ms execution; existing SELECT grant present |

The comparisons used `EXCEPT ALL` in both directions across complete rows. The production repair used one repeatable-read transaction, checked original view-definition fingerprints, captured a temporary all-history snapshot, replaced the two views, and aborted on any result or permission difference. The temporary snapshot was dropped on commit. A separate read-only transaction confirmed that the optimized query worked after commit under the existing staff database role.

## Scope of verification
These are live database measurements, not an end-to-end test of a user's signed-in dashboard tab or measured browser page-load times. The user's existing Payroll & Finance tab should retry its request to the same database. No user-specific session or credentials were created for testing.

## Rollback provenance
The original two view definitions were captured before modification. Their downloaded text was verified locally against the pre-repair database MD5 fingerprints:
- `payroll_time_events_view`: `e1630bbebe92e604a8e240a993e946d1`
- `payroll_leads_weekly`: `b26c8bd2c59f9a4af094a748b76998dd`

The unchanged `payroll_weekly_fact_v2` definition fingerprint was `697f896bd049382ffafaab0f7adcde7b`. A rollback is not needed for normal use; restoring the original matching queries would restore their performance bottleneck.

Temporary diagnostics, comparison, and repair HTML forms were removed from the repository after the repair. The guarded application SQL remains in repository history at commit `acd70157a10393f81a534420be5b1ba604f7c44e` for audit, not automatic re-execution.
