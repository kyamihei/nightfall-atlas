-- 簡易管理画面（/admin）用のバックエンド（2026-09-03追加）。
-- このサイトにはログイン機能が一切なく訪問者は全員匿名セッションのため、URLを知っているだけで
-- 誰でも見られてしまわないよう、パスワードをDB側の関数で毎回照合する方式にした（本格的な
-- アカウント認証システムは作らない）。パスワードはこのファイルには含めず、事前にVaultへ
-- 登録しておく前提:
--   select vault.create_secret('<password>', 'admin_panel_password', '/admin画面のパスワード');
--
-- 対象データ（contact_messages/comment_reports/broadcaster_requests）はいずれも
-- 「本人以外は閲覧不可」のRLSのため、通常のテーブルアクセスでは管理者も読めない。
-- security definerのRPC経由でのみ、パスワードが正しい場合だけ読み書きできるようにする。

-- パスワード照合の共通ロジック。不一致なら例外を投げる（各admin_*関数の先頭で呼ぶ）。
create or replace function admin_check_password(p_password text)
returns void as $$
begin
  if p_password is null or p_password <> (select decrypted_secret from vault.decrypted_secrets where name = 'admin_panel_password') then
    raise exception '認証に失敗しました';
  end if;
end;
$$ language plpgsql security definer;

-- ログイン画面用。例外を投げず true/false だけ返す（誤入力時にエラー画面ではなく
-- 「パスワードが違います」という通常のメッセージを出したいため）。
create or replace function admin_verify_password(p_password text)
returns boolean as $$
  select p_password is not null
    and p_password = (select decrypted_secret from vault.decrypted_secrets where name = 'admin_panel_password');
$$ language sql stable security definer;

-- お問い合わせ一覧
create or replace function admin_get_contact_messages(p_password text)
returns table(id uuid, category text, email text, body text, status text, created_at timestamptz) as $$
begin
  perform admin_check_password(p_password);
  return query
    select cm.id, cm.category, cm.email, cm.body, cm.status, cm.created_at
    from contact_messages cm
    order by cm.created_at desc;
end;
$$ language plpgsql security definer;

-- お問い合わせの既読/未読切り替え
create or replace function admin_set_contact_status(p_password text, p_id uuid, p_status text)
returns void as $$
begin
  perform admin_check_password(p_password);
  if p_status not in ('unread', 'read') then
    raise exception '不正なstatusです';
  end if;
  update contact_messages set status = p_status where id = p_id;
end;
$$ language plpgsql security definer;

-- コメント通報一覧（同じコメントへの複数通報はまとめて件数表示、クリップタイトルも一緒に返す）
create or replace function admin_get_comment_reports(p_password text)
returns table(
  comment_id uuid,
  clip_id text,
  clip_title text,
  display_name text,
  body text,
  is_hidden boolean,
  report_count bigint,
  last_reported_at timestamptz
) as $$
begin
  perform admin_check_password(p_password);
  return query
    select
      c.id, c.clip_id, cl.title, c.display_name, c.body, c.is_hidden,
      count(r.id) as report_count,
      max(r.created_at) as last_reported_at
    from comment_reports r
    join comments c on c.id = r.comment_id
    left join clips cl on cl.id = c.clip_id
    group by c.id, c.clip_id, cl.title, c.display_name, c.body, c.is_hidden
    order by last_reported_at desc;
end;
$$ language plpgsql security definer;

-- 通報されたコメントの表示/非表示切り替え
create or replace function admin_set_comment_hidden(p_password text, p_comment_id uuid, p_hidden boolean)
returns void as $$
begin
  perform admin_check_password(p_password);
  update comments set is_hidden = p_hidden where id = p_comment_id;
end;
$$ language plpgsql security definer;

-- 配信者登録リクエスト履歴（閲覧のみ、承認/却下はrequest-broadcaster Edge Function側で
-- Twitch実在確認込みで自動処理される既存フローのまま変更しない）
create or replace function admin_get_broadcaster_requests(p_password text)
returns table(id uuid, twitch_login text, status text, created_at timestamptz) as $$
begin
  perform admin_check_password(p_password);
  return query
    select br.id, br.twitch_login, br.status, br.created_at
    from broadcaster_requests br
    order by br.created_at desc;
end;
$$ language plpgsql security definer;
