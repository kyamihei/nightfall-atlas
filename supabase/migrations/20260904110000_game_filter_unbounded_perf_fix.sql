-- game_filterの性能修正（2026-09-04、本番実測で発覚）。
--
-- 前マイグレーション（20260904100000）でget_ranked_clips()にgame_filterを追加した際、
-- 「期間が絞られている場合と同じmaterialized CTEパターンを流用すればいい」と考えたが、
-- 実際にEXPLAIN ANALYZEで検証したところ、全期間×人気ゲーム（例: Grand Theft Auto V、
-- 12万9088件）の組み合わせで**11.2秒**かかることが判明した（匿名ロールの
-- statement_timeout 3秒を大幅に超過）。
--
-- 【原因】期間で絞る場合は対象行数が少数（例: 1日分で1000件強）に収まるためmaterialized CTEで
-- 先に確定させても軽いが、game_filterだけで絞ると対象が数万〜十数万件になりうる
-- （人気ゲームほど顕著）。materialized CTEはLIMITを見ずに対象行を（幅広い列を含めて）全件
-- 具体化してからソートするため、件数が多いと重くなる。
--
-- 【対策】全期間かつgame_filterのみ（streamer_filterは無くても可）が指定されている場合に限り、
-- materialized CTEを使わず「game, view_count」複合索引に直接乗せた通常のORDER BY + LIMIT
-- クエリにする。これによりプランナがインデックス順そのままLIMIT分だけ読んで打ち切れる
-- （実測: 11.2秒→8ms）。同様の理由でnewest（新着順）用にgame, twitch_created_at複合索引も
-- 追加する（そちらはmaterialized CTEを使っていないため元々問題なかったが、対応する索引が
-- 無いと同じ全表スキャン+ソートの遅さになるため）。
--
-- 単独のidx_clips_game（gameのみの索引）は、これらの複合索引の先頭列として代替されるため
-- （leftmost prefixルール）冗長になった。書き込みオーバーヘッド削減のため削除する。
--
-- 【意図的にスコープ外とした点】streamer_filterのみ（game_filterなし）で全期間を絞り込む
-- 既存のケース（マイタグ機能、2026-09-03）は、今回と全く同じ理論上のリスク（人気配信者を
-- 含むタグだと同様に遅くなりうる）を抱えているが、以下の理由で今回は対応しない:
-- 個人のタグは通常少数の配信者しか含まないため対象行数が現実的に小さく、実害が本番で
-- 確認されていない。streamer_filterは配列（ANY条件）のため単純な複合索引では今回のgame
-- ほど素直に解決できず、対応には別途の設計検討が必要。今回のユーザー要望（ゲームカテゴリ
-- 絞り込み）のスコープ外のため、既存の動作（materialized CTE、period_start/endが
-- -infinity/infinityでも通る）はそのまま維持する。将来的に配信者タグ機能で同様の
-- タイムアウトが実際に発生したら、同じ考え方（複合索引＋非materialized化）で対応すること。

drop index if exists idx_clips_game;
create index if not exists idx_clips_game_views on clips(game, view_count desc);
create index if not exists idx_clips_game_created on clips(game, twitch_created_at desc);

create or replace function get_ranked_clips(
  period_start timestamptz default '-infinity',
  period_end timestamptz default 'infinity',
  sort_by text default 'views',
  page_limit int default 20,
  page_offset int default 0,
  streamer_filter text[] default null,
  game_filter text default null
)
returns table(
  id text, title text, streamer text, game text, view_count int, thumbnail_url text,
  twitch_created_at timestamptz, creator_id text, creator_name text,
  likes bigint, dislikes bigint, comment_count bigint, favorite_count bigint, stamp_count bigint,
  total_count bigint
) as $$
declare
  v_total bigint;
  v_unbounded boolean := period_start = '-infinity'::timestamptz and period_end = 'infinity'::timestamptz
    and streamer_filter is null and game_filter is null;
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
        and (streamer_filter is null or c.streamer = any(streamer_filter))
        and (game_filter is null or c.game = game_filter);
    end if;

    -- newestはもともとmaterialized CTEを使わない直接クエリのため、game_filter付きでも
    -- idx_clips_game_createdにそのまま乗る（追加対応不要）。
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
  else
    -- 視聴回数順（デフォルト）。
    -- ①絞り込みが一切無い全期間: idx_clips_view_countをそのまま使う従来通りの高速パス。
    -- ②全期間だがgame_filterあり: materialized CTEだと対象行数が多い人気ゲームで
    --   遅くなる（本番実測11.2秒）ため、idx_clips_game_views(game, view_count desc)に
    --   そのまま乗る直接クエリにする（実測8ms）。
    -- ③期間が絞られている場合: 既存のmaterialized CTE（period-first、
    --   idx_clips_period_ranking使用）。対象行数が期間で既に少数に絞られているため、
    --   game_filter/streamer_filterは残り件数への単純な追加条件として評価されるだけで済む。
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
