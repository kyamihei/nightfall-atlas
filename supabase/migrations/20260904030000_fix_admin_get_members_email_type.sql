-- admin_get_members()の「structure of query does not match function result type」エラー修正
-- （2026-09-04、ユーザー報告で発覚）。
--
-- auth.users.emailの実際の型はcharacter varying（varchar）だが、関数はemail textとして
-- 宣言していた。RETURNS TABLEのreturn queryは列の型が宣言と完全一致している必要があり、
-- varcharとtextの違いだけでもこのエラーになる。u.email::textで明示的にキャストして解決。
create or replace function admin_get_members(p_password text)
returns table(id uuid, member_number integer, email text, registered_at timestamptz) as $$
begin
  perform admin_check_password(p_password);
  return query
    select m.id, m.member_number, u.email::text, m.registered_at
    from members m
    join auth.users u on u.id = m.id
    order by m.member_number asc;
end;
$$ language plpgsql security definer;
