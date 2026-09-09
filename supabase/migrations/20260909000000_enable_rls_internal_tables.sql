-- Supabaseのセキュリティアドバイザーが検出したCRITICAL ISSUE（rls_disabled_in_public）の修正。
-- daily_ranking_posts（X自動投稿の重複防止記録）・clip_cleanup_log（低視聴回数クリップ自動削除の
-- 実行ログ）の2テーブルが、テーブル作成時にRLS有効化を忘れており、anon/authenticatedロールに
-- select/insert/update/delete/truncateの権限が付いたままRLSも無効という、PostgREST経由で
-- 誰でも読み書き削除できてしまう状態だった（2026-09-09、Supabaseからのセキュリティ警告メールで発覚）。
--
-- どちらも完全に内部運用専用のテーブルで、フロントエンドから直接参照する箇所は無い
-- （daily_ranking_postsの読み書きはpost-daily-ranking.ts経由でservice_roleキーを使用、
-- clip_cleanup_logへの書き込みはcleanup_low_view_clips() security definer関数のみ）。
-- そのため公開ロール向けのポリシーは意図的に追加せず、RLSを有効化するだけでよい
-- （ポリシー無し＝anon/authenticatedへは全操作を拒否。テーブル所有者・service_role・
-- pg_cronジョブの実行ロールはRLSの影響を受けないため、既存の運用は壊れない）。

alter table daily_ranking_posts enable row level security;
alter table clip_cleanup_log enable row level security;
