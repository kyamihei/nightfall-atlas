-- refresh_ranking_views()は6つのマテリアライズドビューを1つのRPC呼び出し（1本のHTTPリクエスト）に
-- まとめてREFRESHしていたが、実測で合計100〜126秒かかっており、Supabase REST APIゲートウェイ側の
-- タイムアウト（実測約120〜126秒で"upstream request timeout"の504、DB側のstatement_timeoutとは別に
-- ゲートウェイ層で課される制約でロール設定では回避できない）に達し、サイレントに失敗し続けていた
-- （refresh-clip-views.tsはこのRPCのエラーをconsole.errorするだけでスクリプト自体は正常終了扱いに
-- していたため、GitHub Actions側は「成功」のまま気づけずにいた。sync-twitch-clips.ts側も同様の
-- エラーハンドリングのため同じ問題を抱えていた）。
--
-- 対策として、1ビューだけをRPC 1回でREFRESHする関数を新設し、呼び出し側（sync-twitch-clips.ts /
-- refresh-clip-views.ts）はビューごとに個別のRPCを順番に呼ぶよう変更する。1ビューあたりの
-- 実測時間（約17〜21秒）であれば120秒のゲートウェイ制限に十分収まる。
--
-- ビュー名はSQLインジェクション対策のため許可リストで検証してからformat(%I)で組み立てる
-- （service_role専用関数のため実害は薄いが、動的SQLを使う以上は防御的に書く）。
create or replace function refresh_ranking_view(p_view text)
returns void as $$
begin
  if p_view not in (
    'top_broadcasters_mv',
    'top_clippers_mv',
    'top_clippers_this_year_mv',
    'top_clippers_this_month_mv',
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

-- refresh_ranking_views()（6ビュー一括）は残しておく（手動メンテナンス等、ゲートウェイを経由しない
-- 直接DB接続からの呼び出しであれば引き続き問題なく使えるため）。ただし今後のアプリケーション側の
-- 定期呼び出しはすべてrefresh_ranking_view(text)のループに置き換える。
