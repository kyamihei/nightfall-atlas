-- Twitchログイン・ニックネーム・クリップ職人バッジ機能（2026-09-04追加）。
--
-- 要望: (1) Twitchアカウントでログインできるようにする (2) Twitchログイン時に
-- クリップ職人ランキングと紐付ける (3) ランキング入りの人は着脱可能なバッジをつけられる
-- (4) マイページでランキングを確認できる (5) ニックネームをつけられる (6) コメント投稿時に
-- ニックネームか匿名かを選べる。
--
-- 配信者ランキングとの紐付けは今回は対象外（clips.streamerが名前文字列でしかなく、
-- クリップ職人のcreator_id＝Twitch数値IDのような確実な照合キーがないため、別途対応）。

-- 1. membersテーブルに列追加。
--    twitch_user_id: auth.identities.provider_id（Twitch側の数値ユーザーID文字列）。
--    clips.creator_idと直接一致するため、これがクリップ職人ランキングとの紐付けキーになる。
alter table members add column if not exists twitch_user_id text;
alter table members add column if not exists twitch_login text;
alter table members add column if not exists twitch_display_name text;
alter table members add column if not exists nickname text;
alter table members add column if not exists clipper_badge_enabled boolean not null default false;

create unique index if not exists idx_members_twitch_user_id
  on members(twitch_user_id) where twitch_user_id is not null;

-- 2. register_member()を拡張。
--    Twitchでログイン/連携済みなら、auth.identitiesから安全に（クライアントが偽装できない
--    サーバー側の列として）Twitch識別情報を取得しmembersへ同期する。twitch_user_idは
--    クライアントからパラメータとして受け取らない（他人のcreator_idを騙ってクリップ職人
--    バッジを不正取得されるのを防ぐため）。
--    identity_dataのキー名（ログイン名/表示名側）は実装時に実際のTwitchログインで検証が
--    必要（Twitch OAuthプロバイダが実際にどのキーで返すか未確認のため、複数候補を
--    coalesceしている）。provider_id列自体は確実。
create or replace function register_member()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_anonymous boolean;
  v_number integer;
  v_twitch_user_id text;
  v_twitch_login text;
  v_twitch_display_name text;
begin
  select is_anonymous into v_is_anonymous from auth.users where id = auth.uid();
  if v_is_anonymous is distinct from false then
    raise exception 'メール確認またはTwitch連携が完了してから登録してください';
  end if;

  insert into members (id) values (auth.uid())
  on conflict (id) do nothing;

  select provider_id,
         coalesce(identity_data->>'preferred_username', identity_data->>'nickname', identity_data->>'user_name'),
         coalesce(identity_data->>'full_name', identity_data->>'name')
    into v_twitch_user_id, v_twitch_login, v_twitch_display_name
  from auth.identities
  where user_id = auth.uid() and provider = 'twitch'
  order by created_at desc
  limit 1;

  if v_twitch_user_id is not null then
    update members
    set twitch_user_id = v_twitch_user_id,
        twitch_login = coalesce(v_twitch_login, twitch_login),
        twitch_display_name = coalesce(v_twitch_display_name, twitch_display_name)
    where id = auth.uid();
  end if;

  select member_number into v_number from members where id = auth.uid();
  return v_number;
end;
$$;

-- 3. ニックネーム設定。
create or replace function set_nickname(p_nickname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trimmed text := trim(coalesce(p_nickname, ''));
begin
  if not exists (select 1 from members where id = auth.uid()) then
    raise exception '会員登録が完了していません';
  end if;
  if char_length(v_trimmed) > 20 then
    raise exception 'ニックネームは20文字以内で入力してください';
  end if;
  update members set nickname = nullif(v_trimmed, '') where id = auth.uid();
end;
$$;

-- 4. クリップ職人バッジの着脱。有効化時はサーバー側で資格を再検証する
--    （クライアントを信用しない）。top_clippers_mvは全creator_idをgroup byしているだけで
--    LIMITがないため、「ランキングに一度でも載っていれば」という緩い基準の判定にそのまま使える。
create or replace function set_clipper_badge_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_twitch_user_id text;
begin
  select twitch_user_id into v_twitch_user_id from members where id = auth.uid();
  if p_enabled then
    if v_twitch_user_id is null then
      raise exception 'Twitchアカウントを連携してください';
    end if;
    if not exists (select 1 from top_clippers_mv where creator_id = v_twitch_user_id) then
      raise exception 'クリップ職人ランキングに登録がありません';
    end if;
  end if;
  update members set clipper_badge_enabled = p_enabled where id = auth.uid();
end;
$$;

-- 5. コメント欄バッジ取得RPCを拡張。列追加のためdropしてからcreate or replaceする
--    （このプロジェクトで繰り返し踏んでいる「RETURNS TABLEの列を増やす時はdropを忘れない」）。
--    読み取り時にtop_clippers_mvを再チェックせずclipper_badge_enabledをそのまま信頼する
--    （有効化はRPC側で既にガード済み、クリップは削除されないため一度資格を得たら失われない。
--    毎回JOINし直すコストを避けるため）。
drop function if exists get_comment_member_numbers(uuid[]);
create or replace function get_comment_member_numbers(comment_ids uuid[])
returns table(comment_id uuid, member_number integer, clipper_badge boolean)
language sql
security definer
set search_path = public
stable
as $$
  select c.id as comment_id, m.member_number, coalesce(m.clipper_badge_enabled, false)
  from comments c
  join members m on m.id = c.anon_id
  where c.id = any(comment_ids);
$$;
