-- ============================================================
-- クリップランキングサイト（いいね/よくないね/お気に入り/匿名コメント）
-- Supabase (Postgres) スキーマ
-- ============================================================

-- クリップ本体（Twitch Helix APIから同期する想定）
create table if not exists clips (
  id text primary key,               -- Twitch clip id（埋め込みプレイヤーのclipパラメータにもそのまま使う）
  title text not null,
  streamer text not null,
  game text,
  view_count integer default 0,
  thumbnail_url text,
  twitch_created_at timestamptz,      -- クリップが実際にTwitch上で作成された日時（期間フィルタ用）
  created_at timestamptz default now() -- このDBに行が作られた日時（Twitch側の日時とは別物）
);

-- 既存テーブルへの追従（create table if not existsは既存テーブルにはカラムを追加しないため明示的に実行）
alter table clips add column if not exists twitch_created_at timestamptz;

-- クリップの「作者」（＝配信者ではなく、クリップを切った視聴者）。
-- Twitch Helix Get Clipsのレスポンスにはbroadcaster_id/nameとは別にcreator_id/nameが含まれているが、
-- 元の実装では保存していなかった。クリッパーランキング機能のために追加する。
-- 既存クリップ分はnullのままなので、backfill-clip-creators.tsで遡及取得する想定。
alter table clips add column if not exists creator_id text;
alter table clips add column if not exists creator_name text;

-- 視聴回数の定期同期（refresh-clip-views.ts）用。sync-twitch-clips.tsの通常収集は
-- 「作成から24時間以内のクリップ」しか見ないため、それより古いクリップのview_countは
-- 初回取得時の値のまま更新されず実際の値と乖離していく。この列に「最後にview_countを
-- 同期した時刻」を記録し、最も古い（＝一番view_countが実態とズレていそうな）ものから
-- 順番に再取得するラウンドロビン方式で全クリップを定期的に回す。
alter table clips add column if not exists view_count_synced_at timestamptz;
create index if not exists idx_clips_view_count_synced_at on clips(view_count_synced_at nulls first);

create index if not exists idx_clips_period_ranking
  on clips(twitch_created_at desc, view_count desc);

create index if not exists idx_clips_creator on clips(creator_id) where creator_id is not null;

-- 総合スレ（掲示板全体の雑談スレ）用のダミークリップ行。既存のcomments/post-comment/Realtime
-- サブスクリプションの仕組みをそのまま流用するため、clipsテーブルに実在しない特別な行として持たせる
-- （clip_id外部キー制約を満たしつつ、view_count=0・twitch_created_at=nullでランキング等の対象外にできる）。
-- ランキング系RPC（get_ranked_clips, search_clips, get_trending_clips）は明示的にこのidを除外している。
insert into clips (id, title, streamer, game, view_count, thumbnail_url, twitch_created_at)
values ('__general_thread__', '総合スレ', '（掲示板全体）', null, 0, null, null)
on conflict (id) do nothing;

-- 「全期間」×「視聴回数順」（並び替えのデフォルト）は期間で絞り込まれないため
-- idx_clips_period_rankingのtwitch_created_at先頭では使えない。view_count単独の索引で
-- ORDER BY view_count DESC LIMITを索引スキャンだけで完結させる。
create index if not exists idx_clips_view_count on clips(view_count desc);

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

-- リアクションスタンプ（いいね/よくないねの代替、2026-09-03追加）。
-- Slackのリアクション絵文字のように、1人が同じクリップに複数種類のスタンプを付けられる
-- （clip_id+anon_id+stampの組で一意、stamp違いなら複数行OK）。
create table if not exists clip_reaction_stamps (
  id uuid primary key default gen_random_uuid(),
  clip_id text not null references clips(id) on delete cascade,
  anon_id uuid not null,
  stamp text not null check (stamp in ('すっご', 'うおｗ', 'えっど', 'こっわ', 'うっま', 'へった', 'ひっど')),
  created_at timestamptz default now(),
  unique (clip_id, anon_id, stamp)
);

create index if not exists idx_clip_reaction_stamps_clip on clip_reaction_stamps(clip_id);

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

-- コメントへの返信（1階層のみ）。親コメントが削除された場合は返信も連鎖削除する。
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;

create index if not exists idx_comments_clip on comments(clip_id, created_at desc);
create index if not exists idx_comments_ip_time on comments(ip_hash, created_at desc);
create index if not exists idx_comments_parent on comments(parent_id);

-- use-clip-ranking.ts の useComments は Realtime(postgres_changes)でコメントの新規投稿を購読する設計。
-- テーブルを明示的にpublicationへ加えないとINSERTイベントがクライアントに届かないため必須。
-- ALTER PUBLICATION ... ADD TABLE は再実行するとエラーになるため、DOブロックで存在チェックしてから実行する。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table comments;
  end if;
