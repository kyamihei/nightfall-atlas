import { useNavigate } from "react-router-dom";

// 各詳細ページの「戻る」リンクが常に固定パス（例: "/"）へのLinkだったため、
// 一覧側のタブ選択・検索条件・スクロール位置などその場のstateを保持したまま
// 戻れない不具合があった（2026-09-04、ユーザー報告：トレンドタブ→クリップ詳細→
// 「ランキングに戻る」で総合ランキングに飛んでしまい、トレンドタブへ戻れない）。
// このサイトの一覧はタブ/検索/期間などをコンポーネント内のuseStateで持っており、
// 詳細ページへの遷移でアンマウントされると失われる。ブラウザの実際の履歴を1つ戻れば
// 直前のURL（例: "/?view=trending"）へ戻り、一覧側がそのURLから状態を復元できる
// （ClipRanking.jsxのactiveViewはURLの?viewから復元するよう対応済み）ため、
// このサイト内を辿ってきた場合は本物の履歴バックを使い、直接URLを開いた場合など
// 戻り先が無い場合のみfallbackTo（一覧のトップパス）へ遷移する。
export function useSmartBack(fallbackTo) {
  const navigate = useNavigate();
  return function goBack() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate(fallbackTo);
    }
  };
}
