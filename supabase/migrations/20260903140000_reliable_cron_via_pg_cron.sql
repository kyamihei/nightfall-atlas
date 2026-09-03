-- GitHub Actionsの`schedule`トリガー自体が本番で信頼できないことが判明したため
-- （2026-09-03、実測: 15分おきのはずのsync-live-clips.ymlが直近12時間で2回しか実行されず、
-- 加藤純一の新規クリップが取りこぼされる実害が発生）、Supabase側のpg_cron（DBレベルのスケジューラ、
-- GitHub Actions自体の混雑に左右されない）から確実にworkflow_dispatchをWebhookで叩く方式に変更する。
--
-- GitHub側のPAT（Actions:Read-and-write権限、clip-voteリポジトリのみに限定したfine-grained token）は
-- このマイグレーションには含めず、事前に以下で登録済みの前提（Vaultは平文をgit管理下に置かないため）:
--   select vault.create_secret('<PAT>', 'github_actions_pat', '...');
--
-- 各workflowファイル側の`schedule:`トリガーはこの変更と同時に削除し、二重実行を防ぐ
-- （`workflow_dispatch:`は手動実行・このcronからのAPI呼び出し用に残す）。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 15分おき: いまライブ配信中の追跡配信者だけをチェックする軽量同期
select cron.schedule(
  'trigger-sync-live-clips',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/clip-vote/actions/workflows/sync-live-clips.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'clip-vote-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);

-- 毎時20分: 既存クリップのview_countを再取得する
select cron.schedule(
  'trigger-refresh-clip-views',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/clip-vote/actions/workflows/refresh-clip-views.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'clip-vote-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);

-- 毎日UTC 21:05（JST 6:05）: 追跡配信者全員の直近24時間分クリップ収集・新規配信者発見・バックフィル
select cron.schedule(
  'trigger-sync-clips',
  '5 21 * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/clip-vote/actions/workflows/sync-clips.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'clip-vote-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);
