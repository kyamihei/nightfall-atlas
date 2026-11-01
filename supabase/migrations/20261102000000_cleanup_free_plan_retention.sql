-- Free化の縮小運用: 保持ルールを「視聴1,000以上または直近14日」に変更する。
-- 閾値を上げるとコメント/お気に入り/リアクション/スタンプ/タグ付きのクリップが
-- ON DELETE CASCADEで巻き添え削除されるため、ユーザーコンテンツ付きは保護する。
create or replace function public.cleanup_low_view_clips(
  p_grace_period_days integer default 14,
  p_view_threshold integer default 1000,
  p_batch_size integer default 2000
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
    select c.id
    from clips c
    where c.id <> '__general_thread__'
      and c.twitch_created_at < now() - (p_grace_period_days || ' days')::interval
      and c.view_count < p_view_threshold
      and not exists (select 1 from daily_ranking_posts d where d.clip_id = c.id)
      and not exists (select 1 from comments x where x.clip_id = c.id)
      and not exists (select 1 from favorites x where x.clip_id = c.id)
      and not exists (select 1 from reactions x where x.clip_id = c.id)
      and not exists (select 1 from clip_reaction_stamps x where x.clip_id = c.id)
      and not exists (select 1 from clip_tags x where x.clip_id = c.id)
    limit p_batch_size
  ),
  deleted as (
    delete from clips where id in (select id from target)
    returning id
  )
  select count(*) into v_deleted_count from deleted;

  insert into clip_cleanup_log (deleted_count, grace_period_days, view_threshold)
  values (v_deleted_count, p_grace_period_days, p_view_threshold);

  return v_deleted_count;
end;
$function$;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'trigger-cleanup-low-view-clips'),
  schedule := '30 3 * * *',
  command := 'select cleanup_low_view_clips(14, 1000, 15000);'
);
