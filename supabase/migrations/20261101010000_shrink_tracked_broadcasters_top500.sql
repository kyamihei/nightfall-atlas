-- Free plan化の縮小運用（2026-11-01）: 追跡配信者を累計視聴回数の上位500人に絞る。
-- 残した配信者はバックフィル済みとして扱う（未バックフィルだと日次同期が過去分を再取得し、
-- 削除済みの低視聴クリップがまた流入してしまうため）。
delete from tracked_broadcasters tb
where tb.broadcaster_name not in (
  select streamer from top_broadcasters_mv order by total_views desc limit 500
);
update tracked_broadcasters set backfilled_at = coalesce(backfilled_at, now());
