import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

// 新しい更新を配列の先頭に追加していく（新しい順）。日付は掲載日。
const UPDATES = [
  {
    date: "2026-09-17",
    items: [
      "週間クリップ職人ランキングが表示されないことがある不具合を修正しました。",
      "クリップ一覧の読み込みに失敗することがある不具合を修正しました。",
      "サーバーの安定性向上のためのメンテナンスを行いました。",
    ],
  },
];

export default function UpdatesPage() {
  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`* { font-family: 'Inter', sans-serif; } .clip-title-font { font-family: 'Oswald', sans-serif; } a { cursor: pointer; }`}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <h1 className="clip-title-font" style={styles.h1}>
        更新情報
      </h1>
      <p style={styles.lead}>クリスレの不具合修正・機能追加などをお知らせします。</p>

      <ul style={styles.list}>
        {UPDATES.map((entry) => (
          <li key={entry.date} style={styles.entry}>
            <p style={styles.date}>{entry.date}</p>
            <ul style={styles.itemList}>
              {entry.items.map((item, i) => (
                <li key={i} style={styles.item}>
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

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
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 8px" },
  lead: { fontSize: 13.5, color: "#8A8A99", margin: "0 0 24px" },
  list: { listStyle: "none", margin: 0, padding: 0 },
  entry: {
    borderLeft: "2px solid #2E2E3A",
    paddingLeft: 18,
    marginBottom: 24,
  },
  date: {
    fontSize: 13,
    fontWeight: 600,
    color: "#AFA9EC",
    margin: "0 0 8px",
    fontVariantNumeric: "tabular-nums",
  },
  itemList: { listStyle: "disc", margin: 0, paddingLeft: 18 },
  item: {
    fontSize: 13.5,
    lineHeight: 1.9,
    color: "#C4C4D0",
    margin: "0 0 4px",
  },
};