end $$;

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

-- 配信者の所属グループ表示用タグ（自動付与はせず、運営がSupabase側で手動設定する想定の簡易版）
alter table tracked_broadcasters add column if not exists tag text;

-- 配信者アイコン画像URL（Twitchのプロフィール画像。Get Users APIで取得・更新する）
alter table tracked_broadcasters add column if not exists profile_image_url text;

-- 過去分クリップの遡及取得（バックフィル）を実施済みかどうか。
-- nullのままの配信者はsync-twitch-clips.tsが次回実行時にバックフィル対象として拾う。
alter table tracked_broadcasters add column if not exists backfilled_at timestamptz;

-- 配信者名のあいまい検索用（pg_trgmで部分一致検索を高速化）
create extension if not exists pg_trgm;
create index if not exists idx_tracked_broadcasters_name_trgm
  on tracked_broadcasters using gin (broadcaster_name gin_trgm_ops);

-- クリップタイトルのあいまい検索用（search_clips RPCで使う）
create index if not exists idx_clips_title_trgm
  on clips using gin (title gin_trgm_ops);

-- クリップを作った視聴者（クリッパー）のプロフィール情報を蓄積するテーブル。
-- tracked_broadcastersと同じ構造・同じ運用（sync-twitch-clips.tsが同期のたびにupsertする）。
create table if not exists tracked_clippers (
  creator_id text primary key,
  creator_name text not null,
  profile_image_url text,
  last_seen_at timestamptz default now()
);

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

-- お問い合わせフォームからの投稿。一般公開の閲覧ポリシーは設けず、運営が
-- `npx supabase db query --linked "select * from contact_messages order by created_at desc"`
-- （postgresロールでRLSをバイパスして直接クエリ）で確認する運用（管理画面UIは未実装）。
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  anon_id uuid not null,
  category text not null default 'other' check (category in ('bug', 'request', 'report', 'other')),
  email text,                        -- 返信希望の場合のみ任意入力
  body text not null,
  ip_hash text,
  status text not null default 'unread' check (status in ('unread', 'read')),
  created_at timestamptz default now()
);

create index if not exists idx_contact_messages_created on contact_messages(created_at desc);

-- ============================================================
-- RLS（Row Level Security）
-- ============================================================
alter table clips enable row level security;
alter table reactions enable row level security;
alter table favorites enable row level security;
alter table clip_reaction_stamps enable row level security;
alter table comments enable row level security;
alter table comment_reports enable row level security;
alter table tracked_broadcasters enable row level security;
alter table tracked_clippers enable row level security;
alter table broadcaster_requests enable row level security;
alter table contact_messages enable row level security;

-- tracked_broadcasters: 検索機能のため公開閲覧は許可。書き込みはservice roleのみ（ポリシーなし＝拒否）
drop policy if exists "tracked_broadcasters_public_read" on tracked_broadcasters;
create policy "tracked_broadcasters_public_read" on tracked_broadcasters
  for select using (true);

-- tracked_clippers: クリッパーランキング表示のため公開閲覧は許可。書き込みはservice roleのみ
drop policy if exists "tracked_clippers_public_read" on tracked_clippers;
create policy "tracked_clippers_public_read" on tracked_clippers
  for select using (true);

-- broadcaster_requests: 自分のリクエストのみ閲覧可（ステータス確認用）。挿入はEdge Function経由(service role)のみ

-- contact_messages: 挿入は自分のanon_idの行のみ許可（submit-contact Edge Function経由）。
-- 閲覧の公開ポリシーは設けない＝運営のみが直接SQLで確認する想定。
--
-- 【重要な注意】Edge Function側で `createClient(url, SERVICE_ROLE_KEY, { global: { headers: {
-- Authorization: authHeader } } })` のようにservice roleキーでクライアントを作りつつ
-- ユーザー自身のJWTをAuthorizationヘッダーに上書き設定するパターン（post-comment等で採用）は、
-- 「service roleとしてRLSをバイパスする」わけではない。PostgRESTはAuthorizationヘッダーの
-- JWTからロール・auth.uid()を決定するため、実際には authenticated ロールとしてRLSが適用される
-- （apikeyヘッダーのservice roleキーはプロジェクト識別に使われるのみ）。そのため、この構成の
-- Edge Function経由で書き込むテーブルには、対象ロール向けのinsert/updateポリシーが必須。
-- 本番で実際にハマった: contact_messagesにポリシーを用意し忘れ、Edge Functionの挿入が
-- 500エラーで失敗した（2026-09-03）。broadcaster_requestsもinsertポリシーが無いままだが、
-- request-broadcaster側が挿入結果のエラーを無視しているため気付かれていない可能性がある
-- （未検証・別途要調査）。
drop policy if exists "contact_messages_insert_own" on contact_messages;
create policy "contact_messages_insert_own" on contact_messages
  for insert with check (anon_id = auth.uid());

