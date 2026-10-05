const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('main.js', 'utf8');
function environment(path='/agency-access.html') {
  const redirects = [], calls = [];
  const window = {location:{pathname:path,replace:target=>redirects.push(target)}, CHLAgencyAccess:{start:async()=>calls.push('agency')}};
  const sandbox = {window,document:{documentElement:{classList:{remove:()=>calls.push('reveal')}}},console,atob:s=>Buffer.from(s,'base64').toString('binary')};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(0,source.indexOf('window.portal = window.portal || new CallHammerPortal();'))+'\nthis.Portal = CallHammerPortal;', sandbox);
  const portal = Object.create(sandbox.Portal.prototype);
  portal.clearSession=()=>{portal.currentUser=null;};
  portal.saveSession=user=>{portal.currentUser=user;};
  portal.currentUser={id:'profile-a',auth_user_id:'user-a',role:'agency',can_access_recruitment_dashboard:true};
  return {portal,window,redirects,calls};
}
for (const path of ['admin-dashboard.html','agent-dashboard.html','management-dashboard.html','recruitment-dashboard.html','salesdashboard.html','salesrep-dashboard.html']) {
  test(`agency direct link to ${path} redirects before any data load`,()=>{
    const {portal,redirects}=environment('/'+path);
    assert.equal(portal.enforceRoleRouting(),true);
    assert.deepEqual(redirects,['agency-access.html']);
  });
}
for (const [role,home] of Object.entries({admin:'admin-dashboard.html',agent:'agent-dashboard.html',management:'management-dashboard.html',recruitment:'recruitment-dashboard.html',sales:'salesdashboard.html',sales_rep:'salesrep-dashboard.html',team_leader:'salesdashboard.html'})) {
  test(`${role} cannot enter Agency Access`,()=>{
    const {portal,redirects}=environment();portal.currentUser.role=role;
    assert.equal(portal.enforceRoleRouting(),true);assert.deepEqual(redirects,[home]);
    assert.equal(portal.routeByRole(role),home);
  });
}
test('agency role has its own protected home',()=>{
  const {portal}=environment();assert.equal(portal.routeByRole('agency'),'agency-access.html');
  assert.equal(portal.isProtectedDashboardPath('/agency-access.html'),true);
  assert.equal(portal.enforceRoleRouting(),false);
});
test('no employee, payroll, admin, or passbook loaders initialize for agency',async()=>{
  const {portal,calls}=environment();portal.checkExistingSession=async()=>true;
  for (const name of ['updateDashboardIdentity','bindEvents','bindPassbookUpdateButton','fetchAllData','loadTimeOffHistory','fetchAdminData','loadAgentLeadsWithFilters']) portal[name]=()=>assert.fail(name+' must not run');
  await portal.init();assert.deepEqual(calls,['agency','reveal']);
});
test('unauthenticated deep link remains hidden and redirects to login',async()=>{
  const {portal,calls,redirects}=environment();portal.checkExistingSession=async()=>{portal.currentUser=null;};
  await portal.init();assert.deepEqual(calls,[]);assert.deepEqual(redirects,['index.html']);
});
test('agency without its script fails closed',async()=>{
  const {portal,window,calls,redirects}=environment();delete window.CHLAgencyAccess;portal.checkExistingSession=async()=>true;
  await portal.init();assert.deepEqual(calls,[]);assert.deepEqual(redirects,['index.html']);
});
test('cached profile is not an authenticated session',async()=>{
  const {portal}=environment();portal.supabase={auth:{getUser:async()=>({data:{},error:new Error('expired')})},from:()=>assert.fail('No profile read without verified user')};
  assert.equal(await portal.checkExistingSession(),false);assert.equal(portal.currentUser,null);
});
function session(role='chl_agency',userId='user-a') {return {data:{session:{user:{id:userId},access_token:'x.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature'}}};}
test('restricted session only reads agency RPC, never profiles table',async()=>{
  const {portal}=environment();const data={auth_user_id:'user-a',role:'agency'};let rpc;
  portal.supabase={auth:{getSession:async()=>session()},from:()=>assert.fail('Raw table forbidden'),rpc:name=>{rpc=name;return {single:async()=>({data})};}};
  assert.deepEqual(await portal.loadPortalProfile({id:'user-a'}),{data});assert.equal(rpc,'get_my_agency_session');
});
test('mismatched authenticated user cannot load agency profile',async()=>{
  const {portal}=environment();portal.supabase={auth:{getSession:async()=>session('chl_agency','user-b')},rpc:()=>assert.fail('No RPC')};
  assert.ok((await portal.loadPortalProfile({id:'user-a'})).error);
});
test('agency RPC cannot supply another user identity',async()=>{
  const {portal}=environment();portal.supabase={auth:{getSession:async()=>session()},rpc:()=>({single:async()=>({data:{auth_user_id:'user-b',role:'agency'}})})};
  assert.ok((await portal.loadPortalProfile({id:'user-a'})).error);
});
test('agency profile on unrestricted authenticated role is rejected',async()=>{
  const {portal}=environment();const builder={select:()=>builder,eq:()=>builder,single:async()=>({data:{role:'agency'}})};
  portal.supabase={auth:{getSession:async()=>session('authenticated')},from:()=>builder};
  assert.ok((await portal.loadPortalProfile({id:'user-a'})).error);
});
test('normal staff profile loading remains on existing table',async()=>{
  const {portal}=environment();const data={role:'agent',id:'staff'};const builder={select:()=>builder,eq:()=>builder,single:async()=>({data})};
  portal.supabase={auth:{getSession:async()=>session('authenticated')},from:()=>builder};
  assert.deepEqual(await portal.loadPortalProfile({id:'user-a'}),{data});
});
const context={URL};vm.createContext(context);vm.runInContext(fs.readFileSync('agency-access.js','utf8'),context);
test('hash allowlist contains only two pages',()=>{
  for (const hash of ['#payroll','#overview','#profile','#leads/other','#admin','']) assert.equal(context.CHLAgencyAccess.viewFromHash(hash),'submitlead');
  assert.equal(context.CHLAgencyAccess.viewFromHash('#leads'),'leads');
});
test('unsafe calendar URL schemes and credentials are rejected',()=>{
  for (const url of ['javascript:alert(1)','data:text/html,hi','http://example.com','https://user:pass@example.com','/relative']) assert.throws(()=>context.CHLAgencyAccess.safeCalendarUrl(url));
  assert.equal(context.CHLAgencyAccess.safeCalendarUrl('https://calendar.example/book'),'https://calendar.example/book');
});
test('page has exactly two navigation items and no employee views',()=>{
  const html=fs.readFileSync('agency-access.html','utf8');
  assert.equal((html.match(/class="nav-item"/g)||[]).length,2);
  assert.equal((html.match(/<section id="view-/g)||[]).length,2);
  assert.match(html,/<html[^>]*class="auth-pending"/);
  assert.doesNotMatch(html,/view-(payroll|overview|timeoff|profile|leaderboards)/);
});
test('tracker has no raw table or employee RPC fallback and renders safe text',()=>{
  const js=fs.readFileSync('agency-access.js','utf8');
  assert.doesNotMatch(js,/\.from\s*\(|get_my_agent_leads|innerHTML|insertAdjacentHTML/);
  assert.match(js,/get_my_agency_leads/);assert.match(js,/textContent/);
});
