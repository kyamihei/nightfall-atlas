-- 配信者への個人タグ付け機能。
-- 目的: 「お気に入りの配信者だけ見たい」「いまやってるイベントの参加者だけ見たい」等、
-- ユーザーが自分の好きなラベルで配信者をグルーピングし、クリップランキングを絞り込めるようにする。
-- tracked_broadcasters.tag（運営が手動設定する公開タグ）とは別物。こちらは完全に個人用（非公開）で、
-- 同じユーザーが同じ配信者に複数タグを付けられる（clip_id+anon_id+stampと同じ発想でunique制約）。
create table if not exists broadcaster_tags (
  id uuid primary key default gen_random_uuid(),
  anon_id uuid not null,
  streamer text not null,
  tag text not null check (char_length(tag) between 1 and 20),
  created_at timestamptz default now(),
  unique (anon_id, streamer, tag)
);

create index if not exists idx_broadcaster_tags_anon on broadcaster_tags(anon_id);
create index if not exists idx_broadcaster_tags_anon_tag on broadcaster_tags(anon_id, tag);

alter table broadcaster_tags enable row level security;

-- 完全に個人用のデータなので、閲覧・追加・削除すべて本人のみ（公開readにしない）
drop policy if exists "broadcaster_tags_select_own" on broadcaster_tags;
create policy "broadcaster_tags_select_own" on broadcaster_tags
  for select using (anon_id = auth.uid());

drop policy if exists "broadcaster_tags_insert_own" on broadcaster_tags;
create policy "broadcaster_tags_insert_own" on broadcaster_tags
  for insert with check (anon_id = auth.uid());

drop policy if exists "broadcaster_tags_delete_own" on broadcaster_tags;
create policy "broadcaster_tags_delete_own" on broadcaster_tags
  for delete using (anon_id = auth.uid());

-- get_ranked_clipsのstreamer_filterで `c.streamer = any(...)` を使うため、索引が無いと
-- タグ絞り込み時（特に「全期間」等スキャン範囲が広い場合）にstatement_timeoutを超える恐れがある。
create index if not exists idx_clips_streamer on clips(streamer);

-- get_ranked_clipsにstreamer_filter引数（配信者名の配列、省略時は絞り込みなし）を追加。
-- 引数の個数が変わるシグネチャ変更なので、先に旧シグネチャをdropしてから作り直す
-- （dropを忘れると新旧シグネチャが共存してPostgRESTが呼び分けられなくなる。過去に
-- get_top_clippers_by_periodで実際に踏んだ罠、CLAUDE.md参照）。
drop function if exists get_ranked_clips(timestamptz, timestamptz, text, int, int);
create or replace function get_ranked_clips(
  period_start timestamptz default '-infinity',
  period_end timestamptz default 'infinity',
  sort_by text default 'views',
  page_limit int default 20,
  page_offset int default 0,
  streamer_filter text[] default null
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
  v_unbounded boolean := period_start = '-infinity'::timestamptz and period_end = 'infinity'::timestamptz and streamer_filter is null;
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
    if v_unbounded then
      select reltuples::bigint into v_total from pg_class where oid = 'clips'::regclass;
    else
      select count(*) into v_total
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and (streamer_filter is null or c.streamer = any(streamer_filter));
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
        and (streamer_filter is null or c.streamer = any(streamer_filter));
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
      order by c.view_count desc, c.id
      limit page_limit offset page_offset;
  end if;
end;
$$ language plpgsql;
