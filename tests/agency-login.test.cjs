const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('agency-login.html','utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n');
function setup({loginError=false, member={auth_user_id:'agency-user',role:'agency',is_active:true}, memberError=false, service=true}={}){
 const redirects=[], calls=[];
 const nodes=Object.fromEntries(['agency-login-form','agency-sign-in','agency-login-message','agency-email','agency-password'].map(id=>[id,{value:'',disabled:false,hidden:true,textContent:'',addEventListener(type,handler){this[type]=handler;}}]));
 nodes['agency-email'].value=' Agency@Example.com ';nodes['agency-password'].value=' password with spaces ';
 const client={auth:{signInWithPassword:async args=>{calls.push(['login',args]);return loginError?{error:{message:'bad'}}:{data:{user:{id:'agency-user'}}};},signOut:async args=>calls.push(['signOut',args])},rpc:name=>{calls.push(['rpc',name]);return{single:async()=>({data:member,error:memberError?{message:'denied'}:null})};}};
 const sandbox={document:{getElementById:id=>nodes[id]},window:{location:{replace:path=>redirects.push(path)}},localStorage:{removeItem:key=>calls.push(['remove',key])}};
 if(service)sandbox.window.supabase={createClient:()=>client};
 vm.runInNewContext(script,sandbox);
 return {nodes,calls,redirects,submit:()=>nodes['agency-login-form'].submit({preventDefault(){}})};
}
test('agency sign-in script is valid JavaScript',()=>assert.doesNotThrow(()=>new vm.Script(script)));
test('service load failure disables sign-in without accessing data',()=>{const x=setup({service:false});assert.equal(x.nodes['agency-sign-in'].disabled,true);assert.equal(x.calls.length,0);});
test('invalid credentials never request agency data',async()=>{const x=setup({loginError:true});await x.submit();assert.equal(x.calls.length,1);assert.equal(x.redirects.length,0);assert.equal(x.nodes['agency-password'].value,'');});
for(const member of [{auth_user_id:'other-user',role:'agency',is_active:true},{auth_user_id:'agency-user',role:'admin',is_active:true},{auth_user_id:'agency-user',role:'agency',is_active:false}])test('unverified, staff, and inactive membership is denied '+JSON.stringify(member),async()=>{const x=setup({member});await x.submit();assert.equal(x.redirects.length,0);assert.ok(x.calls.some(c=>c[0]==='signOut'&&c[1].scope==='local'));assert.match(x.nodes['agency-login-message'].textContent,/not activated/);});
test('missing backend fails closed and clears local session',async()=>{const x=setup({memberError:true});await x.submit();assert.equal(x.redirects.length,0);assert.ok(x.calls.some(c=>c[0]==='remove'&&c[1]==='ch_session'));});
test('only validated active agency membership enters the two-tab portal',async()=>{const x=setup();await x.submit();assert.deepEqual(x.redirects,['agency-access.html#submitlead']);assert.equal(x.calls[0][1].email,'agency@example.com');assert.equal(x.calls[0][1].password,' password with spaces ');assert.equal(x.nodes['agency-password'].value,'');});
