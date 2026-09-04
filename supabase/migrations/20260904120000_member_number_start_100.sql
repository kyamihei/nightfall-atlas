-- 会員番号の採番を100番から開始する（2026-09-04追加）。
-- ユーザー（会員番号#1）以外の新規会員登録者には、100番以降の連番を付与してほしいという要望。
-- 既存の#1はそのまま維持し、次にregister_member()が発行する番号だけ100から始まるようにする。
alter sequence members_member_number_seq restart with 100;
