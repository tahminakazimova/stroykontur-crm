-- Qualify the outer Storage name: public.objects also has a name column.
begin;
alter policy object_photos_read on storage.objects to authenticated using (
 bucket_id='object-photos' and (
  public.is_manager() or exists(select 1 from public.objects o where o.id::text=split_part(storage.objects.name,'/',1) and storage.objects.name=any(o.photo_paths))
 )
);
commit;
