import { Link } from "react-router-dom";
import {
  ArrowLeft,
  SlidersHorizontal,
  Play,
  Smile,
  Tag,
  Scissors,
  Hash,
  UserPlus,
} from "lucide-react";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

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
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 8px" },
  lead: { fontSize: 13.5, color: "#8A8A99", margin: "0 0 24px", lineHeight: 1.7 },
  list: { display: "flex", flexDirection: "column", gap: 20 },
  section: {
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "16px 18px",
  },
  h2: {
    display: "flex",
    alignItems: "center",
    fontSize: 15,
    fontWeight: 600,
    margin: "0 0 8px",
    color: "#EDEDF2",
  },
  h2Icon: { marginRight: 8, color: "#FF4D6D", flexShrink: 0 },
  p: { fontSize: 13.5, lineHeight: 1.9, color: "#C4C4D0", margin: "0 0 8px" },
};

const SECTIONS = [
  {
    icon: SlidersHorizontal,
    title: "クリップを探す",
    body: (
      <>
        <p style={styles.p}>
          トップページ上部の「フィルター」ボタンから、期間（全期間・今年・今月・日別）、並び替え（視聴回数順・新着順など）、
          ゲームで絞り込めます。マイタグを付けた配信者がいれば「配信者タグ」での絞り込みも表示されます。
        </p>
        <p style={styles.p}>
          ヘッダーの検索欄では配信者名で絞り込めます。「総合ランキング」「トレンドランキング」タブでは、
          直近で伸びているクリップだけを見ることもできます。
        </p>
      </>
    ),
  },
  {
    icon: Play,
    title: "クリップを再生する",
    body: (
      <p style={styles.p}>
        サムネイルをクリックするとその場で動画が再生されます。タイトルをクリックすると、そのクリップの詳細ページに移動します。
      </p>
    ),
  },
  {
    icon: Smile,
    title: "リアクション・お気に入り・コメント",
    body: (
      <>
        <p style={styles.p}>
          各クリップの「リアクションする」ボタンを押すと、7種類のスタンプ（すっご/うおｗ/えっど等）がポップアップで表示され、
          自由に付けたり外したりできます。
        </p>
        <p style={styles.p}>
          ☆ボタンでお気に入り登録、💬ボタンでコメント欄を開けます。コメントは5ch風にレス番号が振られ、
          他のコメントに返信することもできます。ニックネームを設定していれば、投稿のたびにニックネーム表示か匿名かを選べます。
        </p>
      </>
    ),
  },
  {
    icon: Tag,
    title: "配信者にマイタグを付ける",
    body: (
      <p style={styles.p}>
        配信者ページで自分だけのタグ（例:「ZETA」）を自由に付けられます。付けたタグは自分のブラウザ・アカウントにのみ
        保存され、トップページの「フィルター」からそのタグの配信者のクリップだけに絞り込めるほか、「タグスレ」でその話題について話せます。
      </p>
    ),
  },
  {
    icon: Scissors,
    title: "ランキングを見る",
    body: (
      <p style={styles.p}>
        「配信者一覧」では配信者を、「クリップ職人」ではクリップを作った視聴者を、それぞれの合計視聴回数順にランキング表示しています。
        トップページの「週間クリップ職人ランキング」では、直近1週間でよく再生されているクリップ職人が確認できます。
      </p>
    ),
  },
  {
    icon: Hash,
    title: "スレッドで話す",
    body: (
      <p style={styles.p}>
        「総合スレ」はクリップを問わず自由に話せるツイッチ掲示板、「タグスレ」はマイタグに関連する話題ごとに立てられるスレです。
        どちらも新しいスレを自分で立てられます。
      </p>
    ),
  },
  {
    icon: UserPlus,
    title: "会員登録・マイページ",
    body: (
      <>
        <p style={styles.p}>
          Twitchアカウントでログインすると会員登録され、会員番号が発行されます。お気に入り・マイタグ・リアクションなどの
          データは登録前のものも含めてそのまま引き継がれ、以後は別のブラウザ・端末からログインしても同じデータが同期されます。
        </p>
        <p style={styles.p}>
          マイページではニックネームの設定や、クリップ職人ランキングに載ったことがある場合はクリップ職人バッジの着脱ができます。
          バッジを有効にすると、自分のコメントに紫色のバッジが表示されます。
        </p>
      </>
    ),
  },
];

export default function HowToUsePage() {
  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`* { font-family: 'Inter', sans-serif; } .clip-title-font { font-family: 'Oswald', sans-serif; } a { cursor: pointer; }`}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <h1 className="clip-title-font" style={styles.h1}>
        サイトの使い方
      </h1>
      <p style={styles.lead}>
        「クリスレ」でできることをまとめました。会員登録・ログインなしでも、お気に入り・リアクション・コメントは今すぐ使えます。
      </p>

      <div style={styles.list}>
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <section key={title} style={styles.section}>
            <h2 style={styles.h2}>
              <Icon size={16} style={styles.h2Icon} />
              {title}
            </h2>
            {body}
          </section>
        ))}
      </div>

      <Footer />
    </div>
  );
}
