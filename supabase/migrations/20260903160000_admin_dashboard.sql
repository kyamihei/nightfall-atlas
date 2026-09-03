-- 管理画面のダッシュボードタブ用（2026-09-03追加）。
-- 「管理画面なので情報はあればあるほどいい」というユーザー要望への対応。サイト全体の統計・
-- 直近の伸び・各種ランキングTOP・タグスレ新着・モデレーション状況・検索キーワード・
-- 定期同期(pg_cron)の実行状況を1回のRPC呼び出しでまとめて返す（タブごとに何十回もRPCを
-- 呼ぶより、1つのjsonbにまとめたほうがシンプルで速い）。

-- 検索キーワードのログ（新規）。クリップ検索（search_clips RPC）はどのタイトルにも
-- 一致しない検索語も多く、「何を探して見つけられなかったか」＝未追跡配信者の需要が
-- わかるため新設した。個人を特定する情報（anon_id等）は持たない（誰でも書き込めるが、
-- 読み取りは管理画面のRPC経由のみ、通常のテーブルアクセスでは読めない）。
create table if not exists search_log (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_search_log_created on search_log(created_at desc);
create index if not exists idx_search_log_query_lower on search_log(lower(query));

alter table search_log enable row level security;

drop policy if exists "search_log_insert_anyone" on search_log;
create policy "search_log_insert_anyone" on search_log
  for insert with check (true);
-- selectポリシーは意図的に用意しない（admin_get_dashboardのsecurity definer経由でのみ読める）

-- clips（54万件超）に対する件数・最古/最新日時の集計は、匿名ロールのstatement_timeout（3秒）を
-- 本番実測で大きく超える（`count(*) where id <> ...`だけで11秒超、view_count_synced_atの
-- is null/is not null集計もそれぞれ1〜7秒超）。plpgsql内で`set local statement_timeout`しても
-- 効果が無いことも確認済み（トップレベル文のタイムアウトは文の開始時点で確定するため）。
-- 「クリップ職人ランキング」節と同じ理由・同じ解決策で、他の集計ビューと一緒に
-- refresh_ranking_views()（service_role専用、statement_timeout=120s）のタイミングでのみ
-- 再計算するマテリアライズドビューにする。ダッシュボードなので鮮度は同期タイミング
-- （最大1時間程度）ズレても許容できる。
drop materialized view if exists admin_dashboard_clip_stats_mv;
create materialized view admin_dashboard_clip_stats_mv as
  select
    1 as stat_id,
    (select count(*) from clips where id <> '__general_thread__') as total_clips,
    (select count(*) from clips where id <> '__general_thread__' and created_at >= now() - interval '24 hours') as new_clips_24h,
    (select count(*) from clips where id <> '__general_thread__' and created_at >= now() - interval '7 days') as new_clips_7d,
    (select max(created_at) from clips where id <> '__general_thread__') as latest_clip_created_at,
    (select min(view_count_synced_at) from clips where id <> '__general_thread__') as oldest_view_sync_at,
    (select count(*) from clips where id <> '__general_thread__' and view_count_synced_at is not null) as view_synced_count,
    (select count(*) from clips where id <> '__general_thread__' and view_count_synced_at is null) as view_unsynced_count;

create unique index if not exists idx_admin_dashboard_clip_stats_mv_id on admin_dashboard_clip_stats_mv(stat_id);

create or replace function refresh_ranking_views()
returns void as $$
begin
  refresh materialized view concurrently top_broadcasters_mv;
  refresh materialized view concurrently top_clippers_mv;
  refresh materialized view concurrently top_clippers_this_year_mv;
  refresh materialized view concurrently top_clippers_this_month_mv;
  refresh materialized view concurrently admin_dashboard_clip_stats_mv;
end;
$$ language plpgsql security definer;

revoke execute on function refresh_ranking_views() from public;
grant execute on function refresh_ranking_views() to service_role;

-- 上のCREATE OR REPLACEだけだと初回はまだ空（1行も無い）ため、マイグレーション適用時に1度だけ
-- 手動で埋めておく（以降はsync-twitch-clips.ts等が呼ぶrefresh_ranking_views()経由で更新される）。
refresh materialized view admin_dashboard_clip_stats_mv;

create or replace function admin_get_dashboard(p_password text)
returns jsonb as $$
declare
  v_result jsonb;
begin
  perform admin_check_password(p_password);

  select jsonb_build_object(
    'overview', jsonb_build_object(
      'total_clips', (select total_clips from admin_dashboard_clip_stats_mv),
      'total_broadcasters', (select count(*) from tracked_broadcasters),
      'total_clippers', (select count(*) from tracked_clippers),
      'total_comments', (select count(*) from comments),
      'hidden_comments', (select count(*) from comments where is_hidden = true),
      'total_tag_threads', (select count(*) from tag_threads),
      'total_tag_thread_comments', (select count(*) from tag_thread_comments),
      'total_reaction_stamps', (select count(*) from clip_reaction_stamps),
      'total_favorites', (select count(*) from favorites),
      'total_broadcaster_tags', (select count(*) from broadcaster_tags),
      'unique_tags', (select count(distinct tag) from broadcaster_tags),
      'total_visitors', (select count(*) from auth.users)
    ),
    'growth', jsonb_build_object(
      'new_clips_24h', (select new_clips_24h from admin_dashboard_clip_stats_mv),
      'new_clips_7d', (select new_clips_7d from admin_dashboard_clip_stats_mv),
      'new_comments_24h', (select count(*) from comments where created_at >= now() - interval '24 hours'),
      'new_comments_7d', (select count(*) from comments where created_at >= now() - interval '7 days'),
      'latest_clip_created_at', (select latest_clip_created_at from admin_dashboard_clip_stats_mv),
      'oldest_view_sync_at', (select oldest_view_sync_at from admin_dashboard_clip_stats_mv),
      'view_synced_count', (select view_synced_count from admin_dashboard_clip_stats_mv),
      'view_unsynced_count', (select view_unsynced_count from admin_dashboard_clip_stats_mv)
    ),
    'top_broadcasters', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select streamer, total_views, clip_count from top_broadcasters_mv
        order by total_views desc limit 5
      ) t
    ),
    'top_clippers', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select creator_id, creator_name, total_views, clip_count from top_clippers_mv
        order by total_views desc limit 5
      ) t
    ),
    'top_clips_by_views', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select id, title, streamer, view_count from clips
        where id <> '__general_thread__'
        order by view_count desc limit 5
      ) t
    ),
    'top_clips_by_comments', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select cl.id, cl.title, count(c.id) as comment_count
        from comments c
        join clips cl on cl.id = c.clip_id
        where c.clip_id <> '__general_thread__' and c.is_hidden = false
        group by cl.id, cl.title
        order by comment_count desc
        limit 5
      ) t
    ),
    'top_broadcaster_tags', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select tag, count(*) as use_count
        from broadcaster_tags
        group by tag
        order by use_count desc
        limit 10
      ) t
    ),
    'recent_tag_threads', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select tt.id, tt.title, tt.created_at,
          (select count(*) from tag_thread_comments tc where tc.thread_id = tt.id and tc.is_hidden = false) as comment_count
        from tag_threads tt
        order by tt.created_at desc
        limit 8
      ) t
    ),
    'moderation', jsonb_build_object(
      'unread_contact_count', (select count(*) from contact_messages where status = 'unread'),
      'reported_visible_comments', (
        select count(distinct r.comment_id) from comment_reports r
        join comments c on c.id = r.comment_id
        where c.is_hidden = false
      ),
      'pending_broadcaster_requests', (select count(*) from broadcaster_requests where status = 'pending')
    ),
    'search', jsonb_build_object(
      'top_queries_7d', (
        select coalesce(jsonb_agg(t), '[]'::jsonb) from (
          select lower(query) as query, count(*) as search_count
          from search_log
          where created_at >= now() - interval '7 days'
          group by lower(query)
          order by search_count desc
          limit 10
        ) t
      ),
      'recent_searches', (
        select coalesce(jsonb_agg(t), '[]'::jsonb) from (
          select query, result_count, created_at
          from search_log
          order by created_at desc
          limit 20
        ) t
      )
    ),
    'cron_runs', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select j.jobname, r.status, r.start_time, r.end_time
        from cron.job_run_details r
        join cron.job j on j.jobid = r.jobid
        order by r.start_time desc
        limit 10
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$ language plpgsql security definer;
