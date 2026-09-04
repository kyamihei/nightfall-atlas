import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

export default function PrivacyPage() {
  return (
    <div style={styles.page}>
      <BackgroundGlow />
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
          本サイトは、アカウント登録・ログインをしなくても、お気に入り・リアクション・コメント等の主要な機能を
          ご利用いただけます。初回アクセス時にブラウザごとの匿名識別子（anon_id）を自動的に発行し、ブラウザに
          保存しています。未登録の状態では、これらのデータはこの識別子に紐付けて管理されます。
        </p>
        <p style={styles.p}>
          任意で、Twitchアカウントによるログイン（会員登録）が可能です。登録すると会員番号を発行し、認証のために
          Twitch側から提供されるアカウント情報（ユーザーID・ログイン名・表示名・メールアドレス）を取得して
          保存します。登録前に匿名で利用していたお気に入り・配信者タグ・リアクション・コメント等のデータは、
          登録後もそのまま引き継がれ、以後は同じTwitchアカウントでログインしたブラウザ・端末間で同期されます。
        </p>
        <p style={styles.p}>
          会員登録後は、任意でニックネームを設定できます。設定したニックネームはコメント投稿時に表示名として
          選択できます（表示したくない場合は、これまでどおり匿名で投稿できます）。Twitchのログイン名・表示名・
          メールアドレスがコメント等の形で本サイト上に公開されることはありません。氏名・住所・電話番号等、
          これら以外に個人を直接特定できる情報の入力を求めることはありません。
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

        <h2 style={styles.h2}>Cookie・アクセス解析について</h2>
        <p style={styles.p}>
          本サイトでは、広告配信のためのCookie・トラッキングツールは使用していません。匿名識別子の保持には
          ブラウザのローカルストレージを利用しています。
        </p>
        <p style={styles.p}>
          一方で、サイトの利用状況を把握し改善に役立てる目的で、Google アナリティクスを利用しています。
          Google アナリティクスは匿名化されたアクセス情報の収集にCookieを使用しますが、氏名・メールアドレス等、
          個人を特定できる情報を取得することはありません。収集されたデータはGoogleのプライバシーポリシーに基づき
          管理されます。Cookieの利用を望まない場合は、
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" style={styles.link}>
            Google アナリティクス オプトアウト アドオン
          </a>
          等を利用することで、ブラウザの設定からCookieを無効にできます。
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
  link: { color: "#47BFFF" },
};
