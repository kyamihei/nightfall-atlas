-- 低視聴回数クリップの自動整理（2026-09-04追加）。
--
-- 「DBの容量的に大丈夫か」という指摘への対応。Supabase Free Planの上限0.5GBに対し、実測で
-- 603.64MBまで超過していた（原因の89%が`clips`テーブル、72万件超）。ユーザーとの合意方針:
-- ・作成から14日（猶予期間）は絶対に削除しない（新しいクリップはまだ視聴回数が伸びていないだけの
--   可能性があるため）
-- ・14日を過ぎたクリップのうち、視聴回数が50回未満のものを削除対象とする
-- ・削除件数を管理画面で可視化できるようにする
--
-- 視聴回数の鮮度について: refresh-clip-views.ts（毎時pg_cron経由で最大5000件ずつ、
-- view_count_synced_atが古い順にTwitch側の最新値へ更新）により、全クリップはおよそ6日周期で
-- 一巡する。そのためview_countは概ね1週間以内の実際の値に近く、削除判定の材料として信頼できる。

-- 削除実行の履歴ログ（何件・どの基準で削除したかを管理画面で可視化するため）。
create table if not exists clip_cleanup_log (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  deleted_count integer not null,
  grace_period_days integer not null,
  view_threshold integer not null
);

-- 実行本体。daily_ranking_posts.clip_idはCASCADEではない（NO ACTION、X自動投稿の履歴を
-- 誤って壊さないため意図的にそうなっている）ため、そこから参照されているクリップは
-- 視聴回数が基準未満でも削除対象から除外する（そもそもX投稿されるクリップは人気クリップの
-- はずなので、実際にはほぼ該当しない想定）。comments/favorites/reactions/clip_reaction_stamps
-- はいずれもON DELETE CASCADEなので、削除に伴い連動して自動的に消える（別途対応不要、
-- 事前にinformation_schemaで確認済み）。
create or replace function cleanup_low_view_clips(
  p_grace_period_days int default 14,
  p_view_threshold int default 50
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
  ),
  deleted as (
    delete from clips where id in (select id from target)
    returning id
  )
  select count(*) into v_deleted_count from deleted;

  insert into clip_cleanup_log (deleted_count, grace_period_days, view_threshold)
  values (v_deleted_count, p_grace_period_days, p_view_threshold);

  perform refresh_ranking_views();

  return v_deleted_count;
end;
$$;

-- 匿名/認証ロールから直接叩けないようにする（refresh_ranking_views()と同じ方針）。
revoke execute on function cleanup_low_view_clips(int, int) from public;
grant execute on function cleanup_low_view_clips(int, int) to service_role;

-- 毎日UTC 18:00（JST 3:00、既存の日次クリップ同期 JST 6:05 より前）に実行。
-- 純粋なSQL操作でTwitch APIを叩かないため、他のジョブと違いGitHub Actions経由にせず
-- pg_cronから直接関数を呼ぶ（外部Actionsのscheduleトリガーが信頼できないという既知の問題を
-- そもそも踏まずに済む）。
select cron.schedule(
  'trigger-cleanup-low-view-clips',
  '0 18 * * *',
  $$ select cleanup_low_view_clips(); $$
);