-- clips: 誰でも閲覧可、書き込みはサーバー(service role)のみ
drop policy if exists "clips_public_read" on clips;
create policy "clips_public_read" on clips
  for select using (true);

-- reactions: 誰でも閲覧可。書き込みは自分のanon_id分のみ
-- auth.uid() はSupabaseの組み込み関数で、JWTのsubクレーム（＝匿名認証のユーザーID）を返す。
-- 独自クレームではなくこちらを使うのが正しい参照方法。
drop policy if exists "reactions_public_read" on reactions;
create policy "reactions_public_read" on reactions
  for select using (true);

drop policy if exists "reactions_insert_own" on reactions;
create policy "reactions_insert_own" on reactions
  for insert with check (anon_id = auth.uid());

drop policy if exists "reactions_delete_own" on reactions;
create policy "reactions_delete_own" on reactions
  for delete using (anon_id = auth.uid());

-- favorites: 自分の分のみ閲覧・書き込み可（人に見せる情報ではないため）
drop policy if exists "favorites_select_own" on favorites;
create policy "favorites_select_own" on favorites
  for select using (anon_id = auth.uid());

drop policy if exists "favorites_insert_own" on favorites;
create policy "favorites_insert_own" on favorites
  for insert with check (anon_id = auth.uid());

drop policy if exists "favorites_delete_own" on favorites;
create policy "favorites_delete_own" on favorites
  for delete using (anon_id = auth.uid());

-- clip_reaction_stamps: 誰でも閲覧可（件数を出すため）。書き込みは自分の分のみ
drop policy if exists "clip_reaction_stamps_public_read" on clip_reaction_stamps;
create policy "clip_reaction_stamps_public_read" on clip_reaction_stamps
  for select using (true);

drop policy if exists "clip_reaction_stamps_insert_own" on clip_reaction_stamps;
create policy "clip_reaction_stamps_insert_own" on clip_reaction_stamps
  for insert with check (anon_id = auth.uid());

drop policy if exists "clip_reaction_stamps_delete_own" on clip_reaction_stamps;
create policy "clip_reaction_stamps_delete_own" on clip_reaction_stamps
  for delete using (anon_id = auth.uid());

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
  for insert with check (anon_id = auth.uid());

drop policy if exists "broadcaster_requests_select_own" on broadcaster_requests;
create policy "broadcaster_requests_select_own" on broadcaster_requests
  for select using (anon_id = auth.uid());


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

-- クリップIDの配列を渡すと、それぞれのお気に入り数をまとめて返す関数（get_reaction_countsと同じ発想）。
-- お気に入り数順ソート導入時に、一覧表示で件数を出すために追加。
create or replace function get_favorite_counts(clip_ids text[])
returns table(clip_id text, favorite_count bigint) as $$
  select clip_id, count(*) as favorite_count
  from favorites
  where clip_id = any(clip_ids)
  group by clip_id;
$$ language sql stable;

-- クリップIDの配列を渡すと、それぞれのスタンプ種別ごとの件数をまとめて返す（リアクションスタンプ用）。
create or replace function get_stamp_counts(clip_ids text[])
returns table(clip_id text, stamp text, stamp_count bigint) as $$
  select clip_id, stamp, count(*) as stamp_count
  from clip_reaction_stamps
  where clip_id = any(clip_ids)
  group by clip_id, stamp;
$$ language sql stable;

-- ============================================================
-- 配信者/クリッパーランキングの事前集計ビュー
-- ============================================================
-- streamer/creator_id単位の集計（sum/group by）はclips全件（数十万行）を毎回スキャンする必要があり、
-- 匿名ロール(anon)のstatement_timeout=3sを本番実測で超える（get_ranked_clipsで踏んだのと同じ罠）。
-- 集計はsync-twitch-clips.ts実行のたびに更新すれば十分な鮮度のため、
-- マテリアライズドビューとして事前計算し、RPCはそれを読むだけにする。
drop materialized view if exists top_broadcasters_mv;
create materialized view top_broadcasters_mv as
  select c.streamer,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tb.tag) as tag,
    max(tb.profile_image_url) as profile_image_url
  from clips c
  left join tracked_broadcasters tb on tb.broadcaster_name = c.streamer
  where c.id <> '__general_thread__'
  group by c.streamer;

