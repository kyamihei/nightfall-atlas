-- 管理画面に会員一覧・削除機能を追加（2026-09-04追加）。
-- 既存のadmin_get_*/admin_set_*と同じパターン（admin_check_passwordで照合、
-- security definerでauth.usersをJOINして返す）。

-- 会員一覧（会員番号昇順＝登録が早い順）。auth.usersとJOINしてメールアドレスも一緒に返す
-- （管理者が不正・スパムアカウントを識別するために必要な情報のため、公開APIには出さない）。
create or replace function admin_get_members(p_password text)
returns table(id uuid, member_number integer, email text, registered_at timestamptz) as $$
begin
  perform admin_check_password(p_password);
  return query
    select m.id, m.member_number, u.email, m.registered_at
    from members m
    join auth.users u on u.id = m.id
    order by m.member_number asc;
end;
$$ language plpgsql security definer;

-- 会員登録の取り消し（membersから削除、会員番号バッジは消える）。
-- auth.usersのアカウント自体（メール/パスワード、既存のお気に入り・タグ・スタンプ等）は
-- 削除しない。あくまで「会員資格」だけを取り消す操作という設計（アカウントごと消したい場合は
-- 別途対応が必要、意図的にスコープを絞っている）。
create or replace function admin_delete_member(p_password text, p_id uuid)
returns void as $$
begin
  perform admin_check_password(p_password);
  delete from members where id = p_id;
end;
$$ language plpgsql security definer;
