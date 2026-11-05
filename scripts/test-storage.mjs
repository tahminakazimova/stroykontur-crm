import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY;
if(!url||!key||!process.env.TEST_CREDENTIALS_FILE)throw Error('Configure public Supabase settings and TEST_CREDENTIALS_FILE');
const accounts=JSON.parse(await readFile(process.env.TEST_CREDENTIALS_FILE,'utf8'));
const clients=[];
function value(r){if(r.error)throw r.error;return r.data;}
const manager=accounts.find(x=>x.role==='manager'),[one,two]=accounts.filter(x=>x.role==='executor');
for(const account of [manager,one,two]){account.client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(account.client);account.id=value(await account.client.auth.signInWithPassword({email:account.email,password:account.password})).user.id;}
const anonymous=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const id=randomUUID(),path=`${id}/${randomUUID()}.jpg`,image=await readFile(new URL('../public/images/house.jpg',import.meta.url));
const results=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
try{
 await check('Manager uploads an image before saving its object',async()=>value(await manager.client.storage.from('object-photos').upload(path,image,{contentType:'image/jpeg',cacheControl:'0',upsert:false})));
 value(await manager.client.from('objects').insert({id,name:`Storage QA ${randomUUID()}`,address:'Disposable photograph fixture',photo_paths:[path]}));
 await check('Manager can read private object photo',async()=>assert(value(await manager.client.storage.from('object-photos').download(path)).size>0));
 await check('Executor without assignments and anonymous user cannot read photo',async()=>{assert((await one.client.storage.from('object-photos').download(path)).error);assert((await anonymous.storage.from('object-photos').download(path)).error);});
 await check('Private bucket cannot be accessed through a public URL',async()=>{const {data}=anonymous.storage.from('object-photos').getPublicUrl(path);const response=await fetch(data.publicUrl,{signal:AbortSignal.timeout(20000)});assert(!response.ok);});
 value(await manager.client.from('tasks').insert({title:'Storage QA assigned task',object_id:id,assignee_id:one.id,author_id:manager.id}));
 await check('Assigned executor can read photo; second executor cannot',async()=>{assert(value(await one.client.storage.from('object-photos').download(path)).size>0);assert((await two.client.storage.from('object-photos').download(path)).error);});
 await check('Executor cannot upload, overwrite or delete photos',async()=>{
  assert((await one.client.storage.from('object-photos').upload(`${id}/${randomUUID()}.jpg`,image,{contentType:'image/jpeg'})).error);
  assert((await one.client.storage.from('object-photos').update(path,image,{contentType:'image/jpeg'})).error);
  await one.client.storage.from('object-photos').remove([path]);assert(value(await manager.client.storage.from('object-photos').download(path)).size>0);
 });
 await check('Server rejects unsupported MIME type and images over 5 MB',async()=>{
  assert((await manager.client.storage.from('object-photos').upload(`${id}/${randomUUID()}.jpg`,new Blob(['not an image'],{type:'text/plain'}),{contentType:'text/plain'})).error);
  assert((await manager.client.storage.from('object-photos').upload(`${id}/${randomUUID()}.jpg`,new Uint8Array(5242881),{contentType:'image/jpeg'})).error);
 });
 await check('Object cannot reference another object folder or more than ten photos',async()=>{
  assert((await manager.client.from('objects').update({photo_paths:[`${randomUUID()}/${randomUUID()}.jpg`]}).eq('id',id)).error);
  assert((await manager.client.from('objects').update({photo_paths:Array.from({length:11},()=>`${id}/${randomUUID()}.jpg`)}).eq('id',id)).error);
 });
 await check('Removing a photo reference prevents new signed download URLs',async()=>{
  value(await manager.client.from('objects').update({photo_paths:[]}).eq('id',id));assert((await one.client.storage.from('object-photos').createSignedUrl(path,60)).error);
 });
 if(process.env.STORAGE_TEST_REPORT)await writeFile(process.env.STORAGE_TEST_REPORT,`# Object photograph security verification\n\nExecuted: ${new Date().toISOString()}\n\n${results.length} checks passed against real Supabase Storage, using only the publishable key and ordinary user sessions. No administrator key was used.\n\n${results.map(x=>`- ✅ ${x}`).join('\n')}\n`);
 console.log(`All ${results.length} real storage checks passed.`);
}finally{
 const deleted=await manager.client.storage.from('object-photos').remove([path]);
 const object=await manager.client.from('objects').delete().eq('id',id);
 for(const client of clients)await client.auth.signOut({scope:'local'});
 if(deleted.error||object.error)throw Error('Test fixture cleanup failed');
}
