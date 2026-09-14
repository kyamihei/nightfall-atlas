-- trigger-cleanup-low-view-clipsが「cleanup_low_view_clips() → refresh_ranking_views()」を
-- 1つのコマンド文字列（=暗黙の1トランザクション）としてpg_cronに渡していたため、
-- refresh_ranking_views()がタイムアウトすると直前のcleanup_low_view_clips()による削除も
-- まとめてロールバックされてしまい、2026-09-08〜09-13の6日間、日次クリーンアップが
-- 実質的に何もしていない状態になっていた（clip_cleanup_logが9/7で止まっていたことで発覚）。
--
-- pg_cronがこのジョブを実行する`postgres`ロールにはservice_roleのような
-- statement_timeout引き上げ（300s、上のalter role文参照）が適用されておらず、
-- インスタンス既定値の120秒でタイムアウトしていた。
--
-- refresh_ranking_views()はrefresh-clip-views.ts（毎時、service_role経由でRPC呼び出し、
-- 300秒の余裕あり）が既に定期的に呼んでいるため、cleanup側からの呼び出しは冗長かつ
-- 有害（ロールバックの引き金になる）と判断し、削除する。
select cron.unschedule('trigger-cleanup-low-view-clips');

select cron.schedule(
  'trigger-cleanup-low-view-clips',
  '0 18 * * *',
  $$
  select cleanup_low_view_clips(14, 50, 15000);
  $$
);
