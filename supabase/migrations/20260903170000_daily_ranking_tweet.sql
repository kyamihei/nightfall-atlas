-- 毎日のランキングをXへ自動投稿する機能（2026-09-03追加）。
-- 「訪問者数を増やしたい」という相談から、psychologically人がサイトを見たくなる
-- 「問いかけ型」の投稿文（前日1位のクリップを問いかけ形式で紹介し、クリップページへ誘導する）を
-- 毎朝JST 9:00（UTC 0:00）に自動投稿する。実際の投稿処理は post-daily-ranking.ts（Deno）が行い、
-- pg_cron+pg_net（他の定期ジョブと同じ、GitHub Actionsのscheduleトリガーは信頼できないため
-- 使わない方式、詳細はCLAUDE.md「GitHub Actionsのscheduleトリガーが信頼できない問題」参照）で
-- workflow_dispatchを確実に起動する。

-- pg_cronのwebhook呼び出しが何らかの理由で重複しても同じ日に二重投稿しないための記録テーブル。
create table if not exists daily_ranking_posts (
  posted_date date primary key, -- JST基準の日付（'yyyy-mm-dd'）
  clip_id text not null references clips(id),
  tweet_id text,
  posted_at timestamptz not null default now()
);

select cron.schedule(
  'trigger-post-daily-ranking',
  '0 0 * * *', -- UTC 0:00 = JST 9:00
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/kyamihei/clip-vote/actions/workflows/post-daily-ranking.yml/dispatches',
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
