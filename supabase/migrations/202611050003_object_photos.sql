begin;
alter table public.objects add column photo_paths text[] not null default '{}';
alter table public.objects add constraint object_photo_count check(cardinality(photo_paths)<=10);
create function public.guard_object_photos() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from unnest(new.photo_paths) as path where path is null or path !~ ('^'||new.id::text||'/[a-f0-9-]+\.(jpg|png|webp)$')) then
  raise exception 'Invalid object photo path' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function public.guard_object_photos() from public,anon,authenticated;
create trigger guard_object_photos before insert or update on public.objects for each row execute function public.guard_object_photos();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('object-photos','object-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy object_photos_read on storage.objects for select to authenticated using (
 bucket_id='object-photos' and (
  public.is_manager() or exists(select 1 from public.objects o where o.id::text=split_part(name,'/',1) and name=any(o.photo_paths))
 )
);
create policy object_photos_upload on storage.objects for insert to authenticated with check (
 bucket_id='object-photos' and public.is_manager() and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$'
);
create policy object_photos_delete on storage.objects for delete to authenticated using (
 bucket_id='object-photos' and public.is_manager()
);
-- Replacements use new random paths; no UPDATE policy and no public bucket access.
commit;