-- REFRESH ... CONCURRENTLYには一意索引が必須（無いと参照中の読み取りをロックしてしまう）
create unique index if not exists idx_top_broadcasters_mv_streamer on top_broadcasters_mv(streamer);
create index if not exists idx_top_broadcasters_mv_views on top_broadcasters_mv(total_views desc);

-- rank: クリップ単位の「このクリップ職人は総合n位」バッジ表示（get_clipper_ranks）用に
-- あらかじめ順位を計算しておく。
drop materialized view if exists top_clippers_mv;
create materialized view top_clippers_mv as
  select c.creator_id,
    max(c.creator_name) as creator_name,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tc.profile_image_url) as profile_image_url,
    row_number() over (order by sum(c.view_count) desc) as rank
  from clips c
  left join tracked_clippers tc on tc.creator_id = c.creator_id
  where c.creator_id is not null
  group by c.creator_id;

create unique index if not exists idx_top_clippers_mv_creator on top_clippers_mv(creator_id);
create index if not exists idx_top_clippers_mv_views on top_clippers_mv(total_views desc);

-- 「年間/月間」クリップ職人ランキング（/clippers ページのタブ切り替え用）。
-- get_top_clippers_by_period（週間ウィジェット用）は期間で絞られる行数が少ない前提の
-- ライブ集計だが、「今年」だけで6万件規模になり匿名ロールのstatement_timeout(3s)を
-- 本番実測で大きく超える（約7秒）ため、総合ランキングと同じく事前集計が必要。
-- date_trunc('year'/'month', now())はリフレッシュを実行するたびに再評価されるため、
-- 日次〜1時間おきのリフレッシュ（sync-twitch-clips.ts / refresh-clip-views.ts）が
-- 走っている限り、年またぎ・月またぎも1日以内には自動的に切り替わる。
drop materialized view if exists top_clippers_this_year_mv;
create materialized view top_clippers_this_year_mv as
  select c.creator_id,
    max(c.creator_name) as creator_name,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tc.profile_image_url) as profile_image_url
  from clips c
  left join tracked_clippers tc on tc.creator_id = c.creator_id
  where c.creator_id is not null
    and c.twitch_created_at >= date_trunc('year', now())
    and c.twitch_created_at < date_trunc('year', now()) + interval '1 year'
  group by c.creator_id;

create unique index if not exists idx_top_clippers_this_year_mv_creator on top_clippers_this_year_mv(creator_id);
create index if not exists idx_top_clippers_this_year_mv_views on top_clippers_this_year_mv(total_views desc);

drop materialized view if exists top_clippers_this_month_mv;
create materialized view top_clippers_this_month_mv as
  select c.creator_id,
    max(c.creator_name) as creator_name,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tc.profile_image_url) as profile_image_url
  from clips c
  left join tracked_clippers tc on tc.creator_id = c.creator_id
  where c.creator_id is not null
    and c.twitch_created_at >= date_trunc('month', now())
    and c.twitch_created_at < date_trunc('month', now()) + interval '1 month'
  group by c.creator_id;

create unique index if not exists idx_top_clippers_this_month_mv_creator on top_clippers_this_month_mv(creator_id);
create index if not exists idx_top_clippers_this_month_mv_views on top_clippers_this_month_mv(total_views desc);

-- sync-twitch-clips.ts が同期完了後に呼び出す。service_roleのみ実行可（匿名/認証ユーザーからの
-- 乱用によるリフレッシュ連打を防ぐため、publicへのEXECUTE権限を明示的に外している）。
create or replace function refresh_ranking_views()
returns void as $$
begin
  refresh materialized view concurrently top_broadcasters_mv;
  refresh materialized view concurrently top_clippers_mv;
  refresh materialized view concurrently top_clippers_this_year_mv;
  refresh materialized view concurrently top_clippers_this_month_mv;
end;
$$ language plpgsql security definer;

revoke execute on function refresh_ranking_views() from public;
grant execute on function refresh_ranking_views() to service_role;

-- REFRESH MATERIALIZED VIEW CONCURRENTLYは読み取りをブロックしない代わりに低速（本番実測で約19秒）で、
-- service_roleの既定statement_timeout（authenticatorから継承する8秒程度、実測9秒でタイムアウト）を
-- 超えてしまう。service_roleはバックエンドの同期スクリプト専用の鍵（一般公開されない）なので、
-- このロールに限りタイムアウトを緩和する。
alter role service_role set statement_timeout = '120s';

