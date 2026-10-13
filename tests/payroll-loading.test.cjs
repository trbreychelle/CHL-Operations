const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.PAYROLL_DASHBOARD || 'admin-dashboard.html', 'utf8');
const start = source.indexOf('const AdminDashboard = {');
const end = source.indexOf('\n      };', source.indexOf('nav(viewId, linkEl) {', start)) + '\n      };'.length;
const adminScript = source.slice(start, end) + '\nthis.Admin = AdminDashboard;';

class Element {
  constructor(tag='div', id='') {
    this.tagName=tag; this.id=id; this.dataset={}; this.children=[]; this.events={};
    this._text=''; this._html=''; this._value=''; this.disabled=false; this.hidden=false;
    this.classList={contains:name=>name==='hidden',add(){},remove(){},toggle(){}};
    this.parentNode={replaceChild:(next,old)=>{Object.assign(old,next);}};
  }
  get value(){return this._value;}
  set value(value){this._value=String(value);}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(value){this._text=String(value);this._html='';this.children=[];}
  get innerHTML(){return this._html || this.textContent;}
  set innerHTML(value){this._html=String(value);this._text='';this.children=[];}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;this._html='';this._text='';if(this.tagName==='select')this._value=children[0]?.value||'';}
  addEventListener(type,handler){this.events[type]=handler;}
  cloneNode(){const n=new Element(this.tagName,this.id);n.disabled=this.disabled;return n;}
  contains(){return false;}
  get options(){return this.children;}
  get selectedIndex(){return this.children.findIndex(c=>c.value===this.value);}
}
const weeks=[{id:'w2',week_start:'2026-09-26',week_end:'2026-10-02'},{id:'w1',week_start:'2026-09-19',week_end:'2026-09-25'}];
const row={week_id:'w1',week_start:'2026-09-19',week_end:'2026-09-25',worker_id:'worker1',display_name:'Test Worker',country:'PH',adjusted_hours:32,final_pay:123.45,auto_incentive_delta:17,manual_incentive_delta:3};
function setup({initial=[],provider,weekRows=weeks}={}) {
  const nodes=new Map();
  const idNames=['payroll-week-select','payroll-retry','payroll-load-status','payroll-load-message','payroll-summary-body','payroll-ledger-body','ceo-total-payout','payroll-notifications','payroll-notes-container','payroll-export','payroll-ledger-period','payroll-history-view'];
  idNames.forEach(id=>nodes.set(id,new Element(id==='payroll-week-select'?'select':'div',id)));
  const select=nodes.get('payroll-week-select');const placeholder=new Element('option');placeholder.value='latest';placeholder.textContent='Loading Weeks...';select.replaceChildren(placeholder);
  const calls=[];
  const client={from(table){
    const args={table,filters:{}};
    const builder={select(columns){args.columns=columns;return builder;},order(){return builder;},eq(key,value){args.filters[key]=value;return builder;},abortSignal(signal){args.signal=signal;return builder;},then(resolve,reject){calls.push(args);return Promise.resolve().then(()=>provider?provider(args):({data:table==='payroll_weeks'?weekRows:[],error:null})).then(resolve,reject);}};
    return builder;
  }};
  const state={payrollWeeklyFactView:[...initial],payrollWorkers:[],payrollConsistencyBonusStatus:[]};
  const context={window:{portal:{adminState:state,supabase:client}},document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag),addEventListener(){}},console:{log(){},warn(){},error(){}},supaClient:client,setTimeout,clearTimeout,AbortController,Map,Set,Date};
  vm.createContext(context);vm.runInContext(adminScript,context);
  const admin=context.Admin;
  admin.loadPayrollNotes=async()=>{};
  return {admin,nodes,state,calls,client,select,context};
}
function callsTo(x,table){return x.calls.filter(c=>c.table===table);}
test('all inline dashboard scripts compile',()=>{
  for(const m of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(m[1]));
});
test('empty initial payroll still populates every available week and finishes loading',async()=>{
  const x=setup();await x.admin.renderPayrollFinance();
  assert.equal(x.select.options.length,2);assert.equal(x.select.value,'w2');assert.equal(x.select.disabled,false);
  assert.doesNotMatch(x.select.textContent,/Loading/);assert.match(x.nodes.get('payroll-summary-body').innerHTML,/No payroll rows/);
  assert.equal(x.nodes.get('payroll-export').disabled,true);assert.equal(x.nodes.get('ceo-total-payout').textContent,'$0.00');
});
test('empty selected week can switch to a historical week with real backend amounts',async()=>{
  const x=setup({provider:({table,filters})=>({data:table==='payroll_weeks'?weeks:filters.week_id==='w1'?[row]:[]})});
  await x.admin.renderPayrollFinance();x.select.value='w1';x.select.events.change();await x.admin._payrollRenderPromise;
  assert.equal(x.select.value,'w1');assert.match(x.nodes.get('payroll-summary-body').innerHTML,/Test Worker/);
  assert.equal(x.nodes.get('ceo-total-payout').textContent,'$123.45');assert.equal(x.nodes.get('payroll-export').disabled,false);
  assert.match(x.nodes.get('payroll-summary-body').innerHTML,/\$20\.00/);
});
test('populated existing history selects the latest loaded period without unnecessary row reads',async()=>{
  const x=setup({initial:[row]});await x.admin.renderPayrollFinance();
  assert.equal(x.select.value,'w1');assert.equal(callsTo(x,'payroll_weekly_fact_v2').length,0);assert.equal(x.nodes.get('ceo-total-payout').textContent,'$123.45');
});
test('week list permission failure leaves a retry, not Loading Weeks or a false zero payout',async()=>{
  const x=setup({provider:()=>({error:{code:'42501',message:'denied'}})});await x.admin.renderPayrollFinance();
  assert.equal(x.select.textContent,'Unable to load weeks');assert.equal(x.select.disabled,true);
  assert.equal(x.nodes.get('payroll-retry').hidden,false);assert.match(x.nodes.get('payroll-load-message').textContent,/Sign in again/);
  assert.equal(x.nodes.get('ceo-total-payout').textContent,'—');assert.equal(x.nodes.get('payroll-export').disabled,true);
});
test('row read failure keeps period navigation available and reports an error separately from empty data',async()=>{
  const x=setup({provider:({table})=>table==='payroll_weeks'?{data:weeks}:{error:{code:'57014',message:'statement timeout'}}});
  await x.admin.renderPayrollFinance();assert.equal(x.select.disabled,false);assert.equal(x.nodes.get('ceo-total-payout').textContent,'—');
  assert.match(x.nodes.get('payroll-load-message').textContent,/57014/);assert.match(x.nodes.get('payroll-summary-body').textContent,/unavailable/);
});
test('no week metadata yields an explicit no-weeks state, not infinite loading',async()=>{
  const x=setup({weekRows:[]});await x.admin.renderPayrollFinance();assert.equal(x.select.textContent,'No payroll weeks available');assert.equal(x.select.disabled,true);assert.equal(callsTo(x,'payroll_weekly_fact_v2').length,0);
});
test('concurrent week reads share their request and all callers receive success',async()=>{
  let finish;const x=setup({provider:()=>new Promise(resolve=>{finish=resolve;})});
  const a=x.admin.loadPayrollWeek('w1'),b=x.admin.loadPayrollWeek('w1');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.calls.length,1);finish({data:[row]});assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(x.state.payrollWeeklyFactView.length,1);assert.equal(x.admin._payrollLoadingWeeks.size,0);
});
test('a successfully empty week is cached instead of being fetched every render',async()=>{
  const x=setup();await x.admin.renderPayrollFinance();await x.admin.renderPayrollFinance();assert.equal(callsTo(x,'payroll_weekly_fact_v2').length,1);
});
test('retry reloads an empty week and displays newly available payroll',async()=>{
  let ready=false;const x=setup({provider:({table})=>({data:table==='payroll_weeks'?weeks:ready?[{...row,week_id:'w2'}]:[]})});
  await x.admin.renderPayrollFinance();ready=true;await x.admin.retryPayrollLoad();assert.equal(x.nodes.get('ceo-total-payout').textContent,'$123.45');assert.equal(callsTo(x,'payroll_weekly_fact_v2').length,2);
});
test('a failed forced reload preserves stored rows but hides stale totals and disables export',async()=>{
  let fail=false;const x=setup({initial:[row],provider:({table})=>table==='payroll_weeks'?{data:weeks}:fail?{error:{code:'42501'}}:{data:[row]}});
  await x.admin.renderPayrollFinance();fail=true;await x.admin.retryPayrollLoad();assert.equal(x.state.payrollWeeklyFactView[0].final_pay,123.45);
  assert.equal(x.nodes.get('ceo-total-payout').textContent,'—');assert.equal(x.nodes.get('payroll-export').disabled,true);assert.doesNotMatch(x.nodes.get('payroll-summary-body').innerHTML,/MARK PAID/);
});
test('hung requests time out, abort, release controls, and cannot update data later',async()=>{
  let finish;const x=setup({provider:({table})=>table==='payroll_weeks'?{data:weeks}:new Promise(resolve=>{finish=resolve;})});x.admin._payrollTimeoutMs=10;
  await x.admin.renderPayrollFinance();assert.match(x.nodes.get('payroll-load-message').textContent,/timed out/);assert.equal(x.select.disabled,false);assert.equal(x.nodes.get('payroll-retry').disabled,false);
  assert.equal(callsTo(x,'payroll_weekly_fact_v2')[0].signal.aborted,true);finish({data:[row]});await new Promise(resolve=>setImmediate(resolve));assert.equal(x.state.payrollWeeklyFactView.length,0);
});
test('metadata timeouts clear loading and re-enable Retry',async()=>{
  const x=setup({provider:()=>new Promise(()=>{})});x.admin._payrollTimeoutMs=10;await x.admin.renderPayrollFinance();assert.equal(x.select.textContent,'Unable to load weeks');assert.equal(x.nodes.get('payroll-retry').disabled,false);
});
test('network rejection is contained and an explicit retry recovers',async()=>{
  let fail=true;const x=setup({provider:({table})=>{if(fail)throw new TypeError('Failed to fetch');return {data:table==='payroll_weeks'?weeks:[]};}});
  await x.admin.renderPayrollFinance();fail=false;await x.admin.retryPayrollLoad();assert.equal(x.select.options.length,2);assert.equal(x.select.disabled,false);
});
test('concurrent renders do not duplicate week reads or corrupt the selected period',async()=>{
  const x=setup();await Promise.all([x.admin.renderPayrollFinance(),x.admin.renderPayrollFinance(),x.admin.renderPayrollFinance()]);assert.equal(callsTo(x,'payroll_weeks').length,1);assert.equal(callsTo(x,'payroll_weekly_fact_v2').length,1);assert.equal(x.select.value,'w2');assert.equal(x.admin._payrollRenderPromise,null);
});
test('full week list failure falls back to authorized cached period metadata with a visible warning',async()=>{
  const x=setup({initial:[row],provider:()=>({error:{code:'XX000'}})});await x.admin.renderPayrollFinance();assert.equal(x.select.value,'w1');assert.equal(x.nodes.get('ceo-total-payout').textContent,'$123.45');assert.match(x.nodes.get('payroll-load-message').textContent,/previously loaded periods/);
});
test('future pre-created weeks are not selected instead of completed payroll',async()=>{
  const x=setup({weekRows:[{id:'future',week_start:'2099-01-03',week_end:'2099-01-09'},...weeks]});await x.admin.renderPayrollFinance();assert.equal(x.select.value,'w2');
});
test('refreshing one week replaces that week only and preserves other historical periods',async()=>{
  const historical={...row,week_id:'old'};const x=setup({initial:[historical,row],provider:()=>({data:[{...row,final_pay:200}]})});
  assert.equal(await x.admin.loadPayrollWeek('w1',null,true),true);assert.equal(x.state.payrollWeeklyFactView.length,2);assert.equal(x.state.payrollWeeklyFactView.find(r=>r.week_id==='old').final_pay,123.45);assert.equal(x.state.payrollWeeklyFactView.find(r=>r.week_id==='w1').final_pay,200);
});
test('metadata requests are shared and cached metadata expires',async()=>{
  const x=setup();await Promise.all([x.admin.loadPayrollWeekList(),x.admin.loadPayrollWeekList()]);assert.equal(x.calls.length,1);x.admin._payrollWeekListAt=Date.now()-60001;await x.admin.loadPayrollWeekList();assert.equal(x.calls.length,2);
});
test('malformed data is an error and is not shown as an empty payroll',async()=>{
  const x=setup({provider:({table})=>table==='payroll_weeks'?{data:weeks}:{data:null}});await x.admin.renderPayrollFinance();assert.equal(x.nodes.get('ceo-total-payout').textContent,'—');assert.equal(x.nodes.get('payroll-retry').hidden,false);
});
test('missing authenticated database client fails visibly without weakening login',async()=>{
  const x=setup();x.context.window.portal.supabase=null;await x.admin.renderPayrollFinance();assert.equal(x.calls.length,0);assert.equal(x.select.textContent,'Unable to load weeks');
});
