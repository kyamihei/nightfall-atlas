const styles = {
  bgGlow: {
    // position:absoluteだとpage全体（スクロールで数千pxになる）の高さ基準になり、
    // %指定のブロブ位置が画面外へ飛んでいってしまうため、ビューポート基準のfixedにする
    position: "fixed",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: -1, // 呼び出し側のposition:relative+zIndex:0を基準にスタッキングし、通常コンテンツより下に描画させる
  },
  bgBlob: {
    position: "absolute",
    width: 560,
    height: 560,
    borderRadius: "50%",
    filter: "blur(110px)",
    opacity: 0.22,
  },
};

/**
 * 全ページ共通の背景装飾（ぼかしたブランドカラーの光の塊）。元々トップページ
 * （ClipRanking.jsx）だけに実装されていたが、「トップページ以外は殺風景」という指摘
 * （2026-09-04）を受けて共通コンポーネント化し、他の全ページ（配信者一覧・クリップ詳細等）
 * にも展開した。
 *
 * 使う側は`page`スタイルに`position: "relative", zIndex: 0`を付けること
 * （このコンポーネント自体の`position: fixed; zIndex: -1`を正しく`page`基準で
 * スタッキングさせるために必須。`position: relative`だけではスタッキングコンテキストが
 * 作られず、`zIndex: -1`がルートまでエスケープしてしまう）。
 */
export default function BackgroundGlow() {
  return (
    <div style={styles.bgGlow} aria-hidden="true">
      <div className="cv-bg-blob-1" style={{ ...styles.bgBlob, background: "#FF4D6D", top: "-12%", left: "-8%" }} />
      <div className="cv-bg-blob-2" style={{ ...styles.bgBlob, background: "#7E14FF", top: "8%", right: "-14%" }} />
      <div className="cv-bg-blob-3" style={{ ...styles.bgBlob, background: "#47BFFF", bottom: "-16%", left: "28%" }} />
    </div>
  );
}
