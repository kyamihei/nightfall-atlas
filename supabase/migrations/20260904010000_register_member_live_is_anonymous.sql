-- register_member()のis_anonymous判定をJWTクレーム（auth.jwt()）ではなく
-- auth.usersの実データ列から直接見るように修正（2026-09-04、バグ修正）。
--
-- 【発見した不具合】メール確認リンクを踏んだ直後、auth.users.is_anonymousはfalseに
-- 更新されているのに、クライアントが保持している既存のアクセストークン（JWT）には
-- まだ古いis_anonymous=trueが埋め込まれたままのことがある（JWTは発行時点のクレームを
-- 保持する仕組みのため、セッションが明示的にリフレッシュされるまで更新されない）。
-- register_member()がauth.jwt()->>'is_anonymous'というJWT側の（古い可能性がある）値を
-- 見ていたため、実際にはメール確認済みのユーザーが「メール確認が完了してから登録してください」
-- という誤ったエラーで弾かれることがあった。ユーザー報告のバグ「パスワードを登録完了して
-- ないのにログインができてしまった」はこれが原因: updateUser({password})自体はJWTの
-- is_anonymousクレームに依存せず独立して成功するため、パスワードだけ設定されて会員登録
-- （番号発行）は失敗する、という分かりにくい状態になっていた。
--
-- 対策としてJWTクレームではなくauth.users.is_anonymous列を直接参照するようにした
-- （SECURITY DEFINERで実行されるためRLSに関係なくauth.usersを読める。この列は常に
-- 最新のサーバー側の状態を反映するため、クライアントのトークンが古くても正しく判定できる）。
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
  select is_anonymous into v_is_anonymous from auth.users where id = auth.uid();
  if v_is_anonymous is distinct from false then
    raise exception 'メール確認が完了してから登録してください';
  end if;

  insert into members (id) values (auth.uid())
  on conflict (id) do nothing;

  select member_number into v_number from members where id = auth.uid();
  return v_number;
end;
$$;
