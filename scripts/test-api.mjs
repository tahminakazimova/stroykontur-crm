// Real HTTP checks. Uses only the publishable key and ordinary user sessions.
// Creates isolated test objects, then deletes only those objects in finally.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
const key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY;
if(!url||!key||!process.env.TEST_CREDENTIALS_FILE)throw Error('Set Supabase URL, public key and TEST_CREDENTIALS_FILE (JSON array of three seeded accounts).');
const accounts=JSON.parse(await readFile(process.env.TEST_CREDENTIALS_FILE,'utf8'));
const manager=accounts.find(a=>a.role==='manager'),executors=accounts.filter(a=>a.role==='executor');
assert(manager&&executors.length>=2,'Need one manager and two executors');
const [one,two]=executors;
const report=[],created=[];
async function req(path,{actor,method='GET',body}={}){
 const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=representation'};
 if(actor?.token)headers.Authorization=`Bearer ${actor.token}`;
 const response=await fetch(url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,ok:response.ok,data};
}
const rest=(table,options={},query='')=>req(`/rest/v1/${table}${query}`,options);
function ok(r){assert(r.ok,JSON.stringify({status:r.status,error:r.data}));return r.data;}
function denied(r){assert(!r.ok,'Operation unexpectedly allowed');}
async function check(name,fn){console.log(`RUN ${name}`);await fn();report.push(name);console.log(`PASS ${name}`);}
const rpc=(actor,id,expected,status,comment=null)=>rest('rpc/transition_task',{actor,method:'POST',body:{p_task_id:id,p_expected:expected,p_status:status,p_comment:comment}});
try{
 await check('Email/password login succeeds for manager and both executors',async()=>{
  for(const a of [manager,one,two]){const r=ok(await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email:a.email,password:a.password}}));a.token=r.access_token;a.id=r.user.id;const p=ok(await rest('profiles',{actor:a},`?id=eq.${a.id}`));assert.equal(p[0].role,a.role);}
 });
 await check('Invalid password is rejected',async()=>denied(await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email:one.email,password:randomBytes(24).toString('hex')}})));
 await check('Public signup is disabled in settings and by signup endpoint',async()=>{
  const s=ok(await req('/auth/v1/settings'));assert.equal(s.disable_signup,true);assert.equal(s.external.email,true);
  const r=await req('/auth/v1/signup',{method:'POST',body:{email:`qa-${randomUUID()}@example.com`,password:randomBytes(24).toString('hex')}});denied(r);assert.equal(r.data.error_code,'signup_disabled');
 });
 await check('Anonymous cannot read CRM data',async()=>{for(const table of ['profiles','objects','tasks','task_history']){const r=await rest(table);assert(!r.ok||(Array.isArray(r.data)&&r.data.length===0));}});
 await check('Seeded manager sees three objects, six tasks and three profiles',async()=>{
  assert(ok(await rest('objects',{actor:manager})).length>=3);assert(ok(await rest('tasks',{actor:manager})).length>=6);assert(ok(await rest('profiles',{actor:manager})).length>=3);
 });
 for(let i=0;i<2;i++){const row=ok(await rest('objects',{actor:manager,method:'POST',body:{name:`API QA ${randomUUID()}`,address:'Disposable security test fixture'}}))[0];created.push(row.id);}
 const t1=ok(await rest('tasks',{actor:manager,method:'POST',body:{title:'API QA task A',object_id:created[0],assignee_id:one.id,author_id:manager.id}}))[0];
 const t2=ok(await rest('tasks',{actor:manager,method:'POST',body:{title:'API QA task B',object_id:created[1],assignee_id:two.id,author_id:manager.id}}))[0];
 await check('Executor sees only assigned tasks and related objects',async()=>{
  const tasks=ok(await rest('tasks',{actor:one}));assert(tasks.every(t=>t.assignee_id===one.id));const objects=ok(await rest('objects',{actor:one}));assert(objects.every(o=>tasks.some(t=>t.object_id===o.id)));assert.equal(ok(await rest('objects',{actor:one},`?id=eq.${created[1]}`)).length,0);
 });
 await check('Foreign task and history cannot be read or changed',async()=>{
  assert.equal(ok(await rest('tasks',{actor:one},`?id=eq.${t2.id}`)).length,0);assert.equal(ok(await rest('task_history',{actor:one},`?task_id=eq.${t2.id}`)).length,0);
  assert.equal(ok(await rest('tasks',{actor:one,method:'PATCH',body:{title:'forged'}},`?id=eq.${t2.id}`)).length,0);
  denied(await rpc(one,t2.id,'new','working'));
 });
 await check('Executor cannot edit details, reassign, create tasks, delete tasks or elevate role',async()=>{
  for(const body of [{title:'forged'},{description:'forged'},{assignee_id:two.id},{object_id:created[1]}])denied(await rest('tasks',{actor:one,method:'PATCH',body},`?id=eq.${t1.id}`));
  denied(await rest('tasks',{actor:one,method:'POST',body:{title:'forged',object_id:created[0],assignee_id:one.id,author_id:one.id}}));
  assert.equal(ok(await rest('tasks',{actor:one,method:'DELETE'},`?id=eq.${t1.id}`)).length,0);
  denied(await rest('profiles',{actor:one,method:'PATCH',body:{role:'manager'}},`?id=eq.${one.id}`));
 });
 await check('History INSERT/UPDATE/DELETE is forbidden for both roles',async()=>{
  for(const actor of [manager,one]){
   denied(await rest('task_history',{actor,method:'POST',body:{task_id:t1.id,actor_id:manager.id,actor_name:'forged',to_status:'accepted'}}));
   denied(await rest('task_history',{actor,method:'PATCH',body:{actor_name:'forged'}},`?task_id=eq.${t1.id}`));
   denied(await rest('task_history',{actor,method:'DELETE'},`?task_id=eq.${t1.id}`));
  }
 });
 await check('Forbidden transitions are blocked even through direct REST updates',async()=>{
  for(const status of ['review','accepted','revision'])denied(await rest('tasks',{actor:one,method:'PATCH',body:{status}},`?id=eq.${t1.id}`));
  denied(await rest('tasks',{actor:manager,method:'PATCH',body:{status:'working'}},`?id=eq.${t1.id}`));
 });
 await check('Concurrent transition requests allow exactly one expected-status update',async()=>{
  const r=await Promise.all([rpc(one,t1.id,'new','working'),rpc(one,t1.id,'new','working')]);assert.equal(r.filter(x=>x.ok).length,1);
 });
 ok(await rpc(one,t1.id,'working','review'));
 await check('Revision requires a nonblank comment in both REST and RPC',async()=>{
  denied(await rest('tasks',{actor:manager,method:'PATCH',body:{status:'revision'}},`?id=eq.${t1.id}`));
  denied(await rpc(manager,t1.id,'review','revision','   '));
  ok(await rpc(manager,t1.id,'review','revision','QA: fix joints'));
 });
 await check('Revision cycle, review and manager acceptance work end to end',async()=>{
  ok(await rpc(one,t1.id,'revision','working'));ok(await rpc(one,t1.id,'working','review'));
  denied(await rpc(one,t1.id,'review','accepted'));ok(await rpc(manager,t1.id,'review','accepted'));
  denied(await rest('tasks',{actor:manager,method:'PATCH',body:{status:'new'}},`?id=eq.${t1.id}`));
 });
 await check('Server writes seven genuine history events with correct authors and comment',async()=>{
  const h=ok(await rest('task_history',{actor:one},`?task_id=eq.${t1.id}&order=created_at.asc`));assert.equal(h.length,7);
  assert.deepEqual(h.map(x=>x.to_status),['new','working','review','revision','working','review','accepted']);
  assert.equal(h.find(x=>x.to_status==='revision').comment,'QA: fix joints');assert.equal(h[0].actor_id,manager.id);assert.equal(h[1].actor_id,one.id);assert.equal(h[6].actor_id,manager.id);
 });
 await check('Author and creation timestamp cannot be forged',async()=>{
  denied(await rest('tasks',{actor:manager,method:'PATCH',body:{author_id:two.id}},`?id=eq.${t1.id}`));
  denied(await rest('tasks',{actor:manager,method:'PATCH',body:{created_at:'2000-01-01T00:00:00Z'}},`?id=eq.${t1.id}`));
 });
 await check('Reassignment immediately removes old executor access to task, object and history',async()=>{
  ok(await rest('tasks',{actor:manager,method:'PATCH',body:{assignee_id:two.id}},`?id=eq.${t1.id}`));
  assert.equal(ok(await rest('tasks',{actor:one},`?id=eq.${t1.id}`)).length,0);assert.equal(ok(await rest('objects',{actor:one},`?id=eq.${created[0]}`)).length,0);assert.equal(ok(await rest('task_history',{actor:one},`?task_id=eq.${t1.id}`)).length,0);assert.equal(ok(await rest('tasks',{actor:two},`?id=eq.${t1.id}`)).length,1);
 });
 console.log(`All ${report.length} real API checks passed.`);
 if(process.env.API_TEST_REPORT)await writeFile(process.env.API_TEST_REPORT,`# Real Supabase API verification\n\nExecuted: ${new Date().toISOString()}\n\nProject: susuopetvkuliqxixnnx\n\nAll ${report.length} checks passed using only the public key and regular user sessions. No admin key was used by these tests. Isolated fixture objects were removed afterwards.\n\n${report.map(s=>`- ✅ ${s}`).join('\n')}\n`);
}finally{
 const errors=[];
 for(const id of created){const r=await rest('objects',{actor:manager,method:'DELETE'},`?id=eq.${id}`);if(!r.ok)errors.push(id);}
 for(const a of [manager,one,two])if(a.token)await req('/auth/v1/logout?scope=local',{actor:a,method:'POST'});
 if(errors.length)throw Error(`Cleanup failed for test object(s): ${errors.join(', ')}`);
}
