import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const M='00000000-0000-0000-0000-000000000001',E='00000000-0000-0000-0000-000000000002',F='00000000-0000-0000-0000-000000000003';
const O='10000000-0000-0000-0000-000000000001',H='10000000-0000-0000-0000-000000000002',T='20000000-0000-0000-0000-000000000001',U='20000000-0000-0000-0000-000000000002';
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(await readFile(new URL('../supabase/migrations/202611050001_crm.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/202611050002_rpc_conflict_http.sql',import.meta.url),'utf8'));
await db.exec(`insert into auth.users values ('${M}'),('${E}'),('${F}'); insert into public.profiles values ('${M}','Manager','manager'),('${E}','Executor 1','executor'),('${F}','Executor 2','executor'); insert into public.objects(id,name,address) values('${O}','Shared site','A'),('${H}','Hidden site','B'); insert into public.tasks(id,title,object_id,assignee_id,author_id) values('${T}','My task','${O}','${E}','${M}'),('${U}','Foreign task','${H}','${F}','${M}');`);
async function as(id,sql){await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);try{return await db.query(sql);}finally{await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);}}
async function denied(id,sql){await assert.rejects(()=>as(id,sql));}
await test('Executor sees only assigned tasks and their objects',async()=>{assert.equal((await as(E,'select * from public.tasks')).rows.length,1);assert.equal((await as(E,'select * from public.objects')).rows.length,1);assert.equal((await as(E,`select * from public.tasks where id='${U}'`)).rows.length,0);});
await test('Manager sees all tasks and profiles',async()=>{assert.equal((await as(M,'select * from public.tasks')).rows.length,2);assert.equal((await as(M,'select * from public.profiles')).rows.length,3);});
await test('Executor cannot edit details, reassign, create, delete or elevate role',async()=>{await denied(E,`update public.tasks set title='tampered' where id='${T}'`);await denied(E,`update public.tasks set assignee_id='${F}' where id='${T}'`);await denied(E,`insert into public.tasks(title,object_id,assignee_id,author_id) values('bad','${O}','${E}','${E}')`);await denied(E,`update public.profiles set role='manager' where id='${E}'`);assert.equal((await as(E,`delete from public.tasks where id='${T}' returning id`)).rows.length,0);});
await test('Foreign task cannot be changed through REST or RPC',async()=>{assert.equal((await as(E,`update public.tasks set status='working' where id='${U}' returning id`)).rows.length,0);await denied(E,`select public.transition_task('${U}','new','working',null)`);});
await test('History cannot be inserted, edited or deleted by either role',async()=>{for(const id of [M,E]){await denied(id,`insert into public.task_history(task_id,actor_id,actor_name,to_status) values('${T}','${M}','fake','accepted')`);await denied(id,`update public.task_history set actor_name='fake'`);await denied(id,'delete from public.task_history');}});
await test('Forbidden direct transitions and manager taking work are rejected',async()=>{await denied(E,`update public.tasks set status='accepted' where id='${T}'`);await denied(E,`update public.tasks set status='review' where id='${T}'`);await denied(M,`update public.tasks set status='working' where id='${T}'`);});
await test('Valid direct transition creates genuine immutable history',async()=>{await as(E,`update public.tasks set status='working' where id='${T}'`);const rows=(await as(E,`select * from public.task_history where task_id='${T}' order by created_at,id`)).rows;assert.equal(rows.length,2);assert.equal(rows.find(x=>x.to_status==='working').actor_id,E);await as(E,`select public.transition_task('${T}','working','review',null)`);});
await test('Revision requires a nonblank comment, including direct updates',async()=>{await denied(M,`update public.tasks set status='revision' where id='${T}'`);await denied(M,`select public.transition_task('${T}','review','revision','   ')`);await as(M,`select public.transition_task('${T}','review','revision','Fix joints')`);const row=(await as(E,`select * from public.task_history where task_id='${T}' and to_status='revision'`)).rows[0];assert.equal(row.comment,'Fix joints');assert.equal(row.actor_id,M);});
await test('Full revision cycle and final acceptance',async()=>{await as(E,`select public.transition_task('${T}','revision','working',null)`);await as(E,`select public.transition_task('${T}','working','review','Ready')`);await denied(E,`update public.tasks set status='accepted' where id='${T}'`);await as(M,`select public.transition_task('${T}','review','accepted',null)`);await denied(M,`update public.tasks set status='new' where id='${T}'`);await denied(E,`select public.transition_task('${T}','review','accepted',null)`);assert.equal((await as(E,`select * from public.task_history where task_id='${T}'`)).rows.length,7);});
await test('History of foreign tasks is invisible; authors and timestamps cannot be forged',async()=>{assert.equal((await as(E,`select * from public.task_history where task_id='${U}'`)).rows.length,0);await denied(M,`update public.tasks set author_id='${F}' where id='${T}'`);await denied(M,`update public.tasks set created_at=now() where id='${T}'`);});
await test('New tasks must start new, assignee must be executor',async()=>{await denied(M,`insert into public.tasks(title,object_id,assignee_id,author_id,status) values('bad','${O}','${E}','${M}','accepted')`);await denied(M,`insert into public.tasks(title,object_id,assignee_id,author_id) values('bad','${O}','${M}','${M}')`);});
await test('Anonymous cannot read CRM',async()=>{await db.exec('set role anon');try{await assert.rejects(()=>db.query('select * from public.tasks'));}finally{await db.exec('reset role');}});
await test('All 50 role/status combinations match the specified transition matrix',async()=>{
 const statuses=['new','working','review','accepted','revision'];
 for(const actor of [M,E])for(const from of statuses)for(const to of statuses){
  const id=crypto.randomUUID();
  await db.exec(`insert into public.tasks(id,title,object_id,assignee_id,author_id,status) values('${id}','Matrix','${O}','${E}','${M}','${from}')`);
  const allowed=from===to||(actor===M?from==='review'&&['accepted','revision'].includes(to):(['new','revision'].includes(from)&&to==='working')||(from==='working'&&to==='review'));
  const sql=`select public.transition_task('${id}','${from}','${to}','Valid comment')`;
  if(allowed)await as(actor,sql);else await denied(actor,sql);
 }
});
await test('Reassignment removes previous executor access immediately',async()=>{
 const id=crypto.randomUUID();
 await as(M,`insert into public.tasks(id,title,object_id,assignee_id,author_id) values('${id}','Reassign','${O}','${E}','${M}')`);
 assert.equal((await as(E,`select * from public.tasks where id='${id}'`)).rows.length,1);
 await as(M,`update public.tasks set assignee_id='${F}' where id='${id}'`);
 assert.equal((await as(E,`select * from public.tasks where id='${id}'`)).rows.length,0);
 assert.equal((await as(E,`select * from public.task_history where task_id='${id}'`)).rows.length,0);
 assert.equal((await as(F,`select * from public.tasks where id='${id}'`)).rows.length,1);
});
await test('Manager deletion cascades consistently',async()=>{await as(M,`delete from public.objects where id='${O}'`);assert.equal((await db.query(`select * from public.task_history where task_id='${T}'`)).rows.length,0);});
await db.close();
