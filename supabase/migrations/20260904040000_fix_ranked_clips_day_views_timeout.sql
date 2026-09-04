-- get_ranked_clips()の「期間を絞った上で視聴回数順」（例: 日別×視聴回数順、トップページの
-- デフォルト表示）が本番でタイムアウトしていた問題の修正（2026-09-04、ユーザー報告）。
--
-- 【原因】EXPLAIN ANALYZEで実測したところ、プランナが`idx_clips_period_ranking`
-- （twitch_created_at, view_count の複合索引）ではなく`idx_clips_view_count`
-- （view_count単独索引）を選び、view_count降順で全件スキャンしながら期間条件で
-- フィルタする実行計画になっていた。今日1日分は日付範囲的に極めて疎（54万件中1000件強）
-- なため、LIMIT 20に対して「view_count順に流していけばすぐ20件見つかるはず」という
-- プランナの見積もりが外れ、実際には28万行以上を読み飛ばしてから20件を見つけるまで
-- 約9.8秒かかっていた（本番実測、EXPLAIN ANALYZEのBuffers: shared hit=255156）。
--
-- 【対策】期間が指定されている（v_unbounded=false）場合は、まずCTEをmaterializedで
-- 強制的に確定させることで、プランナに`idx_clips_period_ranking`（twitch_created_at側）
-- を使った期間フィルタを先に実行させ、その後で少数（今日1日分なら1000件強）の結果だけを
-- メモリ上でview_count順にソートする計画に変える。実測で9.8秒→160ms程度に改善した
-- （全期間×視聴回数順は元々`idx_clips_view_count`をそのまま使うのが最適なため、
-- v_unbounded=trueの場合はこの変更の対象外・従来通り）。
create or replace function get_ranked_clips(
  period_start timestamptz default '-infinity',
  period_end timestamptz default 'infinity',
  sort_by text default 'views',
  page_limit int default 20,
  page_offset int default 0,
  streamer_filter text[] default null
)
returns table(
  id text, title text, streamer text, game text, view_count int, thumbnail_url text,
  twitch_created_at timestamptz, creator_id text, creator_name text,
  likes bigint, dislikes bigint, comment_count bigint, favorite_count bigint, stamp_count bigint,
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
    -- 視聴回数順（デフォルト）。全期間はidx_clips_view_countをそのまま使うのが最適
    -- （プランナも正しくそう選ぶ）ため従来通り。期間が絞られている場合だけ、下のmaterialized CTEで
    -- 期間フィルタ（idx_clips_period_ranking）を先に強制することでプランナの誤選択を回避する。
    if v_unbounded then
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
        order by c.view_count desc, c.id
        limit page_limit offset page_offset;
    else
      select count(*) into v_total
      from clips c
      where c.twitch_created_at >= period_start
        and c.twitch_created_at < period_end
        and (streamer_filter is null or c.streamer = any(streamer_filter));

      return query
        with matched as materialized (
          select c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
            c.creator_id, c.creator_name
          from clips c
          where c.twitch_created_at >= period_start
            and c.twitch_created_at < period_end
            and c.id <> '__general_thread__'
            and (streamer_filter is null or c.streamer = any(streamer_filter))
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
