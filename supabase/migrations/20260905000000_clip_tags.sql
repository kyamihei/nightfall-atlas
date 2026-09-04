-- クリップタグ機能（2026-09-05追加）。
--
-- 「ワイプ芸」のような、配信者・ゲームを問わず複数のクリップに共通する特徴を、
-- 誰でも自由に付けられる公開タグ。付けたタグでクリップ一覧を横断的に絞り込める。
--
-- 設計方針（詳細は計画ファイル・CLAUDE.md参照）:
-- - clip_reaction_stamps と同じ「複数の匿名ユーザーがそれぞれ独立に同じ値を付けられる」設計
--   （unique(clip_id, anon_id, tag)。clip_id+tagだけを一意にしないのは、付けた人数を
--   そのまま人気度として使うため）。
-- - 書き込みは tag_threads と同じ「security definer の RPC 経由のみ」（レート制限をDB側で
--   強制するため、直接INSERT/DELETEポリシーは用意しない）。
-- - NGワードチェックは tag_thread_comments と同じ理由（自由記述だがコメントよりずっと
--   短いラベルのため）で今回は省略し、レート制限のみで対応する。荒らし対策の保険として
--   is_hidden による管理画面からの非表示切り替えを用意する（comment_reports と同じ発想、
--   ハード削除はしない）。
-- - 表記ゆれ（「ワイプ芸」/「わいぷ芸」）で別タグに分裂する既知の制約はあえて許容する
--   （フィルター・追加UIの両方を「既存タグから選ぶ」形にして実害を抑える）。

create table if not exists clip_tags (
  id uuid primary key default gen_random_uuid(),
  clip_id text not null references clips(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 15),
  anon_id uuid not null,
  is_hidden boolean default false,
  created_at timestamptz default now(),
  unique (clip_id, anon_id, tag)
);

create index if not exists idx_clip_tags_clip on clip_tags(clip_id);
-- get_ranked_clipsのtag_filter（EXISTS副問い合わせ）用。tag側から絞り込むため(tag, clip_id)の順。
create index if not exists idx_clip_tags_tag on clip_tags(tag, clip_id);

alter table clip_tags enable row level security;

-- 公開閲覧のみ許可（非表示にされた行は除く）。書き込みポリシーは用意しない
-- （tag_threads/tag_thread_commentsと同じ「RPC経由のみ」方式、直接INSERT/DELETEは拒否される）。
drop policy if exists "clip_tags_public_read" on clip_tags;
create policy "clip_tags_public_read" on clip_tags
  for select using (is_hidden = false);

-- クリップにタグを付ける/外す（トグル）。
-- 既に自分がそのクリップにそのタグを付けていれば削除して added=false を返す（レート制限なし、
-- 取り消しはいつでも可能）。付けていなければ、直近15秒以内に自分がclip_tagsへ書き込んでいないか
-- チェックしてから挿入し、added=true を返す（tag_thread_commentsの15秒レート制限と同じ考え方）。
--
-- returns table(tag text, ...) と本体内のテーブル列名が衝突するため、tag_threadsで踏んだ
-- 「列参照が曖昧」バグ（CLAUDE.md参照）を避けるべく、テーブル参照には必ずエイリアスを付ける。
drop function if exists toggle_clip_tag(text, text);
create or replace function toggle_clip_tag(p_clip_id text, p_tag text)
returns table(tag text, added boolean) as $$
declare
  v_uid uuid := auth.uid();
  -- 前後の空白をtrimし、連続する空白は1つに圧縮する
  v_tag text := regexp_replace(trim(p_tag), '\s+', ' ', 'g');
  v_existing_id uuid;
begin
  if v_uid is null then
    raise exception '認証が必要です';
  end if;
  if v_tag = '' or char_length(v_tag) > 15 then
    raise exception 'タグは1〜15文字で入力してください';
  end if;
  if not exists (select 1 from clips c where c.id = p_clip_id) then
    raise exception '対象のクリップが見つかりません';
  end if;

  select ct.id into v_existing_id
  from clip_tags ct
  where ct.clip_id = p_clip_id and ct.anon_id = v_uid and ct.tag = v_tag;

  if v_existing_id is not null then
    delete from clip_tags where id = v_existing_id;
    return query select v_tag, false;
    return;
  end if;

  if exists (
    select 1 from clip_tags ct
    where ct.anon_id = v_uid and ct.created_at >= now() - interval '15 seconds'
  ) then
    raise exception '連続してタグを付けることはできません。少し待ってからお試しください';
  end if;

  insert into clip_tags (clip_id, tag, anon_id) values (p_clip_id, v_tag, v_uid);
  return query select v_tag, true;
