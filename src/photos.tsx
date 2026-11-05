import {useEffect,useState} from 'react';
import {ImagePlus,Images,Expand,Trash2,Upload} from 'lucide-react';
import {Fancybox} from '@fancyapps/ui/dist/fancybox/';
import '@fancyapps/ui/dist/fancybox/fancybox.css';
import {supabase} from './data';
import type {Site} from './domain';
export const MAX_PHOTOS=10;
export const fallbackPhoto=(o:Site)=>/бизнес|центр|офис/i.test(o.name)?'/images/office.jpg':/дом|коттедж/i.test(o.name)?'/images/house.jpg':'/images/residential.jpg';
const isInline=(path:string)=>path.startsWith('data:image/')||path.startsWith('/images/');
export function usePhotos(paths:string[],userId:string){
 const [urls,setUrls]=useState<(string|null)[]>([]);
 const key=JSON.stringify(paths);
 useEffect(()=>{let active=true;const created:string[]=[];setUrls(paths.map(p=>isInline(p)?p:null));
  Promise.all(paths.map(async path=>{if(isInline(path))return path;if(!supabase)return null;try{const {data,error}=await supabase.storage.from('object-photos').download(path);if(error||!data)return null;const url=URL.createObjectURL(data);created.push(url);if(!active)URL.revokeObjectURL(url);return url;}catch{return null;}})).then(result=>{if(active)setUrls(result);});
  return()=>{active=false;created.forEach(url=>URL.revokeObjectURL(url));};
 },[key,userId]);
 return urls;
}
export function ObjectCover({object,userId}:{object:Site;userId:string}){
 const paths=object.photo_paths?.slice(0,1)||[];const urls=usePhotos(paths,userId);
 return <img className="object-photo" src={paths.length?(urls[0]||fallbackPhoto(object)):fallbackPhoto(object)} alt={`Фотография объекта «${object.name}»`} width={1000} height={560} loading="lazy"/>;
}
export function ObjectGallery({object,userId,onEdit}:{object:Site;userId:string;onEdit?:()=>void}){
 const actual=object.photo_paths||[];
 const paths=actual.length?actual:[fallbackPhoto(object)];const urls=usePhotos(paths,userId);
 useEffect(()=>()=>{Fancybox.close();},[object.id,userId]);
 const open=(index:number)=>{const available=urls.flatMap((url,i)=>url?[{src:url,type:'image',caption:`${object.name} · ${i+1} / ${paths.length}`}]:[]);const startIndex=urls.slice(0,index).filter(Boolean).length;Fancybox.show(available,{startIndex});};
 return <section className="object-gallery"><div className="section-title"><h2><Images size={19}/>Фотографии объекта <span>{actual.length||1}</span></h2>{onEdit&&<button className="secondary" onClick={onEdit}><ImagePlus size={15}/>Добавить фотографии</button>}</div><div className={`photo-grid ${paths.length===1?'single-photo':''}`}>{paths.map((path,i)=><button className="gallery-photo" key={path} disabled={!urls[i]} onClick={()=>open(i)} aria-label={`Открыть фотографию ${i+1} объекта ${object.name}`}>{urls[i]?<img src={urls[i]!} alt={`${object.name} — фото ${i+1}`}/>:<span className="photo-placeholder">Загрузка фотографии…</span>}<span className="photo-expand"><Expand size={17}/></span>{i===0&&<span className="photo-cover-label">{actual.length?'Обложка':'Иллюстрация'}</span>}</button>)}</div>{!actual.length&&<p className="photo-hint">Иллюстративное фото. {onEdit?'Загрузите фотографии вашего объекта.':'Фотографии объекта пока не добавлены.'}</p>}</section>;
}
export function PhotoPicker({paths,files,userId,disabled,onPaths,onFiles,onError}:{paths:string[];files:File[];userId:string;disabled:boolean;onPaths:(p:string[])=>void;onFiles:(f:File[])=>void;onError:(s:string)=>void}){
 const existing=usePhotos(paths,userId),[previews,setPreviews]=useState<string[]>([]);
 useEffect(()=>{const urls=files.map(f=>URL.createObjectURL(f));setPreviews(urls);return()=>urls.forEach(URL.revokeObjectURL);},[files]);
 const choose=async(selected:FileList|null)=>{if(!selected)return;const next=Array.from(selected);if(paths.length+files.length+next.length>MAX_PHOTOS){onError('Можно добавить не больше 10 фотографий');return;}for(const file of next){if(!['image/jpeg','image/png','image/webp'].includes(file.type)){onError('Выберите JPG, PNG или WebP');return;}if(file.size>5*1024*1024){onError('Каждая фотография должна быть не больше 5 МБ');return;}try{const decoded=await createImageBitmap(file);decoded.close();}catch{onError('Не удалось прочитать изображение');return;}}onError('');onFiles([...files,...next]);};
 return <div className="photo-picker"><div className="photo-picker-title"><b>Фотографии объекта</b><span>{paths.length+files.length} / 10</span></div><label className={`upload-zone ${disabled?'disabled':''}`}><Upload size={22}/><b>Выбрать фотографии</b><span>JPG, PNG, WebP · до 5 МБ каждая</span><input aria-label="Загрузить фотографии объекта" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={e=>{void choose(e.target.files);e.currentTarget.value='';}}/></label>{paths.length+files.length>0&&<div className="upload-previews">{paths.map((path,i)=><div className="upload-preview" key={path}>{existing[i]&&<img src={existing[i]!} alt={`Фото ${i+1}`}/>}<button type="button" disabled={disabled} onClick={()=>onPaths(paths.filter(p=>p!==path))} aria-label={`Убрать фото ${i+1}`}><Trash2 size={13}/></button>{i===0&&<small>Обложка</small>}</div>)}{previews.map((url,i)=><div className="upload-preview" key={url}><img src={url} alt={files[i]?.name||'Новое фото'}/><button type="button" disabled={disabled} onClick={()=>onFiles(files.filter((_,n)=>n!==i))} aria-label={`Убрать новое фото ${i+1}`}><Trash2 size={13}/></button>{!paths.length&&i===0&&<small>Обложка</small>}</div>)}</div>}<p className="photo-hint">Первая фотография станет обложкой объекта. Фотографии сохранятся вместе с объектом.</p></div>;
}
export async function uploadPhotos(objectId:string,files:File[]):Promise<string[]>{
 const uploaded:string[]=[];
 try{for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Допустимы JPG, PNG, WebP до 5 МБ');if(!supabase){const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Ошибка чтения фотографии'));reader.readAsDataURL(file);});uploaded.push(encoded);continue;}const extension=file.type==='image/jpeg'?'jpg':file.type==='image/png'?'png':'webp';const path=`${objectId}/${crypto.randomUUID()}.${extension}`;const {error}=await supabase.storage.from('object-photos').upload(path,file,{contentType:file.type,cacheControl:'0',upsert:false});if(error)throw error;uploaded.push(path);}return uploaded;}catch(error){if(supabase&&uploaded.length)await supabase.storage.from('object-photos').remove(uploaded);throw error;}
}
export async function removePhotos(paths:string[]){if(!supabase||!paths.length)return;const {error}=await supabase.storage.from('object-photos').remove(paths);if(error)console.warn('Не удалось очистить неиспользуемые фотографии');}
