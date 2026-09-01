-- ============================================================
-- クリップランキングサイト（いいね/よくないね/お気に入り/匿名コメント）
-- Supabase (Postgres) スキーマ
-- ============================================================

-- クリップ本体（Twitch Helix APIから同期する想定）
create table if not exists clips (
  id text primary key,               -- Twitch clip id
  title text not null,
  streamer text not null,
  game text,
  view_count integer default 0,
  thumbnail_url text,
  created_at timestamptz default now()
);

-- いいね / よくないね（1人1票、取り消し可）
create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  clip_id text not null references clips(id) on delete cascade,
  anon_id uuid not null,             -- クライアントCookieで発行するUUID
  type text not null check (type in ('like', 'dislike')),
  created_at timestamptz default now(),
  unique (clip_id, anon_id)          -- 1クリップにつき1人1票
);

-- お気に入り
create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  clip_id text not null references clips(id) on delete cascade,
  anon_id uuid not null,
  created_at timestamptz default now(),
  unique (clip_id, anon_id)
);

-- 匿名コメント
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  clip_id text not null references clips(id) on delete cascade,
  anon_id uuid not null,             -- 表示はしない、開示請求対応用
  ip_hash text not null,             -- レート制限・複垢対策用（表示しない）
  display_name text default '名無しの視聴者',
  body text not null check (char_length(body) <= 280),
  report_count integer default 0,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_comments_clip on comments(clip_id, created_at desc);
create index if not exists idx_comments_ip_time on comments(ip_hash, created_at desc);

-- 通報履歴（二重通報防止）
create table if not exists comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments(id) on delete cascade,
  anon_id uuid not null,
  created_at timestamptz default now(),
  unique (comment_id, anon_id)
);

-- 自動発見した配信者を蓄積するテーブル
-- （日本語配信×対象ゲームカテゴリで見つかった配信者を都度upsertしていく）
create table if not exists tracked_broadcasters (
  broadcaster_id text primary key,
  broadcaster_name text not null,
  last_seen_at timestamptz default now()
);

-- 配信者名のあいまい検索用（pg_trgmで部分一致検索を高速化）
create extension if not exists pg_trgm;
create index if not exists idx_tracked_broadcasters_name_trgm
  on tracked_broadcasters using gin (broadcaster_name gin_trgm_ops);

-- ユーザーからの配信者登録リクエスト
-- Edge Function側でTwitch APIに実在確認をしてから status を確定させる
create table if not exists broadcaster_requests (
  id uuid primary key default gen_random_uuid(),
  twitch_login text not null,        -- ユーザーが入力したTwitchのログイン名（@なし）
  anon_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now()
);

create index if not exists idx_broadcaster_requests_anon_time
  on broadcaster_requests(anon_id, created_at desc);

-- ============================================================
-- RLS（Row Level Security）
-- ============================================================
alter table clips enable row level security;
alter table reactions enable row level security;
alter table favorites enable row level security;
alter table comments enable row level security;
alter table comment_reports enable row level security;
alter table tracked_broadcasters enable row level security;
alter table broadcaster_requests enable row level security;

-- tracked_broadcasters: 検索機能のため公開閲覧は許可。書き込みはservice roleのみ（ポリシーなし＝拒否）
drop policy if exists "tracked_broadcasters_public_read" on tracked_broadcasters;
create policy "tracked_broadcasters_public_read" on tracked_broadcasters
  for select using (true);

-- broadcaster_requests: 自分のリクエストのみ閲覧可（ステータス確認用）。挿入はEdge Function経由(service role)のみ

-- clips: 誰でも閲覧可、書き込みはサーバー(service role)のみ
drop policy if exists "clips_public_read" on clips;
create policy "clips_public_read" on clips
  for select using (true);

-- reactions: 誰でも閲覧可。書き込みは自分のanon_id分のみ
drop policy if exists "reactions_public_read" on reactions;
create policy "reactions_public_read" on reactions
  for select using (true);

drop policy if exists "reactions_insert_own" on reactions;
create policy "reactions_insert_own" on reactions
  for insert with check (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

drop policy if exists "reactions_delete_own" on reactions;
create policy "reactions_delete_own" on reactions
  for delete using (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

-- favorites: 自分の分のみ閲覧・書き込み可（人に見せる情報ではないため）
drop policy if exists "favorites_select_own" on favorites;
create policy "favorites_select_own" on favorites
  for select using (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

drop policy if exists "favorites_insert_own" on favorites;
create policy "favorites_insert_own" on favorites
  for insert with check (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

drop policy if exists "favorites_delete_own" on favorites;
create policy "favorites_delete_own" on favorites
  for delete using (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

-- comments: 非表示でないものは誰でも閲覧可。挿入は誰でも可（Edge Functionでレート制限・NGワード検査を挟む前提）
drop policy if exists "comments_public_read" on comments;
create policy "comments_public_read" on comments
  for select using (is_hidden = false);

drop policy if exists "comments_insert_any" on comments;
create policy "comments_insert_any" on comments
  for insert with check (true);

-- comment_reports: 挿入のみ許可（閲覧は運営のみ、通報の中身を晒さない）
drop policy if exists "comment_reports_insert_own" on comment_reports;
create policy "comment_reports_insert_own" on comment_reports
  for insert with check (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

drop policy if exists "broadcaster_requests_select_own" on broadcaster_requests;
create policy "broadcaster_requests_select_own" on broadcaster_requests
  for select using (anon_id = (current_setting('request.jwt.claims', true)::json->>'anon_id')::uuid);

-- ============================================================
-- 通報が閾値を超えたら自動非表示にするトリガー
-- ============================================================
create or replace function handle_new_report()
returns trigger as $$
begin
  update comments
  set report_count = report_count + 1,
      is_hidden = (report_count + 1) >= 3
  where id = new.comment_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_comment_report on comment_reports;
create trigger on_comment_report
  after insert on comment_reports
  for each row execute function handle_new_report();

-- ============================================================
-- 集計用RPC（フロントのuse-clip-ranking.tsから呼び出す）
-- ============================================================
-- クリップIDの配列を渡すと、それぞれのいいね数・よくないね数をまとめて返す関数。
-- 1クリップずつcountするより1回のRPC呼び出しで済むので、ランキング表示時に使う。
create or replace function get_reaction_counts(clip_ids text[])
returns table(clip_id text, likes bigint, dislikes bigint) as $$
  select clip_id,
    count(*) filter (where type = 'like') as likes,
    count(*) filter (where type = 'dislike') as dislikes
  from reactions
  where clip_id = any(clip_ids)
  group by clip_id;
$$ language sql stable;

-- ============================================================
-- 運用メモ
-- ============================================================
-- 1. anon_id はクライアント初回アクセス時にサーバー(Edge Function)がhttpOnly Cookieとして発行し、
--    Supabase Auth の匿名サインイン(signInAnonymously)のuidと一致させるとRLSと相性が良い。
-- 2. ip_hash はEdge Function側でIPをSHA-256等でハッシュ化してから保存し、生IPは保持しない。
-- 3. コメント投稿・通報はRLSだけでなく、Edge Function側でも
--    「同一ip_hashからのレート制限」「NGワード検査」を行うこと（クライアント側の制限は回避可能なため）。
-- 4. プロバイダ責任制限法対応のため、comments.ip_hash と created_at は
--    開示請求が来た場合に備えて一定期間（例: 90日）削除せず保持するポリシーを別途定めること。
