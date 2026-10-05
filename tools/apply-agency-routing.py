#!/usr/bin/env python3
"""Apply the reviewed Agency Access integration to the exact legacy source.
Run from the repository root. Refuses unknown or partially modified source.
"""
from pathlib import Path
import hashlib
import re

path = Path('main.js')
raw = path.read_bytes()
blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
if 'async loadPortalProfile(authUser)' in raw.decode('utf-8'):
    print('Agency routing is already present; no changes made.')
    raise SystemExit(0)
if blob != 'd4df96fe4bd7b0d4d84976369037ffb4c42f51d9':
    raise SystemExit(f'Review required: main.js changed (blob {blob}).')
s = raw.decode('utf-8')
def one(old: str, new: str) -> None:
    global s
    if s.count(old) != 1:
        raise SystemExit(f'Expected exactly one patch location: {old[:65]!r}')
    s = s.replace(old, new, 1)
one("  if (role === 'recruitment') return 'recruitment-dashboard.html';", "  if (role === 'agency') return 'agency-access.html';\n  if (role === 'recruitment') return 'recruitment-dashboard.html';")
one("      'agent-dashboard.html',", "      'agent-dashboard.html',\n      'agency-access.html',")
one("    const onAgent = path.includes('agent-dashboard');", "    const onAgent = path.includes('agent-dashboard');\n    const onAgency = path.endsWith('/agency-access.html');")
one("    if (role === 'admin') {", "    if (role === 'agency') {\n      if (!onAgency) target = 'agency-access.html';\n    } else if (role === 'admin') {")
one("    if (isProtectedPage) {\n      this.revealProtectedPage();\n    }", """    // Agency Access has its own narrow RPC surface. Never initialize the
    // employee/command-center data loaders, even when a forged hash is present.
    if (path.endsWith('/agency-access.html')) {
      if (!window.CHLAgencyAccess || this.currentUser?.role !== 'agency') {
        this.clearSession();
        window.location.replace('index.html');
        return;
      }
      await window.CHLAgencyAccess.start(this);
      this.revealProtectedPage();
      return;
    }

    if (isProtectedPage) {
      this.revealProtectedPage();
    }""")
pattern = r"const \{ data: profile, error: profileError \} = await this\.supabase\s*\.from\('profiles'\)\s*\.select\('id, auth_user_id, organization_id, email, full_name, display_name, role, is_active, can_access_recruitment_dashboard'\)\s*\.eq\('auth_user_id', authUser\.id\)\s*\.single\(\);"
s, count = re.subn(pattern, 'const { data: profile, error: profileError } = await this.loadPortalProfile(authUser);', s)
if count != 2:
    raise SystemExit(f'Expected two profile reads, found {count}. No file written.')
one('  async loginWithCredentials(email, password) {', """  async loadPortalProfile(authUser) {
    // authUser has already been validated by signInWithPassword/getUser.
    // The decoded claim selects a transport, NOT authorization: each RPC must
    // validate auth.uid(), active membership, and the server-issued database role.
    const { data, error } = await this.supabase.auth.getSession();
    if (error || !authUser || data?.session?.user?.id !== authUser.id) {
      return { data: null, error: new Error('Please sign in again.') };
    }
    let tokenRole;
    try {
      const segment = data.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      tokenRole = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '='))).role;
    } catch (_) {
      return { data: null, error: new Error('Invalid login session.') };
    }
    if (tokenRole === 'chl_agency') {
      const result = await this.supabase.rpc('get_my_agency_session').single();
      if (result.error) return result;
      if (result.data?.auth_user_id !== authUser.id || result.data?.role !== 'agency') {
        return { data: null, error: new Error('Agency Access is not activated.') };
      }
      return result;
    }
    const result = await this.supabase.from('profiles')
      .select('id, auth_user_id, organization_id, email, full_name, display_name, role, is_active, can_access_recruitment_dashboard')
      .eq('auth_user_id', authUser.id).single();
    if (String(result.data?.role || '').toLowerCase() === 'agency') {
      return { data: null, error: new Error('Agency Access requires its restricted login configuration.') };
    }
    return result;
  }

  async loginWithCredentials(email, password) {""")
path.write_bytes(s.encode('utf-8'))
print('Applied Agency Access routing to the verified legacy source.')
