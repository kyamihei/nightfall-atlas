// lib/thread-format.js
//
// スレ・コメント欄を5ch風（レス番号・新しい順表示）にする機能で共通利用するヘルパー
// （2026-09-04追加）。「スレは5chみたいにしてほしい、新しい順（上が最新）にしてほしい」
// というユーザー要望への対応。総合スレ・タグスレ・クリップのコメント欄（トップページの
// サイドパネル版含む）で同じロジックを使う。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pad(n) {
  return String(n).padStart(2, "0");
}

/** 5ch風の絶対日時表記（例: 2026/09/04(金) 12:34:56）。相対時刻（"5分前"）ではなく採用した */
export function formatThreadTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${WEEKDAYS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * コメント配列（DBからの取得順＝created_at昇順を想定）にレス番号（1始まり、投稿順で固定）を
 * 付与し、表示用に新しい順へ並べ替えて返す。5chのレス番号は「その時点で何番目に書かれたか」
 * を表す固定値のため、表示順（新しい順/古い順）を変えても番号自体は変わらないようにするのが
 * 重要（変わると">>N"の参照がズレる）。
 *
 * 返り値のnumberByIdは、返信の">>N"参照先（親コメントの番号）を引くのに使う。
 */
export function numberCommentsForDisplay(comments) {
  const numbered = comments.map((c, i) => ({ ...c, number: i + 1 }));
  const numberById = new Map(numbered.map((c) => [c.id, c.number]));
  const display = [...numbered].reverse(); // 新しい順（上が最新）
  return { display, numberById };
}
