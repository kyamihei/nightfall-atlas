import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

export default function AboutPage() {
  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`* { font-family: 'Inter', sans-serif; } .clip-title-font { font-family: 'Oswald', sans-serif; } a { cursor: pointer; }`}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <h1 className="clip-title-font" style={styles.h1}>
        サイトについて
      </h1>

      <section style={styles.section}>
        <p style={styles.p}>
          「クリスレ」は、Twitchのクリップを対象にした非公式のランキング・掲示板サイトです。
          視聴回数やお気に入り数、独自のリアクションスタンプなどで様々な切り口からクリップをランキング表示し、
          クリップごとに匿名でコメントできます。
        </p>
        <p style={styles.p}>
          配信者だけでなく、クリップを作成した視聴者（クリップ職人）にもスポットを当てたランキングがあるのが特徴です。
        </p>
        <p style={styles.p}>
          クリップごとのコメントだけでなく、特定のクリップに縛られず配信者やTwitch全般について自由に
          話せる「総合スレ」、好きなタイトルでスレを立てられる「タグスレ」もあり、クリップランキングに
          とどまらないツイッチ掲示板として使えます。
        </p>
        <h2 style={styles.h2}>ログイン不要</h2>
        <p style={styles.p}>
          アカウント登録・ログインは不要です。ブラウザごとに匿名の識別子を自動的に発行し、
          お気に入り・リアクション・コメントの投稿に利用しています。別のブラウザや端末からは
          同一人物として扱われません。
        </p>
        <h2 style={styles.h2}>Twitchとの関係について</h2>
        <p style={styles.p}>
          本サイトはTwitch Interactive, Inc.が提供する公式サービスではなく、有志が運営する非公式サイトです。
          クリップの著作権は各配信者・クリップ作成者およびTwitchに帰属します。
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
};
