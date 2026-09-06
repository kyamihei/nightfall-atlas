-- 管理画面「サイト閲覧を可視化したい」という要望への対応（2026-09-06追加）。
-- Google Analyticsは別途導入済みだが、GA4のデータをこのサイトの管理画面に埋め込むには
-- Google Cloud側でのサービスアカウント作成・GA4プロパティへの権限付与など人間の作業が
-- 追加で必要になる。それよりシンプルに、search_log（検索ログ）と全く同じ設計
-- （誰でもinsert可・selectポリシーは無し・admin_get_dashboard等のsecurity definer経由でのみ
-- 読める）でページビューを自前記録する方式を採用した。
--
-- pathは生のURL（クリップIDなど可変部分を含む）ではなく、フロント側
-- （src/App.jsxのnormalizePagePath）で「/clips/:id」のようなルートテンプレートに正規化した
-- ものを保存する。生パスのままだと「よく見られているページ」の集計がクリップ数（54万件超）
-- 分のユニーク値に散ってしまい、集計として意味を成さないため。
create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_page_views_created on page_views(created_at desc);
create index if not exists idx_page_views_path on page_views(path);

alter table page_views enable row level security;

drop policy if exists "page_views_insert_anyone" on page_views;
create policy "page_views_insert_anyone" on page_views
  for insert with check (true);
-- selectポリシーは意図的に用意しない（admin_get_page_view_statsのsecurity definer経由でのみ読める）

-- 日別集計は日本のユーザー向けサイトのため、UTCではなくJST日付境界で区切る。
create or replace function admin_get_page_view_stats(p_password text)
returns jsonb as $$
declare
  v_result jsonb;
begin
  perform admin_check_password(p_password);

  select jsonb_build_object(
    'total_all_time', (select count(*) from page_views),
    'total_24h', (select count(*) from page_views where created_at >= now() - interval '24 hours'),
    'total_7d', (select count(*) from page_views where created_at >= now() - interval '7 days'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'count', coalesce(c.cnt, 0)) order by d), '[]'::jsonb)
      from generate_series(
        date_trunc('day', now() at time zone 'Asia/Tokyo') - interval '29 days',
        date_trunc('day', now() at time zone 'Asia/Tokyo'),
        interval '1 day'
      ) d
      left join (
        select date_trunc('day', created_at at time zone 'Asia/Tokyo') as day, count(*) as cnt
        from page_views
        where created_at >= now() - interval '30 days'
        group by 1
      ) c on c.day = d
    ),
    'top_paths_7d', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select path, count(*) as cnt
        from page_views
        where created_at >= now() - interval '7 days'
        group by path
        order by cnt desc
        limit 10
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$ language plpgsql security definer;
