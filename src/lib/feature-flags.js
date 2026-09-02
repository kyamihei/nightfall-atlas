// feature-flags.js
//
// 一時的に無効化している機能のオン/オフをここでまとめて管理する。
// バックエンド（テーブル・RPC・フック）は削除せず残したまま、UI表示だけを止める用途。
// 復活させる場合は該当のフラグをtrueに戻すだけでよい。

// いいね/よくないねボタン・「評価した動画」ページへの導線の表示（2026-09-02に非表示化）。
// バックエンド（reactionsテーブル・useReactions・get_ranked_clipsのsort_by='likes'等）はそのまま残している。
export const REACTIONS_ENABLED = false;
