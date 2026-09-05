-- 毎日の自動投稿（post-daily-ranking.ts）にトレンドランキング紹介を追加するのに伴い、
-- daily_ranking_posts.post_typeのCHECK制約に'trending'を許可する（2026-09-05追加）。
-- 「毎日の自動ポストにトレンドランキングも同様に投稿してほしい」という要望への対応。
alter table daily_ranking_posts drop constraint daily_ranking_posts_post_type_check;
alter table daily_ranking_posts add constraint daily_ranking_posts_post_type_check
  check (post_type in ('ranking', 'trending', 'clipper_spotlight', 'feature_intro'));
