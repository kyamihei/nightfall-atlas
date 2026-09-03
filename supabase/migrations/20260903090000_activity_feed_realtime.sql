-- トップページのライブ活動フィード（新着コメント/スタンプをリアルタイムで流すティッカー）用。
-- commentsは既にrealtime publicationに入っているが、clip_reaction_stampsは未追加だったため、
-- INSERTイベントがクライアントに届くようこちらも追加する（同じ理由・同じ書き方はschema.sql参照）。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'clip_reaction_stamps'
  ) then
    alter publication supabase_realtime add table clip_reaction_stamps;
  end if;
end $$;
