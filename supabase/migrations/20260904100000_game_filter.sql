-- ゲームカテゴリでのクリップ絞り込み機能（2026-09-04追加）。
-- 「ゲームカテゴリごとのクリップ一覧を見られるようにしたい。今流行っているゲームだけを見る、
-- みたいな」という要望への対応。既存の配信者タグ絞り込み（streamer_filter）と全く同じパターンで
-- game_filterを追加する（クエリプランナの実行計画がstreamer_filter/period絞り込みで
-- 何度もタイムアウトを起こしてきた経緯があるため、実績のある構造をそのまま踏襲する）。

-- 1. clips.gameへの索引（idx_clips_streamerと同じ役割）。これが無いとgame_filter付きの
--    全期間クエリ（materialized CTE内のフィルタ）でclips全件スキャンになりタイムアウトの恐れがある。
create index if not exists idx_clips_game on clips(game);

-- 2. ゲームごとの集計（ドロップダウンの選択肢に使う。人気順に並べることで「今何が流行っているか」
--    が一目でわかるようにする）。管理画面ダッシュボードの他の集計と同じ理由で、clips全体への
--    live集計（group by）はタイムアウトの恐れがあるためmaterialized viewにする。
--    「不明」（Twitch側でカテゴリ名が解決できなかった場合のフォールバック値）は選択肢として
--    意味がないため除外する。
drop materialized view if exists top_games_mv;
create materialized view top_games_mv as
  select game, count(*) as clip_count, sum(view_count) as total_views
  from clips
  where id <> '__general_thread__' and game is not null and game <> '不明'
  group by game;

create unique index if not exists idx_top_games_mv_game on top_games_mv(game);
create index if not exists idx_top_games_mv_views on top_games_mv(total_views desc);

create or replace function get_top_games(games_limit int default 50)
returns table(game text, clip_count bigint, total_views bigint) as $$
  select game, clip_count, total_views
  from top_games_mv
  order by total_views desc
  limit games_limit;
$$ language sql stable;

-- 3. refresh_ranking_views()にtop_games_mvの更新を追加。
create or replace function refresh_ranking_views()
returns void as $$
begin
  refresh materialized view concurrently top_broadcasters_mv;
  refresh materialized view concurrently top_clippers_mv;
  refresh materialized view concurrently top_clippers_this_year_mv;
  refresh materialized view concurrently top_clippers_this_month_mv;
  refresh materialized view concurrently admin_dashboard_clip_stats_mv;
  refresh materialized view concurrently top_games_mv;
end;
$$ language plpgsql security definer;

revoke execute on function refresh_ranking_views() from public;
grant execute on function refresh_ranking_views() to service_role;

-- 初回埋め込み（以降はrefresh_ranking_views()経由）。
refresh materialized view top_games_mv;

-- 4. get_ranked_clips()にgame_filterを追加。引数の数が変わる（6→7）ため、
--    PostgRESTのオーバーロード解決を混乱させないよう先に旧シグネチャをdropする
--    （このプロジェクトで過去に複数回踏んでいる既知の落とし穴）。
drop function if exists get_ranked_clips(timestamptz, timestamptz, text, int, int, text[]);
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
    -- 視聴回数順（デフォルト）。絞り込みが一切無い全期間はidx_clips_view_countをそのまま使うのが
    -- 最適（プランナも正しくそう選ぶ）ため従来通り。期間・配信者・ゲームのいずれかで絞り込まれて
    -- いる場合は、下のmaterialized CTEで先にフィルタ（idx_clips_period_ranking/idx_clips_streamer/
    -- idx_clips_gameのいずれか適切な索引）を強制することでプランナの誤選択を回避する
    -- （streamer_filterで実績のある対策をgame_filterにもそのまま適用）。
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
