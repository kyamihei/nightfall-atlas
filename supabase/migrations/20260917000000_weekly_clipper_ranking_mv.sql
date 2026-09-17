-- 週間クリップ職人ランキング（トップページ`WeeklyClipperBoard`）が本番でほぼ表示されない不具合の修正
-- （2026-09-17、ユーザー報告「取得失敗するのか表示されないことが多い」）。
--
-- 原因: get_top_clippers_by_period（ライブ集計、「数千件規模なら軽い」という前提で導入）が、
-- 追跡配信者数の急増（1,900件→8,634件）に伴う日次新規クリップの急増（実測38,724件/日）により、
-- 直近7日分だけで36,059件をJOIN・集計する規模になっていた。EXPLAIN ANALYZEで実測したところ
-- 実行計画がMerge Left Join+Sortに切り替わり約9.7秒かかっており、anon/authenticatedロールの
-- statement_timeout（3秒/8秒）を大きく超えて毎回のようにタイムアウトしていた
-- （フロント側useTopClippersByPeriodがエラーを握りつぶして空配列のままloading=falseにするため、
-- WeeklyClipperBoardは「取得失敗した」旨の表示すら出さずnullを返して消える）。
-- 同じ関数の24時間版（ActivityTickerの「急上昇中のクリップ職人」）は対象行数が少なく
-- （実測4,850件、531ms）実行計画も軽量なため今回は対象外。
--
-- 「クリップ職人ランキング」節で年間/月間ランキングに適用したのと同じ解決策
-- （事前集計マテリアライズドビュー化）を週間にも適用する。7日間の範囲はリフレッシュのたびに
-- 再評価される（now()基準）ため、既存の年間/月間MVと同じく日次〜1時間おきのリフレッシュが
-- 走っている限り自動的にスライドする。
drop materialized view if exists top_clippers_weekly_mv;
create materialized view top_clippers_weekly_mv as
  select c.creator_id,
    max(c.creator_name) as creator_name,
    sum(c.view_count) as total_views,
    count(*) as clip_count,
    max(tc.profile_image_url) as profile_image_url
  from clips c
  left join tracked_clippers tc on tc.creator_id = c.creator_id
  where c.creator_id is not null
    and c.twitch_created_at >= now() - interval '7 days'
  group by c.creator_id;

-- REFRESH ... CONCURRENTLYには一意索引が必須（既存の年間/月間MVと同じパターン）。
create unique index if not exists idx_top_clippers_weekly_mv_creator on top_clippers_weekly_mv(creator_id);
create index if not exists idx_top_clippers_weekly_mv_views on top_clippers_weekly_mv(total_views desc);

-- 初回はまだ空のため手動で1度埋める（以降はrefresh_ranking_view経由で更新される）。
refresh materialized view top_clippers_weekly_mv;

create or replace function get_top_clippers_this_week(clipper_limit int default 10, clipper_offset int default 0)
returns table(creator_id text, creator_name text, total_views bigint, clip_count bigint, profile_image_url text) as $$
  select creator_id, creator_name, total_views, clip_count, profile_image_url
  from top_clippers_weekly_mv
  order by total_views desc
  limit clipper_limit offset clipper_offset;
$$ language sql stable;

-- refresh_ranking_view(text)の許可リストに追加（アプリ側はこの個別RPCループで更新する、
-- 20260914010000_granular_ranking_view_refresh.sql参照）。
create or replace function refresh_ranking_view(p_view text)
returns void as $$
begin
  if p_view not in (
    'top_broadcasters_mv',
    'top_clippers_mv',
    'top_clippers_this_year_mv',
    'top_clippers_this_month_mv',
    'top_clippers_weekly_mv',
    'admin_dashboard_clip_stats_mv',
    'top_games_mv'
  ) then
    raise exception 'refresh_ranking_view: 未知のビュー名です: %', p_view;
  end if;

  execute format('refresh materialized view concurrently %I', p_view);
end;
$$ language plpgsql security definer;

revoke execute on function refresh_ranking_view(text) from public;
grant execute on function refresh_ranking_view(text) to service_role;

-- 一括版（手動メンテナンス用に残してあるもの）にも追加して一貫性を保つ。
create or replace function refresh_ranking_views()
returns void as $$
begin
  refresh materialized view concurrently top_broadcasters_mv;
  refresh materialized view concurrently top_clippers_mv;
  refresh materialized view concurrently top_clippers_this_year_mv;
  refresh materialized view concurrently top_clippers_this_month_mv;
  refresh materialized view concurrently top_clippers_weekly_mv;
  refresh materialized view concurrently admin_dashboard_clip_stats_mv;
  refresh materialized view concurrently top_games_mv;
end;
$$ language plpgsql security definer;

revoke execute on function refresh_ranking_views() from public;
grant execute on function refresh_ranking_views() to service_role;
