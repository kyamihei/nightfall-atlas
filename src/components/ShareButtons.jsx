import { useState } from "react";
import { Share2, Link2, Check } from "lucide-react";

/** X/LINEでのシェア・リンクコピー。クリップ/配信者/クリップ職人の各詳細ページで共通利用 */
export default function ShareButtons({ url, text }) {
  const [copied, setCopied] = useState(false);

  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const lineHref = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードAPIが使えない環境（非対応ブラウザ等）では黙って何もしない
    }
  }

  return (
    <div style={styles.row}>
      <a href={twitterHref} target="_blank" rel="noopener noreferrer" style={styles.btn}>
        <Share2 size={13} />
        Xで共有
      </a>
      <a href={lineHref} target="_blank" rel="noopener noreferrer" style={styles.btn}>
        <Share2 size={13} />
        LINEで共有
      </a>
      <button onClick={handleCopy} style={styles.btn}>
        {copied ? <Check size={13} color="#5DCAA5" /> : <Link2 size={13} />}
        {copied ? "コピーしました" : "リンクをコピー"}
      </button>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "7px 13px",
    fontSize: 13,
    color: "#8A8A99",
    textDecoration: "none",
    cursor: "pointer",
  },
};
