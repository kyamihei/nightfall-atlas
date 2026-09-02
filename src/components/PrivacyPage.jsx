import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Footer from "./Footer";

export default function PrivacyPage() {
  return (
    <div style={styles.page}>
      <style>{`* { font-family: 'Inter', sans-serif; } .clip-title-font { font-family: 'Oswald', sans-serif; } a { cursor: pointer; }`}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <h1 className="clip-title-font" style={styles.h1}>
        プライバシーポリシー
      </h1>

      <section style={styles.section}>
        <p style={styles.p}>
          「クリスレ」（以下「本サイト」）における利用者情報の取り扱いについて、以下のとおり定めます。
        </p>

        <h2 style={styles.h2}>アカウント登録・匿名識別子について</h2>
        <p style={styles.p}>
          本サイトはアカウント登録・ログイン機能を提供していません。代わりに、初回アクセス時にブラウザごとの
          匿名識別子（anon_id）を自動的に発行し、ブラウザに保存しています。お気に入り・リアクション・コメント・
          お問い合わせは、この識別子に紐付けて管理されます。氏名・住所・電話番号等、個人を直接特定できる情報の
          入力を求めることはありません。
        </p>

        <h2 style={styles.h2}>コメント・表示名について</h2>
        <p style={styles.p}>
          クリップに投稿されたコメントおよび表示名は、本サイトの利用者全員が閲覧できる形で公開されます。
          表示名やコメント本文に個人情報を含めないようご注意ください。
        </p>

        <h2 style={styles.h2}>IPアドレスの取り扱い</h2>
        <p style={styles.p}>
          コメントおよびお問い合わせの投稿時、不正な連続投稿・スパムを防止する目的でIPアドレスを
          不可逆なハッシュ値に変換したうえで一時的に保存しています。ハッシュ化前のIPアドレスそのものを
          保存することはありません。
        </p>

        <h2 style={styles.h2}>お問い合わせフォームについて</h2>
        <p style={styles.p}>
          お問い合わせフォームで入力されたメールアドレスは、返信を希望された場合の連絡目的にのみ使用し、
          第三者へ提供することはありません。メールアドレスの入力は任意です。
        </p>

        <h2 style={styles.h2}>Cookie・広告について</h2>
        <p style={styles.p}>
          本サイトでは、広告配信や第三者による行動追跡のためのCookie・トラッキングツールは使用していません。
          匿名識別子の保持にはブラウザのローカルストレージを利用しています。
        </p>

        <h2 style={styles.h2}>本ポリシーの変更</h2>
        <p style={styles.p}>本ポリシーは、必要に応じて予告なく変更されることがあります。</p>
      </section>

      <Footer />
    </div>
  );
}

const styles = {
  page: {
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
