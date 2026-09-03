-- 毎日のX投稿のテーマローテーション対応（2026-09-03追加）。
-- 「日本唯一のTwitchクリップ掲示板サイト」「クリップ職人の紹介」「自分のクリップコレクション
-- （お気に入り）を作れる」の3点を宣伝したいという要望を受け、平日はランキング問いかけ型、
-- 土曜はクリップ職人紹介型、日曜は機能紹介型をローテーションする方式にした
-- （post-daily-ranking.ts側でJSTの曜日を見て文面を切り替える）。
-- クリップ職人紹介・機能紹介の投稿は特定のクリップ1件に紐づかないため、
-- daily_ranking_postsのclip_idをNOT NULLからNULL許容に変更し、どのテーマを投稿したか
-- 判別できるようpost_type列を追加する。

alter table daily_ranking_posts alter column clip_id drop not null;
alter table daily_ranking_posts add column if not exists post_type text not null default 'ranking'
  check (post_type in ('ranking', 'clipper_spotlight', 'feature_intro'));
