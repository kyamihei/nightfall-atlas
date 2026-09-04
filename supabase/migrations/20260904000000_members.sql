-- 会員登録機能（2026-09-04追加）
--
-- 「番号を1から振っていく、早めに登録した人ほど若い番号で後々自慢できる」というユーザー
-- 要望への対応。匿名セッション（anon_id）はブラウザデータを消すと失われるため、
-- 「ずっと自慢できる番号」にはふさわしくないと判断し、Supabaseの匿名→本登録
-- （メール+パスワードのリンク、既存のanon_idそのまま引き継ぎ）方式を採用した
-- （フロント側の実装はsrc/components/RegisterPage.jsx参照）。
--
-- 会員限定機能の第一弾は「コメント欄に会員番号バッジを表示」（get_comment_member_numbers）。

create table if not exists members (
  id uuid primary key references auth.users(id) on delete cascade,
  member_number integer generated always as identity,
  registered_at timestamptz not null default now()
);

create unique index if not exists idx_members_member_number on members(member_number);

alter table members enable row level security;

-- 自分の会員情報だけ閲覧可（登録画面で「もう会員です」を判定するため）。
-- 他人の番号はget_comment_member_numbers経由でのみ間接的に見える（comments.anon_idを
-- クライアントへ直接晒さない、既存の「表示はしない、開示請求対応用」の方針を踏襲）。
drop policy if exists "members_select_own" on members;
create policy "members_select_own" on members
  for select using (id = auth.uid());

-- INSERT/UPDATE/DELETE用のポリシーは意図的に用意しない（ポリシー無し＝拒否）。
-- 書き込みはregister_member() RPC（security definer）経由のみに限定する。

-- 匿名から本登録（メール確認済み）に移行したユーザーが呼ぶと会員番号を新規発行する。
-- 既に登録済みなら何もせず既存の番号を返す（冪等、再クリックしても壊れない）。
-- is_anonymousクレームのチェックはrestrictiveポリシーではなく関数内で行う
-- （書き込み経路がこの関数1つしかなく、RLSポリシーを分けるより見通しが良いため）。
create or replace function register_member()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_anonymous boolean;
  v_number integer;
begin
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) into v_is_anonymous;
  if v_is_anonymous then
    raise exception 'メール確認が完了してから登録してください';
  end if;

  insert into members (id) values (auth.uid())
  on conflict (id) do nothing;

  select member_number into v_number from members where id = auth.uid();
  return v_number;
end;
$$;

-- コメント一覧に会員バッジ（番号）を表示するためのRPC。comment_idの配列を受け取り、
-- 投稿者が会員なら番号を返す（会員でなければ結果に含まれない）。comments.anon_idを
-- クライアントへ直接返さず、security definerでJOIN結果だけを渡す設計。
create or replace function get_comment_member_numbers(comment_ids uuid[])
returns table(comment_id uuid, member_number integer)
language sql
security definer
set search_path = public
stable
as $$
  select c.id as comment_id, m.member_number
  from comments c
  join members m on m.id = c.anon_id
  where c.id = any(comment_ids);
$$;
