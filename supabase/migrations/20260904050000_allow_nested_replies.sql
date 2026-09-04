-- 「レスのコメントには返信できないようになっているが、基本的にすべてのコメントにレスできる
-- ようにして」という要望への対応（2026-09-04）。従来は「返信は1階層のみ」という制約を
-- DB関数側で強制していたが、これを撤廃し、返信への返信（多階層）も許可する。
-- タグスレのコメント投稿RPC（post_tag_thread_comment）から「返信への返信」チェックを削除。
-- クリップ/総合スレのコメント投稿はEdge Function（supabase/functions/post-comment/index.ts）側
-- で同様の制約を撤廃済み。表示側は元々レス番号による>>N参照方式（ネスト表示ではない）なので、
-- 多階層になってもUIの変更は不要。

create or replace function post_tag_thread_comment(
  p_thread_id uuid,
  p_body text,
  p_display_name text default null,
  p_parent_id uuid default null
)
returns table(id uuid, display_name text, body text, created_at timestamptz, parent_id uuid) as $$
declare
  v_uid uuid := auth.uid();
  v_body text := trim(p_body);
  v_name text := coalesce(nullif(trim(p_display_name), ''), '名無しの視聴者');
  v_parent tag_thread_comments%rowtype;
  v_recent timestamptz;
  v_new_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception '認証が必要です';
  end if;
  if v_body = '' or char_length(v_body) > 280 then
    raise exception 'コメントは1〜280文字で入力してください';
  end if;
  if not exists (select 1 from tag_threads t where t.id = p_thread_id) then
    raise exception '対象のスレが見つかりません';
  end if;

  if p_parent_id is not null then
    select * into v_parent from tag_thread_comments c where c.id = p_parent_id;
    if not found or v_parent.thread_id <> p_thread_id then
      raise exception '返信先のコメントが見つかりません';
    end if;
  end if;

  select c.created_at into v_recent
  from tag_thread_comments c
  where c.thread_id = p_thread_id and c.anon_id = v_uid
  order by c.created_at desc
  limit 1;
  if v_recent is not null and v_recent >= now() - interval '15 seconds' then
    raise exception '連続投稿はできません。少し待ってからお試しください';
  end if;

  insert into tag_thread_comments (id, thread_id, anon_id, display_name, body, parent_id)
  values (v_new_id, p_thread_id, v_uid, left(v_name, 20), v_body, p_parent_id);

  return query select v_new_id, left(v_name, 20)::text, v_body, now(), p_parent_id;
end;
$$ language plpgsql security definer;
