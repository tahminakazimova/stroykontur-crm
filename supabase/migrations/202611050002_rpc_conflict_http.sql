-- Use an HTTP conflict code instead of serialization_failure.
-- PostgREST retries 40001; a stale status is a business conflict, not a retryable transaction.
begin;
create or replace function public.transition_task(p_task_id uuid,p_expected public.task_status,p_status public.task_status,p_comment text default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if length(p_comment)>10000 then raise exception 'Comment too long' using errcode='23514'; end if;
 perform set_config('app.transition_comment',coalesce(p_comment,''),true);
 update public.tasks set status=p_status where id=p_task_id and status=p_expected;
 if not found then raise exception 'Task unavailable or changed. Refresh and try again.' using errcode='PT409'; end if;
 perform set_config('app.transition_comment','',true);
end; $$;
commit;
