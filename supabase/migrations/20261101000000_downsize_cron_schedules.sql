-- Free plan化のための縮小運用（2026-11-01）。ジョブ本体（command）は変えず、頻度だけ下げる。
-- ライブ同期: 15分→30分（sync-live-clips.tsのCLIP_LOOKBACK_MINUTESを60分に拡大して取りこぼし防止）
-- view_count同期: 毎時→6時間おき
-- X自動投稿: 毎日→土曜のみ（JST 9:00=UTC 0:00、土曜のクリップ職人ランキング投稿）
select cron.alter_job((select jobid from cron.job where jobname = 'trigger-sync-live-clips'), schedule := '*/30 * * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'trigger-refresh-clip-views'), schedule := '20 */6 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'trigger-post-daily-ranking'), schedule := '0 0 * * 6');