-- backfill-clip-creators.ts 専用のバルク更新RPC。
-- clips.title等はNOT NULL制約があり、PostgRESTのupsertはON CONFLICT DO UPDATEのみが実行される
-- 場合でもINSERT側の候補行としてNOT NULL列の値を要求してしまうため使えない（実測済み）。
-- UPDATE ... FROM jsonb_to_recordset(...) であれば指定した列だけを更新でき、
-- かつ1回のRPC呼び出しで最大100件まとめて更新できる。
create or replace function bulk_update_clip_creators(updates jsonb)
returns void as $$
  update clips c
  set creator_id = u.creator_id, creator_name = u.creator_name
  from jsonb_to_recordset(updates) as u(id text, creator_id text, creator_name text)
  where c.id = u.id;
$$ language sql volatile security definer;

revoke execute on function bulk_update_clip_creators(jsonb) from public;
grant execute on function bulk_update_clip_creators(jsonb) to service_role;

-- refresh-clip-views.ts 専用のバルク更新RPC（view_countの定期同期用）。
-- bulk_update_clip_creatorsと同じ理由でupsertが使えないため、UPDATE ... FROM
-- jsonb_to_recordset(...)で view_count / view_count_synced_at だけを更新する。
-- Twitch側で見つからなかった（削除済み等の）クリップはview_countにnullを渡す想定で、
-- その場合は既存値を維持しつつview_count_synced_atだけ更新する
-- （そうしないと毎回「最も同期が古いクリップ」として選ばれ続けてしまうため）。
create or replace function bulk_update_clip_views(updates jsonb)
returns void as $$
  update clips c
  set view_count = coalesce(u.view_count, c.view_count), view_count_synced_at = now()
  from jsonb_to_recordset(updates) as u(id text, view_count integer)
  where c.id = u.id;
$$ language sql volatile security definer;

revoke execute on function bulk_update_clip_views(jsonb) from public;
grant execute on function bulk_update_clip_views(jsonb) to service_role;

-- 人気配信者一覧（事前集計済みビューを読むだけなので高速）
drop function if exists get_top_broadcasters(int);
drop function if exists get_top_broadcasters(int, int);
create or replace function get_top_broadcasters(broadcaster_limit int default 20, broadcaster_offset int default 0)
returns table(streamer text, total_views bigint, clip_count bigint, tag text, profile_image_url text) as $$
  select streamer, total_views, clip_count, tag, profile_image_url
  from top_broadcasters_mv
  order by total_views desc
  limit broadcaster_limit offset broadcaster_offset;
$$ language sql stable;

-- 人気クリッパー一覧（クリップを作った視聴者のランキング。事前集計済みビューを読むだけ）
drop function if exists get_top_clippers(int, int);
create or replace function get_top_clippers(clipper_limit int default 20, clipper_offset int default 0)
returns table(creator_id text, creator_name text, total_views bigint, clip_count bigint, profile_image_url text, rank int) as $$
  select creator_id, creator_name, total_views, clip_count, profile_image_url, rank::int
  from top_clippers_mv
  order by total_views desc
  limit clipper_limit offset clipper_offset;
$$ language sql stable;

-- クリップ職人詳細ページのヘッダー用。合計視聴回数・クリップ数は「期間で絞り込んだ一覧の先頭N件」
-- から計算すると多作なクリップ職人で数値が過小表示されてしまうため、事前集計済みのtop_clippers_mv
-- （全期間・全クリップ対象）から正確な値を返す。マテリアライズドビューはRLSが効かないため、
-- security definerで明示的に読み取り専用の値だけを返す。
drop function if exists get_clipper_stats(text);
create or replace function get_clipper_stats(target_creator_id text)
returns table(total_views bigint, clip_count bigint, profile_image_url text, rank int) as $$
  select total_views, clip_count, profile_image_url, rank::int
  from top_clippers_mv
  where creator_id = target_creator_id;
$$ language sql stable security definer;

-- 指定したcreator_idの一覧について、総合ランキングでの順位を返す（rankが無い＝ランキング外は返さない）。
-- クリップ一覧の各行に「クリップ職人 総合n位」バッジを出すため、表示中のクリップの作者idをまとめて渡す
-- （クリップ1件ごとに個別クエリするとN+1になるため）。マテリアライズドビューはRLSが効かないため
-- security definerにしている。
create or replace function get_clipper_ranks(target_creator_ids text[], max_rank int default 100)
returns table(creator_id text, rank int) as $$
  select creator_id, rank::int
  from top_clippers_mv
  where creator_id = any(target_creator_ids) and rank <= max_rank;
$$ language sql stable security definer;

