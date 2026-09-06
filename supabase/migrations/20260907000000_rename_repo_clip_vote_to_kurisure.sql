-- GitHubリポジトリ名をclip-voteからkurisureへ変更したことに伴い、
-- pg_cronがworkflow_dispatchを叩くURL・User-Agentを新リポジトリ名へ更新する。
-- cron.schedule(job_name, ...)は同名ジョブが既に存在する場合は置き換え（upsert）となるため、
-- 元の定義（supabase/schema.sql）と同じjob_name・スケジュールのまま、URLだけ書き換えて再実行する。

select cron.schedule(
  'trigger-sync-live-clips',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/kurisure/actions/workflows/sync-live-clips.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'kurisure-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);

select cron.schedule(
  'trigger-refresh-clip-views',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/kurisure/actions/workflows/refresh-clip-views.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'kurisure-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);

select cron.schedule(
  'trigger-sync-clips',
  '5 21 * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/kurisure/actions/workflows/sync-clips.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'kurisure-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);

select cron.schedule(
  'trigger-post-daily-ranking',
  '0 0 * * *', -- UTC 0:00 = JST 9:00
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/kurisure/actions/workflows/post-daily-ranking.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'kurisure-pg-cron'
    ),
    body := jsonb_build_object('ref', 'master'),
    timeout_milliseconds := 10000
  );
  $$
);
