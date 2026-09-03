-- ライブ活動フィードの「新着クリップ」枠（clipsをcreated_at降順で取得）が、
-- 39万件超のclipsテーブルに対して索引なしのソートになり匿名ロールのstatement_timeout（3秒）を
-- 超えていたため追加。
create index if not exists idx_clips_created_at on clips(created_at desc);