-- 週間クリップ職人ランキング（トップページ表示用）専用。top_clippers_mvは全期間の事前集計のため、
-- 期間を絞った順位はここでその場で集計する。twitch_created_atの索引（idx_clips_period_ranking）で
-- 週1回分のクリップ数（数千件規模）まで絞り込んでから集計するぶんには軽いが、「今年」規模
-- （6万件超）だと本番実測で約7秒かかり匿名ロールのタイムアウトを超えるため、
-- /clippers ページの「年間/月間」タブにはこの関数を使わないこと
-- （代わりにget_top_clippers_this_year / get_top_clippers_this_monthを使う）。
-- clipper_offset追加時、create or replaceだけでは古い3引数版が残ってPostgREST側で
-- どちらを呼ぶか一意に決められなくなる（実際に本番で発生・修正）ため明示的にdropする。
drop function if exists get_top_clippers_by_period(timestamptz, timestamptz, int);
create or replace function get_top_clippers_by_period(
  period_start timestamptz,
  period_end timestamptz,
  clipper_limit int default 10,
  clipper_offset int default 0
)
returns table(creator_id text, creator_name text, total_views bigint, clip_count bigint, profile_image_url text) as $$
  select c.creator_id,
    max(c.creator_name) as creator_name,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tc.profile_image_url) as profile_image_url
  from clips c
  left join tracked_clippers tc on tc.creator_id = c.creator_id
  where c.creator_id is not null
    and c.twitch_created_at >= period_start
    and c.twitch_created_at < period_end
  group by c.creator_id
  order by total_views desc
  limit clipper_limit offset clipper_offset;
$$ language sql stable;

-- 年間/月間クリップ職人ランキング（/clippers ページのタブ切り替え用）。事前集計済みビューを読むだけ。
create or replace function get_top_clippers_this_year(clipper_limit int default 20, clipper_offset int default 0)
returns table(creator_id text, creator_name text, total_views bigint, clip_count bigint, profile_image_url text) as $$
  select creator_id, creator_name, total_views, clip_count, profile_image_url
  from top_clippers_this_year_mv
  order by total_views desc
  limit clipper_limit offset clipper_offset;
$$ language sql stable;

create or replace function get_top_clippers_this_month(clipper_limit int default 20, clipper_offset int default 0)
returns table(creator_id text, creator_name text, total_views bigint, clip_count bigint, profile_image_url text) as $$
  select creator_id, creator_name, total_views, clip_count, profile_image_url
  from top_clippers_this_month_mv
  order by total_views desc
  limit clipper_limit offset clipper_offset;
$$ language sql stable;

-- ランキング一覧を「視聴回数順(views) / 新着順(newest) / いいね順(likes) / コメント数順(comments)」の
-- いずれかで並び替え、期間フィルタ・ページネーションを一度に処理して返す。
-- count(*) over() で「期間フィルタ後の全件数」も同時に返すため、フロント側は別途件数取得が不要。
--
-- 実装メモ（すべて本番での実測タイムアウトを踏まえた対応）:
-- 1. period_start/period_endは「未指定なら絞り込まない」を "is null or ..." ではなく
--    -infinity/infinityのデフォルト値で表現している。PostgRESTはRPCをプリペアードステートメントとして
--    実行するため、"(param is null or col >= param)" という書き方だと呼び出し回数を重ねた際に
--    汎用実行計画（generic plan）へ切り替わり、twitch_created_atの索引（idx_clips_period_ranking）が
--    使われずclips全件（数十万行）を毎回スキャンしてしまう。単純な範囲比較にすることで
--    汎用実行計画でも索引が使われる。
-- 2. views/newest（デフォルト・新着順）はreactions/commentsとのJOINが不要なため、
--    集計を一切せずclipsだけを索引スキャン+LIMITする軽量経路を使う
--    （views/newestはユーザーが最も頻繁に使う並び替えのため、従来の性能を維持する）。
-- 3. likes/comments（いいね順・コメント数順）は集計が必須で、reactions/comments（小さいテーブル）を
--    起点にclipsへJOINすることで、期間を絞らない「全期間」指定時でもclips全件（数十万行）を
--    スキャンせずに済むようにしている（反応/コメントが0件のクリップはこの並び順には現れない）。
-- 4. creator_id/creator_name（クリップ職人）も返す。行ごとの「ランキング内順位」バッジは
--    別途get_clipper_ranks RPCでcreator_id単位にまとめて引く設計（クリップ1件ごとに
--    ランキング計算をするとN+1になるため）。
-- 5. '__general_thread__' は総合スレ用のダミークリップ行（後述）。ランキングには一切出さないため
--    全分岐のWHEREでid <> '__general_thread__'を明示的に外す。
drop function if exists get_ranked_clips(timestamptz, timestamptz, text, int, int);
create or replace function get_ranked_clips(
  period_start timestamptz default '-infinity',
  period_end timestamptz default 'infinity',
  sort_by text default 'views',
  page_limit int default 20,
  page_offset int default 0
)
returns table(
  id text,
  title text,
  streamer text,
  game text,
  view_count integer,
  thumbnail_url text,
  twitch_created_at timestamptz,
  creator_id text,
  creator_name text,
  likes bigint,
  dislikes bigint,
  comment_count bigint,
  favorite_count bigint,
  stamp_count bigint,
  total_count bigint
) as $$
declare
  v_total bigint;
  v_unbounded boolean := period_start = '-infinity'::timestamptz and period_end = 'infinity'::timestamptz;
