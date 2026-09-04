-- cleanup_low_view_clips()を1回の呼び出しで全件処理しようとすると、削除対象が数十万件規模の
-- 場合にstatement timeoutで失敗することが判明した（2026-09-04、本番で実測）。原因は削除件数の
-- 多さそのものというより、daily_ranking_posts.clip_idへの外部キー制約（ON DELETE NO ACTION）が
-- 削除ごとに参照整合性チェック（FOR KEY SHARE行ロック確認）を発生させ、大量件数では
-- その積み重ねが無視できなくなるため。
--
-- 対策として、1回の呼び出しでは最大p_batch_size件だけ処理する設計に変更する
-- （呼び出し側が0件になるまで繰り返し呼ぶ想定）。pg_cronの日次実行は新規に猶予期間を
-- 超える件数が少量（実測で1日あたり数百件程度）のため1回の呼び出しで十分間に合う。
-- 初回の大量バックログ（数十万件）は、この関数を繰り返し呼ぶ形で手動で処理する。
create or replace function cleanup_low_view_clips(
  p_grace_period_days int default 14,
  p_view_threshold int default 50,
  p_batch_size int default 2000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke execute on function cleanup_low_view_clips(int, int, int) from public;
grant execute on function cleanup_low_view_clips(int, int, int) to service_role;

-- ランキング集計ビューの再計算は重い（既存のrefresh-clip-views.ts等でも1回の実行の最後に
-- 1度だけ呼ぶ設計になっている）ため、バッチのたびに呼ばず日次cronの最後に1回だけ呼ぶ。
select cron.schedule(
  'trigger-cleanup-low-view-clips',
  '0 18 * * *',
  $$
  select cleanup_low_view_clips();
  select refresh_ranking_views();
  $$
);
