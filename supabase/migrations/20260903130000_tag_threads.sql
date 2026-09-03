-- タグに関するユーザー投稿型のスレ機能（2026-09-03追加）。
-- 「ZETAというタグを付けたら、それについて話すスレを立てたい」という要望への対応。
-- 総合スレ（__general_thread__のダミー行をclipsに挿入してcommentsテーブルを再利用する方式）とは
-- あえて違う設計にした。スレのidは動的に増え続けるため、その方式だとget_ranked_clips等の
-- 集計RPC・マテリアライズドビュー全てから都度除外し続ける必要があり影響範囲が大きすぎる。
-- 完全に独立した専用テーブルにすることで、クリップのランキング/トレンド集計に一切触れずに済む。
--
-- 書き込み（スレ作成・コメント投稿）はテーブルへの直接INSERTを許可せず、
-- 必ずsecurity definerのRPC経由にすることで、レート制限・重複タイトル防止をDB側で確実に効かせる
-- （NGワード検査は今回省略。contact_messagesと同じ「まずはレート制限のみ」という扱い）。

create table if not exists tag_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 40),
  creator_anon_id uuid not null,
  created_at timestamptz default now()
);
create unique index if not exists idx_tag_threads_title_lower on tag_threads (lower(title));

create table if not exists tag_thread_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references tag_threads(id) on delete cascade,
  anon_id uuid not null,
  display_name text default '名無しの視聴者',
  body text not null check (char_length(body) <= 280),
  is_hidden boolean default false,
  report_count integer default 0,
  parent_id uuid references tag_thread_comments(id) on delete cascade,
  created_at timestamptz default now()
);
create index if not exists idx_tag_thread_comments_thread on tag_thread_comments(thread_id, created_at);

alter table tag_threads enable row level security;
alter table tag_thread_comments enable row level security;

drop policy if exists "tag_threads_public_read" on tag_threads;
create policy "tag_threads_public_read" on tag_threads
  for select using (true);

drop policy if exists "tag_thread_comments_public_read" on tag_thread_comments;
create policy "tag_thread_comments_public_read" on tag_thread_comments
  for select using (is_hidden = false);

-- realtimeで新着コメントをその場で反映させる（clip単位のコメントと同じ理由）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tag_thread_comments'
  ) then
    alter publication supabase_realtime add table tag_thread_comments;
  end if;
end $$;

-- スレを取得、無ければ作成する（タイトルの大文字小文字・全半角は区別しない、lower(title)で一意）。
-- 直近60秒以内に自分が新規スレを作成済みなら拒否する（スレ立てスパム防止）。
drop function if exists get_or_create_tag_thread(text);
create or replace function get_or_create_tag_thread(thread_title text)
returns table(id uuid, title text, created_at timestamptz, is_new boolean) as $$
declare
  v_uid uuid := auth.uid();
  v_trimmed text := trim(thread_title);
  v_existing tag_threads%rowtype;
  v_new_id uuid;
  v_recent_count int;
begin
  if v_uid is null then
    raise exception '認証が必要です';
  end if;
  if v_trimmed = '' or char_length(v_trimmed) > 40 then
    raise exception 'スレタイトルは1〜40文字で入力してください';
  end if;

  select * into v_existing from tag_threads t where lower(t.title) = lower(v_trimmed) limit 1;
  if found then
    return query select v_existing.id, v_existing.title, v_existing.created_at, false;
    return;
  end if;

  select count(*) into v_recent_count
  from tag_threads t
  where t.creator_anon_id = v_uid and t.created_at >= now() - interval '60 seconds';
  if v_recent_count > 0 then
    raise exception '連続してスレを作成することはできません。しばらく待ってからお試しください';
  end if;

  v_new_id := gen_random_uuid();
  insert into tag_threads (id, title, creator_anon_id) values (v_new_id, v_trimmed, v_uid);
  return query select v_new_id, v_trimmed, now(), true;
end;
$$ language plpgsql security definer;

-- スレ一覧（コメント数つき、新しい順）
create or replace function get_tag_threads()
returns table(id uuid, title text, created_at timestamptz, comment_count bigint) as $$
  select t.id, t.title, t.created_at, count(c.id) as comment_count
  from tag_threads t
  left join tag_thread_comments c on c.thread_id = t.id and c.is_hidden = false
  group by t.id, t.title, t.created_at
  order by t.created_at desc;
$$ language sql stable;

-- コメント投稿。返信は1階層のみ（clipのcommentsと同じ仕様）。直近15秒以内の連続投稿は拒否する。
drop function if exists post_tag_thread_comment(uuid, text, text, uuid);
create or replace function post_tag_thread_comment(
  p_thread_id uuid,
  p_body text,
  p_display_name text default null,
  p_parent_id uuid default null
)
returns table(id uuid, display_name text, body text, created_at timestamptz, parent_id uuid) as $$
declare
  v_uid uuid := auth.uid();
  v_body text := trim(p_body);
  v_name text := coalesce(nullif(trim(p_display_name), ''), '名無しの視聴者');
  v_parent tag_thread_comments%rowtype;
  v_recent timestamptz;
  v_new_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception '認証が必要です';
  end if;
  if v_body = '' or char_length(v_body) > 280 then
    raise exception 'コメントは1〜280文字で入力してください';
  end if;
  if not exists (select 1 from tag_threads t where t.id = p_thread_id) then
    raise exception '対象のスレが見つかりません';
  end if;

  if p_parent_id is not null then
    select * into v_parent from tag_thread_comments c where c.id = p_parent_id;
    if not found or v_parent.thread_id <> p_thread_id then
      raise exception '返信先のコメントが見つかりません';
    end if;
    if v_parent.parent_id is not null then
      raise exception '返信への返信はできません';
    end if;
  end if;

  select c.created_at into v_recent
  from tag_thread_comments c
  where c.thread_id = p_thread_id and c.anon_id = v_uid
  order by c.created_at desc
  limit 1;
  if v_recent is not null and v_recent >= now() - interval '15 seconds' then
    raise exception '連続投稿はできません。少し待ってからお試しください';
  end if;

  insert into tag_thread_comments (id, thread_id, anon_id, display_name, body, parent_id)
  values (v_new_id, p_thread_id, v_uid, left(v_name, 20), v_body, p_parent_id);

  return query select v_new_id, left(v_name, 20)::text, v_body, now(), p_parent_id;
end;
$$ language plpgsql security definer;