begin
  if sort_by = 'likes' then
    -- いいね順・コメント数順は、反応/コメントが1件も付いていないクリップまで含めて
    -- clips全件（数十万件）を毎回スキャン・ウィンドウ集計すると匿名ロールの
    -- statement_timeout(3s)を超えるため、reactions側を起点にする。
    -- 「反応が0件のクリップ」はこのランキングには現れない仕様とする
    -- （エンゲージメント順のランキングとしては一般的な挙動で、性能上も現実的）。
    return query
      with agg as (
        select r.clip_id,
          count(*) filter (where r.type = 'like') as likes,
          count(*) filter (where r.type = 'dislike') as dislikes
        from reactions r
        group by r.clip_id
      ),
      matched as (
        select c.*, a.likes, a.dislikes
        from agg a
        join clips c on c.id = a.clip_id
        where c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and c.id <> '__general_thread__'
      )
      select
        m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
        m.creator_id, m.creator_name,
        m.likes, m.dislikes, 0::bigint as comment_count, 0::bigint as favorite_count, 0::bigint as stamp_count,
        count(*) over() as total_count
      from matched m
      order by m.likes desc, m.view_count desc, m.id
      limit page_limit offset page_offset;
  elsif sort_by = 'comments' then
    return query
      with agg as (
        select cm.clip_id, count(*) as comment_count
        from comments cm
        where cm.is_hidden = false
        group by cm.clip_id
      ),
      matched as (
        select c.*, a.comment_count
        from agg a
        join clips c on c.id = a.clip_id
        where c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and c.id <> '__general_thread__'
      )
      select
        m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
        m.creator_id, m.creator_name,
        0::bigint as likes, 0::bigint as dislikes, m.comment_count, 0::bigint as favorite_count, 0::bigint as stamp_count,
        count(*) over() as total_count
      from matched m
      order by m.comment_count desc, m.view_count desc, m.id
      limit page_limit offset page_offset;
  elsif sort_by = 'favorites' then
    -- お気に入り数順。favoritesテーブル（小さい）を起点にclipsへJOINする、likes/commentsと同じ設計。
    -- 「お気に入りが0件のクリップ」はこのランキングには現れない。
    return query
      with agg as (
        select fv.clip_id, count(*) as favorite_count
        from favorites fv
        group by fv.clip_id
      ),
      matched as (
        select c.*, a.favorite_count
        from agg a
        join clips c on c.id = a.clip_id
        where c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and c.id <> '__general_thread__'
      )
      select
        m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
        m.creator_id, m.creator_name,
        0::bigint as likes, 0::bigint as dislikes, 0::bigint as comment_count, m.favorite_count, 0::bigint as stamp_count,
        count(*) over() as total_count
      from matched m
      order by m.favorite_count desc, m.view_count desc, m.id
      limit page_limit offset page_offset;
  elsif sort_by = 'reactions' then
    -- リアクションスタンプ数順（合計）。likes/favoritesと同じくclip_reaction_stamps（小さい）起点。
    return query
      with agg as (
        select rs.clip_id, count(*) as stamp_count
        from clip_reaction_stamps rs
        group by rs.clip_id
      ),
      matched as (
        select c.*, a.stamp_count
        from agg a
        join clips c on c.id = a.clip_id
        where c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and c.id <> '__general_thread__'
      )
      select
        m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
        m.creator_id, m.creator_name,
        0::bigint as likes, 0::bigint as dislikes, 0::bigint as comment_count, 0::bigint as favorite_count, m.stamp_count,
        count(*) over() as total_count
      from matched m
      order by m.stamp_count desc, m.view_count desc, m.id
      limit page_limit offset page_offset;
  elsif sort_by = 'newest' then
    -- 「全期間」（絞り込みなし）の正確なCOUNT(*)はclips全件を走査するため、
    -- pg_class.reltuples（統計情報ベースの概算値、O(1)）で代用する。
    -- 期間で絞り込んでいる場合は対象行数が少なく、正確なCOUNTでも安価なためそのまま数える。
    if v_unbounded then
      select reltuples::bigint into v_total from pg_class where oid = 'clips'::regclass;
    else
      select count(*) into v_total
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end;
    end if;

    -- ORDER BYの列をCASE式で包むと索引が使われなくなるため、newest/views は
    -- 生の列を直接ORDER BYする専用の分岐に分ける。NULLS LASTも索引の既定順（NULLS FIRST）と
    -- 食い違って索引が使えなくなるため付けない（twitch_created_atがnullのクリップはごく僅少）。
    return query
      select
        c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
        c.creator_id, c.creator_name,
        0::bigint as likes,
        0::bigint as dislikes,
        0::bigint as comment_count,
        0::bigint as favorite_count,
        0::bigint as stamp_count,
        v_total as total_count
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and c.id <> '__general_thread__'
      order by c.twitch_created_at desc, c.id
      limit page_limit offset page_offset;
  else
    if v_unbounded then
      select reltuples::bigint into v_total from pg_class where oid = 'clips'::regclass;
    else
      select count(*) into v_total
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end;
    end if;

    return query
      select
        c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
        c.creator_id, c.creator_name,
        0::bigint as likes,
        0::bigint as dislikes,
        0::bigint as comment_count,
        0::bigint as favorite_count,
        0::bigint as stamp_count,
        v_total as total_count
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and c.id <> '__general_thread__'
      order by c.view_count desc, c.id
      limit page_limit offset page_offset;
  end if;
