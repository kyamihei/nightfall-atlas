-- ライブ活動フィードの「いま〇〇のスレが盛り上がっています」用。
-- 直近lookback_minutes分以内に投稿されたコメントをclip_idごとに集計し、
-- min_comments件以上ついている中で最もコメントが多いクリップを1件返す（無ければ0行）。
-- comments/clipsとも公開readポリシーがあるので匿名ロールでもそのまま呼べる。
create or replace function get_hot_thread(lookback_minutes int default 180, min_comments int default 2)
returns table(clip_id text, clip_title text, comment_count bigint) as $$
  select c.clip_id, cl.title, count(*) as comment_count
  from comments c
  join clips cl on cl.id = c.clip_id
  where c.created_at >= now() - (lookback_minutes || ' minutes')::interval
    and c.clip_id <> '__general_thread__'
    and c.is_hidden = false
  group by c.clip_id, cl.title
  having count(*) >= min_comments
  order by comment_count desc
  limit 1;
$$ language sql stable;
