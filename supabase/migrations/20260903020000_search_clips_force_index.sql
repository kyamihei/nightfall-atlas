-- NOTE: このマイグレーションは、trigram索引を強制するためsearch_clipsをSET LOCAL付きの
-- plpgsql関数として定義しようとしたが、stable関数内でSETは使えずエラーになった失敗版。
-- 直後の 20260903030000_search_clips_revert_to_simple.sql で元のシンプルな実装に戻している。
-- （db pushの適用順とマイグレーション履歴の整合性を保つため、内容を書き換えずそのまま残す）
create or replace function search_clips(query text, result_limit int default 30)
returns table(
  id text, title text, streamer text, game text, view_count integer,
  thumbnail_url text, twitch_created_at timestamptz, creator_id text, creator_name text
) as $$
begin
  set local enable_seqscan = off;
  return query
    select c.id, c.title, c.streamer, c.game, c.view_count, c.thumbnail_url, c.twitch_created_at,
      c.creator_id, c.creator_name
    from clips c
    where c.id <> '__general_thread__'
      and (c.title ilike '%' || query || '%' or c.title % query)
    order by
      (c.title ilike '%' || query || '%') desc,
      similarity(c.title, query) desc,
      c.view_count desc
    limit result_limit;
end;
$$ language plpgsql stable;
