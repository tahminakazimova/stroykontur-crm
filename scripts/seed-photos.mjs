// Adds illustrative photographs only until each existing object has four photos.
// Preserves existing images. Uses a normal manager account, never an admin key.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const account=JSON.parse(await readFile(process.env.TEST_CREDENTIALS_FILE,'utf8')).find(x=>x.role==='manager');
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function value(r){if(r.error)throw r.error;return r.data;}
value(await client.auth.signInWithPassword({email:account.email,password:account.password}));
try{
 const objects=value(await client.from('objects').select('*'));
 for(const object of objects){
  const old=object.photo_paths||[];if(old.length>=4){console.log(`${object.name}: ${old.length} photos preserved`);continue;}
  const type=/бизнес|центр|офис/i.test(object.name)?'office':/дом|коттедж/i.test(object.name)?'house':'residential';
  const uploaded=[];
  try{
   for(let i=old.length;i<4;i++){
    const file=i===0?`${type}.jpg`:`${type}-${i+1}.jpg`;
    const bytes=await readFile(new URL(`../public/images/${file}`,import.meta.url));
    const path=`${object.id}/${randomUUID()}.jpg`;
    value(await client.storage.from('object-photos').upload(path,bytes,{contentType:'image/jpeg',cacheControl:'0',upsert:false}));uploaded.push(path);
   }
   const updated=value(await client.from('objects').update({photo_paths:[...old,...uploaded]}).eq('id',object.id).eq('photo_paths',`{${old.join(',')}}`).select());
   if(updated.length!==1)throw Error('Photo list changed during upload; stopped to preserve concurrent edits');
   console.log(`${object.name}: ${old.length+uploaded.length} photographs`);
  }catch(error){await client.storage.from('object-photos').remove(uploaded);throw error;}
 }
}finally{await client.auth.signOut({scope:'local'});}