end;
$$ language plpgsql;

-- クリップ名（タイトル）のあいまい検索。完全部分一致を優先し、次にpg_trgmの類似度で並べる。
-- 総合スレのダミー行は検索結果から除外する。
--
-- 実装メモ（本番実測で踏んだ罠、根本解決には至っていない既知の制約）:
-- 1. gin_trgm_ops索引はsimilarity()関数呼び出しでは使われず、`%`演算子でのみ索引が効く。
--    similarity(title,query)をそのままWHEREに書くと索引が使われず全件スキャンになる
--    （ORDER BYでの利用はLIMIT後の少数行にしか計算されないため問題ない）。
-- 2. 「釈迦」「号泣」のような2文字程度の短い日本語クエリは、実際のヒット件数が少数
--    （390,000件中100〜700件程度）でも、その2文字から作られるtrigram自体がありふれているため
--    索引・全件スキャンのどちらを選んでも本番実測で4〜14秒かかりうる（enable_seqscan=off
--    で索引利用を強制しても改善せず、むしろ悪化するケースもあった）。pg_trgmは英数字向けの
--    仕組みで、日本語の短い部分一致検索を高速化する決定的な方法が無いのが実情。
--    このRPC自体はシンプルな実装のままにし、フロント側（ClipRanking.jsx）で検索語の
--    最低文字数を必須にする・タイムアウト時にエラーメッセージを出す、で緩和している。
--    根本的に直すならPGroongaなど日本語対応の全文検索拡張の導入が必要（今回は未導入）。
create or replace function search_clips(query text, result_limit int default 30)
returns table(
  id text, title text, streamer text, game text, view_count integer,
  thumbnail_url text, twitch_created_at timestamptz, creator_id text, creator_name text
) as $$
  select id, title, streamer, game, view_count, thumbnail_url, twitch_created_at, creator_id, creator_name
  from clips
  where id <> '__general_thread__'
    and (title ilike '%' || query || '%' or title % query)
  order by
    (title ilike '%' || query || '%') desc,
    similarity(title, query) desc,
    view_count desc
  limit result_limit;
$$ language sql stable;

-- いまトレンドのクリップ（短期間で視聴回数が急激に伸びているクリップ）。
-- 視聴回数の時系列履歴を持っていないため、「作成からの経過時間あたりの視聴回数」を
-- 伸び方の代理指標として使う。作られたばかり（1時間未満）のクリップは母数が少なく
-- 数値が不安定になるため除外し、対象は直近lookback_hours時間以内に作られたクリップに絞る
-- （lookback_hoursの範囲はidx_clips_period_rankingの索引で絞り込めるので軽い）。
create or replace function get_trending_clips(clip_limit int default 5, lookback_hours int default 72)
returns table(
  id text, title text, streamer text, game text, view_count integer,
  thumbnail_url text, twitch_created_at timestamptz, creator_id text, creator_name text,
  views_per_hour numeric
) as $$
  select c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
    c.creator_id, c.creator_name,
    round(c.view_count / greatest(extract(epoch from (now() - c.twitch_created_at)) / 3600.0, 1), 1) as views_per_hour
  from clips c
  where c.twitch_created_at >= now() - make_interval(hours => lookback_hours)
    and c.twitch_created_at < now() - make_interval(hours => 1)
    and c.id <> '__general_thread__'
  order by views_per_hour desc
  limit clip_limit;
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
