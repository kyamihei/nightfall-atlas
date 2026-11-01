-- 匿名サインインはbot等で増え続け、auth.*が数百MBに膨らむため、毎日掃除する。
-- anon_idはauth uidそのもの（FKなし）なので、コメント/お気に入り/リアクション/スタンプを持つユーザーと
-- 会員(members)は削除しない。sessions/refresh_tokensはauth.users削除でcascadeされる。
create or replace function public.cleanup_stale_anonymous_users(
  p_inactive_days integer default 7,
  p_batch_size integer default 20000
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted_count integer;
begin
  with target as (
    select u.id from auth.users u
    where u.is_anonymous
      and coalesce(u.last_sign_in_at, u.created_at) < now() - (p_inactive_days || ' days')::interval
      and not exists (select 1 from members m where m.id = u.id)
      and not exists (select 1 from comments x where x.anon_id = u.id)
      and not exists (select 1 from favorites x where x.anon_id = u.id)
      and not exists (select 1 from reactions x where x.anon_id = u.id)
      and not exists (select 1 from clip_reaction_stamps x where x.anon_id = u.id)
    limit p_batch_size
  ),
  deleted as (
    delete from auth.users where id in (select id from target)
    returning 1
  )
  select count(*) into v_deleted_count from deleted;

  return v_deleted_count;
end;
$function$;

revoke all on function public.cleanup_stale_anonymous_users(integer, integer) from public, anon, authenticated;

select cron.schedule(
  'trigger-cleanup-stale-anonymous-users',
  '45 3 * * *',
  'select cleanup_stale_anonymous_users(7, 20000);'
);
