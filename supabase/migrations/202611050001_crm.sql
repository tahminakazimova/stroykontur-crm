-- Apply once to a new Supabase project through the SQL editor or Supabase CLI.
begin;
create type public.app_role as enum ('manager','executor');
create type public.task_status as enum ('new','working','review','accepted','revision');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 name text not null check(length(trim(name)) between 1 and 200),
 role public.app_role not null
);
create table public.objects (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 200),
 address text not null check(length(trim(address)) between 1 and 500),
 created_at timestamptz not null default now()
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=10000),
 object_id uuid not null references public.objects(id) on delete cascade,
 assignee_id uuid not null references public.profiles(id) on delete restrict,
 status public.task_status not null default 'new',
 author_id uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table public.task_history (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 actor_name text not null,
 from_status public.task_status,
 to_status public.task_status not null,
 comment text check(length(comment)<=10000),
 created_at timestamptz not null default now()
);
create index tasks_assignee_idx on public.tasks(assignee_id);
create index tasks_object_idx on public.tasks(object_id);
create index history_task_idx on public.task_history(task_id,created_at);
-- No roles come from user-controlled JWT metadata. No profile write API is granted.
create function public.is_manager() returns boolean language sql stable security definer
set search_path = '' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='manager'); $$;
revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to authenticated;

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.is_manager() or exists(select 1 from public.tasks where tasks.author_id=profiles.id and tasks.assignee_id=auth.uid()));
create policy objects_read on public.objects for select to authenticated using (public.is_manager() or exists(select 1 from public.tasks where object_id=objects.id and assignee_id=auth.uid()));
create policy objects_insert on public.objects for insert to authenticated with check(public.is_manager());
create policy objects_update on public.objects for update to authenticated using(public.is_manager()) with check(public.is_manager());
create policy objects_delete on public.objects for delete to authenticated using(public.is_manager());
create policy tasks_read on public.tasks for select to authenticated using(public.is_manager() or assignee_id=auth.uid());
create policy tasks_insert on public.tasks for insert to authenticated with check(public.is_manager() and author_id=auth.uid());
create policy tasks_update on public.tasks for update to authenticated using(public.is_manager() or assignee_id=auth.uid()) with check(public.is_manager() or assignee_id=auth.uid());
create policy tasks_delete on public.tasks for delete to authenticated using(public.is_manager());
create policy history_read on public.task_history for select to authenticated using(exists(select 1 from public.tasks where tasks.id=task_id));

-- Triggers also protect direct REST updates: users cannot bypass the workflow RPC.
create function public.guard_task() returns trigger language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
 manager boolean := public.is_manager();
 reason text := nullif(trim(current_setting('app.transition_comment',true)),'');
begin
 -- Trusted maintenance via SQL editor/service_role can seed data, but authenticated API users cannot.
 if actor is null then
   if current_user <> 'postgres' then raise exception 'Authentication required' using errcode='42501'; end if;
   return new;
 end if;
 if tg_op='INSERT' then
   if not manager then raise exception 'Only managers can create tasks' using errcode='42501'; end if;
   new.author_id := actor;
   new.created_at := now();
   if new.status <> 'new' then raise exception 'Tasks must start with new status' using errcode='23514'; end if;
 else
   if new.id is distinct from old.id or new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
     raise exception 'Identity, author and creation date are immutable' using errcode='42501';
   end if;
   if not manager then
     if old.assignee_id<>actor or new.assignee_id is distinct from old.assignee_id or new.object_id is distinct from old.object_id or new.title is distinct from old.title or new.description is distinct from old.description then
       raise exception 'Executors may only transition their own tasks' using errcode='42501';
     end if;
   end if;
   if new.status is distinct from old.status then
     if not (
       (not manager and old.assignee_id=actor and ((old.status in ('new','revision') and new.status='working') or (old.status='working' and new.status='review')))
       or (manager and old.status='review' and new.status in ('accepted','revision'))
     ) then raise exception 'Forbidden status transition: % -> %',old.status,new.status using errcode='23514'; end if;
     if new.status='revision' and reason is null then raise exception 'Revision comment is required' using errcode='23514'; end if;
   end if;
 end if;
 if not exists(select 1 from public.profiles where id=new.assignee_id and role='executor') then
   raise exception 'Assignee must be an executor' using errcode='23514';
 end if;
 return new;
end; $$;
-- Function owner is trusted; actor always comes from auth.uid(), never a request argument.
create function public.record_task_status() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); actor_label text;
begin
 if tg_op='INSERT' or new.status is distinct from old.status then
   actor := coalesce(actor,new.author_id);
   select name into actor_label from public.profiles where id=actor;
   insert into public.task_history(task_id,actor_id,actor_name,from_status,to_status,comment)
   values(new.id,actor,actor_label,case when tg_op='INSERT' then null else old.status end,new.status,
     case when tg_op='INSERT' then null else nullif(trim(current_setting('app.transition_comment',true)),'') end);
 end if;
 return new;
end; $$;
revoke all on function public.guard_task() from public,anon,authenticated;
revoke all on function public.record_task_status() from public,anon,authenticated;
create trigger guard_task before insert or update on public.tasks for each row execute function public.guard_task();
create trigger record_task_status after insert or update on public.tasks for each row execute function public.record_task_status();

create function public.transition_task(p_task_id uuid,p_expected public.task_status,p_status public.task_status,p_comment text default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if length(p_comment)>10000 then raise exception 'Comment too long' using errcode='23514'; end if;
 perform set_config('app.transition_comment',coalesce(p_comment,''),true);
 update public.tasks set status=p_status where id=p_task_id and status=p_expected;
 if not found then raise exception 'Task unavailable or changed. Refresh and try again.' using errcode='40001'; end if;
 perform set_config('app.transition_comment','',true);
end; $$;
revoke all on function public.transition_task(uuid,public.task_status,public.task_status,text) from public,anon;
grant execute on function public.transition_task(uuid,public.task_status,public.task_status,text) to authenticated;

-- Explicit grants replace Supabase default grants. History has NO write privileges or write policies.
revoke all on public.profiles,public.objects,public.tasks,public.task_history from anon,authenticated;
grant select on public.profiles,public.task_history to authenticated;
grant select,insert,update,delete on public.objects,public.tasks to authenticated;
commit;
