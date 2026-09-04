-- 管理画面ダッシュボードに「クリップの自動整理」状況を追加（2026-09-04）。
-- 「管理画面で削除されたクリップ数を可視化できるようにしましょう」という要望への対応。
-- 累計削除件数と直近の実行履歴（clip_cleanup_log）をadmin_get_dashboardの戻り値に追加する
-- （既存の「定期同期(pg_cron)の実行状況」セクションと同じ、1回のRPC呼び出しにまとめる方針）。
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
    ),
    'cleanup', jsonb_build_object(
      'total_deleted', (select coalesce(sum(deleted_count), 0) from clip_cleanup_log),
      'recent_runs', (
        select coalesce(jsonb_agg(t), '[]'::jsonb) from (
          select run_at, deleted_count, grace_period_days, view_threshold
          from clip_cleanup_log
          order by run_at desc
          limit 10
        ) t
      )
    )
  ) into v_result;

  return v_result;
end;
$$ language plpgsql security definer;
