import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

export default function TermsPage() {
  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`* { font-family: 'Inter', sans-serif; } .clip-title-font { font-family: 'Oswald', sans-serif; } a { cursor: pointer; }`}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <h1 className="clip-title-font" style={styles.h1}>
        利用規約
      </h1>

      <section style={styles.section}>
        <p style={styles.p}>
          この利用規約（以下「本規約」）は、「クリスレ」（以下「本サイト」）の利用条件を定めるものです。
          本サイトを利用した時点で、本規約に同意したものとみなします。
        </p>

        <h2 style={styles.h2}>第1条（禁止事項）</h2>
        <p style={styles.p}>本サイトの利用にあたり、以下の行為を禁止します。</p>
        <ul style={styles.ul}>
          <li style={styles.li}>法令または公序良俗に違反する行為</li>
          <li style={styles.li}>他者を誹謗中傷する、または不快にさせるコメントの投稿</li>
          <li style={styles.li}>虚偽の通報や連続投稿・スパム行為など、本サイトの運営を妨げる行為</li>
          <li style={styles.li}>不正アクセスやサーバー・ネットワークへの過度な負荷をかける行為</li>
          <li style={styles.li}>その他、運営が不適切と判断する行為</li>
        </ul>
        <p style={styles.p}>
          禁止事項に該当する、または該当する恐れがあると運営が判断した投稿は、事前の通知なく削除する場合があります。
        </p>

        <h2 style={styles.h2}>第2条（クリップの著作権）</h2>
        <p style={styles.p}>
          本サイトに表示されるクリップ映像・サムネイル等の著作権は、各配信者・クリップ作成者およびTwitch
          Interactive, Inc.に帰属します。本サイトはTwitchの公開APIを通じて取得した情報を表示しているのみです。
        </p>

        <h2 style={styles.h2}>第3条（免責事項）</h2>
        <p style={styles.p}>
          本サイトは、掲載情報（視聴回数・ランキング等）の正確性・完全性・最新性についていかなる保証も行いません。
          本サイトの利用によって生じたいかなる損害についても、運営は責任を負いません。
        </p>

        <h2 style={styles.h2}>第4条（サービスの変更・停止）</h2>
        <p style={styles.p}>
          運営は、利用者への事前通知なく、本サイトの内容を変更し、または提供を中断・終了することがあります。
        </p>

        <h2 style={styles.h2}>第5条（規約の変更）</h2>
        <p style={styles.p}>
          本規約は、必要に応じて予告なく変更されることがあります。変更後の規約は、本ページに掲載した時点から効力を生じます。
        </p>
      </section>

      <Footer />
    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    zIndex: 0,
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 32px 60px",
    maxWidth: 760,
    margin: "0 auto",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#8A8A99",
    fontSize: 12.5,
    textDecoration: "none",
    marginBottom: 18,
  },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 20px" },
  h2: { fontSize: 15, fontWeight: 600, margin: "22px 0 8px", color: "#EDEDF2" },
  section: { fontSize: 13.5, lineHeight: 1.9, color: "#C4C4D0" },
  p: { margin: "0 0 12px" },
  ul: { margin: "0 0 12px", paddingLeft: 20 },
  li: { marginBottom: 4 },
};