end;
$$ language plpgsql security definer;

-- クリップIDの配列を渡すと、それぞれのタグごとの件数をまとめて返す（get_stamp_countsと同型）。
create or replace function get_clip_tag_counts(clip_ids text[])
returns table(clip_id text, tag text, tag_count bigint) as $$
  select clip_id, tag, count(*) as tag_count
  from clip_tags
  where clip_id = any(clip_ids) and is_hidden = false
  group by clip_id, tag;
$$ language sql stable;

-- 人気タグ一覧（フィルターの選択肢・タグ追加ポップアップの候補用）。clip_tagsは
-- ゲームカテゴリ（3,080種類）ほど多くならない想定のためlive集計で十分。実際に遅くなったら
-- top_games_mvと同じ考え方で事前集計に切り替える（CLAUDE.mdの「まず実測」方針）。
create or replace function get_top_clip_tags(p_limit int default 60)
returns table(tag text, clip_count bigint) as $$
  select tag, count(distinct clip_id) as clip_count
  from clip_tags
  where is_hidden = false
  group by tag
  order by clip_count desc, tag
  limit p_limit;
$$ language sql stable;

-- get_ranked_clipsにtag_filterを追加（streamer_filter/game_filterと同じ拡張パターン）。
-- 旧シグネチャ（7引数）を明示的にdropしてから、末尾にtag_filterを加えた8引数で再作成する。
drop function if exists get_ranked_clips(timestamptz, timestamptz, text, int, int, text[], text);
create or replace function get_ranked_clips(
  period_start timestamptz default '-infinity',
  period_end timestamptz default 'infinity',
  sort_by text default 'views',
  page_limit int default 20,
  page_offset int default 0,
  streamer_filter text[] default null,
  game_filter text default null,
  tag_filter text default null
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
  v_unbounded boolean := period_start = '-infinity'::timestamptz and period_end = 'infinity'::timestamptz
    and streamer_filter is null and game_filter is null and tag_filter is null;
  v_period_unbounded boolean := period_start = '-infinity'::timestamptz and period_end = 'infinity'::timestamptz;
begin
  if sort_by = 'likes' then
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
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
          and (tag_filter is null or exists (
            select 1 from clip_tags ct where ct.clip_id = c.id and ct.tag = tag_filter and ct.is_hidden = false
          ))
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
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
          and (tag_filter is null or exists (
            select 1 from clip_tags ct where ct.clip_id = c.id and ct.tag = tag_filter and ct.is_hidden = false
          ))
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
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
          and (tag_filter is null or exists (
            select 1 from clip_tags ct where ct.clip_id = c.id and ct.tag = tag_filter and ct.is_hidden = false
          ))
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
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
          and (tag_filter is null or exists (
            select 1 from clip_tags ct where ct.clip_id = c.id and ct.tag = tag_filter and ct.is_hidden = false
          ))
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
    if tag_filter is not null then
      -- tag_filterは（実測で判明）unbounded期間でEXISTS越しにclips全件を評価すると
      -- 匿名ロールのタイムアウトを超える（game_filter未対策時と同じ原因）。
      -- clip_tags側（tagに索引あり、通常clips全体よりずっと小さい）を起点にJOINすることで回避する。
      -- 1クリップに複数人が同じタグを付けうる（unique(clip_id, anon_id, tag)）ため、
      -- 先にgroup byでclip_idを一意にしてからclipsへJOINする（重複行防止）。
      with tagged as (
        select ct.clip_id from clip_tags ct where ct.tag = tag_filter and ct.is_hidden = false
        group by ct.clip_id
      )
      select count(*) into v_total
      from tagged t
      join clips c on c.id = t.clip_id
      where c.id <> '__general_thread__'
        and c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and (streamer_filter is null or c.streamer = any(streamer_filter))
        and (game_filter is null or c.game = game_filter);

      return query
        with tagged as (
          select ct.clip_id from clip_tags ct where ct.tag = tag_filter and ct.is_hidden = false
          group by ct.clip_id
        )
        select
          c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
          c.creator_id, c.creator_name,
          0::bigint as likes,
          0::bigint as dislikes,
          0::bigint as comment_count,
          0::bigint as favorite_count,
          0::bigint as stamp_count,
          v_total as total_count
        from tagged t
        join clips c on c.id = t.clip_id
        where c.id <> '__general_thread__'
          and c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
        order by c.twitch_created_at desc, c.id
        limit page_limit offset page_offset;
    else
      if v_unbounded then
        select reltuples::bigint into v_total from pg_class where oid = 'clips'::regclass;
      else
        select count(*) into v_total
        from clips c
        where c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter);
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
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
        order by c.twitch_created_at desc, c.id
        limit page_limit offset page_offset;
    end if;
  else
    -- 視聴回数順（デフォルト）。
    if tag_filter is not null then
      -- newest分岐と同じ理由（実測で判明、game_filter未対策時と同じ原因）で、tag_filterが
      -- 指定されている場合はclip_tags側を起点にJOINする専用パスにする（streamer_filter/
      -- game_filterはこの小さな結果集合への追加条件として評価されるだけなので軽い）。
      with tagged as (
        select ct.clip_id from clip_tags ct where ct.tag = tag_filter and ct.is_hidden = false
        group by ct.clip_id
      )
      select count(*) into v_total
      from tagged t
      join clips c on c.id = t.clip_id
      where c.id <> '__general_thread__'
        and c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and (streamer_filter is null or c.streamer = any(streamer_filter))
        and (game_filter is null or c.game = game_filter);

      return query
        with tagged as (
          select ct.clip_id from clip_tags ct where ct.tag = tag_filter and ct.is_hidden = false
          group by ct.clip_id
        )
        select
          c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
          c.creator_id, c.creator_name,
          0::bigint as likes,
          0::bigint as dislikes,
          0::bigint as comment_count,
          0::bigint as favorite_count,
          0::bigint as stamp_count,
          v_total as total_count
        from tagged t
        join clips c on c.id = t.clip_id
        where c.id <> '__general_thread__'
          and c.twitch_created_at >= period_start
          and c.twitch_created_at < period_end
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
        order by c.view_count desc, c.id
        limit page_limit offset page_offset;
    elsif v_unbounded then
      select reltuples::bigint into v_total from pg_class where oid = 'clips'::regclass;

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
        where c.id <> '__general_thread__'
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and (game_filter is null or c.game = game_filter)
        order by c.view_count desc, c.id
        limit page_limit offset page_offset;
    elsif v_period_unbounded and game_filter is not null then
      select count(*) into v_total
      from clips c
      where c.id <> '__general_thread__'
        and (streamer_filter is null or c.streamer = any(streamer_filter))
        and c.game = game_filter;

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
        where c.id <> '__general_thread__'
          and (streamer_filter is null or c.streamer = any(streamer_filter))
          and c.game = game_filter
        order by c.view_count desc, c.id
        limit page_limit offset page_offset;
    else
      select count(*) into v_total
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and (streamer_filter is null or c.streamer = any(streamer_filter))
        and (game_filter is null or c.game = game_filter);

      return query
        with matched as materialized (
          select c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
            c.creator_id, c.creator_name
          from clips c
          where c.twitch_created_at >= period_start
            and c.twitch_created_at < period_end
            and c.id <> '__general_thread__'
            and (streamer_filter is null or c.streamer = any(streamer_filter))
            and (game_filter is null or c.game = game_filter)
        )
        select
          m.id, m.title, m.streamer, m.game, m.view_count, m.thumbnail_url, m.twitch_created_at,
          m.creator_id, m.creator_name,
          0::bigint as likes,
          0::bigint as dislikes,
          0::bigint as comment_count,
          0::bigint as favorite_count,
          0::bigint as stamp_count,
          v_total as total_count
        from matched m
        order by m.view_count desc, m.id
        limit page_limit offset page_offset;
    end if;
  end if;
end;
$$ language plpgsql;

-- 管理画面: 最近付けられたクリップタグの一覧・非表示切り替え（comment_reportsと同じhide-toggle方式、
-- 削除ではなく非表示にするだけ。admin_check_passwordは既存の管理画面パスワード照合ヘルパー）。
create or replace function admin_get_recent_clip_tags(p_password text)
returns table(
  id uuid, clip_id text, clip_title text, tag text, anon_id uuid,
  is_hidden boolean, created_at timestamptz
) as $$
begin
  perform admin_check_password(p_password);
  return query
    select ct.id, ct.clip_id, cl.title, ct.tag, ct.anon_id, ct.is_hidden, ct.created_at
    from clip_tags ct
    left join clips cl on cl.id = ct.clip_id
    order by ct.created_at desc
    limit 200;
end;
$$ language plpgsql security definer;

create or replace function admin_set_clip_tag_hidden(p_password text, p_id uuid, p_hidden boolean)
returns void as $$
begin
  perform admin_check_password(p_password);
  update clip_tags set is_hidden = p_hidden where id = p_id;
end;
$$ language plpgsql security definer;
