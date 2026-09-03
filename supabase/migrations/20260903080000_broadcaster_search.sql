-- 配信者一覧ページ（/broadcasters）の検索が、実際にはDBを検索せず「今読み込んでいる
-- 1ページ分（30件）」だけをクライアント側でフィルタしていたバグの修正。
-- top_broadcasters_mvは合計視聴回数順に並んでおり、有名配信者でもクリップ単価（1本あたりの
-- 視聴回数）が低いジャンルだと合計視聴回数の上位30件に入らないことがあるため、
-- 実際にはクリップが1,000件以上あるのに検索すると「見つかりませんでした」と誤表示されていた
-- （本番実測で確認: 布団ちゃんと申します=121位/ゆゆうた押忍=82位、ページサイズ30件のため
-- どちらも1ページ目には出てこない）。
--
-- get_top_broadcastersにsearch_query引数（配信者名のあいまい検索、省略時は従来どおり全件）を
-- 追加し、DB側で絞り込んでから返すようにする。RETURNS TABLEの列を変えていなくても、
-- 引数の個数が変わるシグネチャ変更なので、先に旧シグネチャをdropしてから作り直す
-- （dropを忘れると2引数版/3引数版が共存してPostgRESTが呼び分けられなくなる。
-- get_top_clippers_by_periodで実際に踏んだのと同じ罠、CLAUDE.md参照）。
drop function if exists get_top_broadcasters(int, int);

create or replace function get_top_broadcasters(
  broadcaster_limit int default 20,
  broadcaster_offset int default 0,
  search_query text default null
)
returns table(streamer text, total_views bigint, clip_count bigint, tag text, profile_image_url text) as $$
  select streamer, total_views, clip_count, tag, profile_image_url
  from top_broadcasters_mv
  where search_query is null or streamer ilike '%' || search_query || '%'
  order by total_views desc
  limit broadcaster_limit offset broadcaster_offset;
$$ language sql stable;
