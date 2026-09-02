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

create index if not exists idx_clips_period_ranking
  on clips(twitch_created_at desc, view_count desc);

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

-- 人気配信者一覧
-- クリップの合計視聴回数が多い順に配信者を返す。配信者一覧ページ用にoffsetでのページネーション、
-- tracked_broadcastersとのLEFT JOINで所属グループタグ・アイコン画像URLも一緒に返す。
-- 戻り値の列構成が変わるため、create or replaceの前にdropしておく（Postgresの制約）。
drop function if exists get_top_broadcasters(int);
drop function if exists get_top_broadcasters(int, int);
create or replace function get_top_broadcasters(broadcaster_limit int default 20, broadcaster_offset int default 0)
returns table(streamer text, total_views bigint, clip_count bigint, tag text, profile_image_url text) as $$
  select c.streamer,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tb.tag) as tag,
    max(tb.profile_image_url) as profile_image_url
  from clips c
  left join tracked_broadcasters tb on tb.broadcaster_name = c.streamer
  group by c.streamer
  order by total_views desc
  limit broadcaster_limit offset broadcaster_offset;
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
-- 3. likes/comments（いいね順・コメント数順）は集計が必須で、期間を絞らない「全期間」指定時は
--    clips全件（数十万行）に対する集計・ソートが発生し得るため、匿名ロール(anon)のデフォルト
--    statement_timeout=3sでは不足する場合がある。この分岐に限り、呼び出しをまたがない
--    トランザクションローカルな設定でタイムアウトを緩和する。
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
  likes bigint,
  dislikes bigint,
  comment_count bigint,
  total_count bigint
) as $$
declare
  v_total bigint;
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
      )
      select
        m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
        m.likes, m.dislikes, 0::bigint as comment_count,
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
      )
      select
        m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
        0::bigint as likes, 0::bigint as dislikes, m.comment_count,
        count(*) over() as total_count
      from matched m
      order by m.comment_count desc, m.view_count desc, m.id
      limit page_limit offset page_offset;
  elsif sort_by = 'newest' then
    select count(*) into v_total
    from clips c
    where c.twitch_created_at >= period_start
      and c.twitch_created_at < period_end;

    -- ORDER BYの列をCASE式で包むと索引が使われなくなるため、newest/views は
    -- 生の列を直接ORDER BYする専用の分岐に分ける。NULLS LASTも索引の既定順（NULLS FIRST）と
    -- 食い違って索引が使えなくなるため付けない（twitch_created_atがnullのクリップはごく僅少）。
    return query
      select
        c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
        0::bigint as likes,
        0::bigint as dislikes,
        0::bigint as comment_count,
        v_total as total_count
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
      order by c.twitch_created_at desc, c.id
      limit page_limit offset page_offset;
  else
    select count(*) into v_total
    from clips c
    where c.twitch_created_at >= period_start
      and c.twitch_created_at < period_end;

    return query
      select
        c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
        0::bigint as likes,
        0::bigint as dislikes,
        0::bigint as comment_count,
        v_total as total_count
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
      order by c.view_count desc, c.id
      limit page_limit offset page_offset;
  end if;
end;
$$ language plpgsql;

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
