import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useMyReactions } from "../lib/use-clip-ranking";

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function MyReactions() {
  const { likedClips, dislikedClips, loading } = useMyReactions();
  const [tab, setTab] = useState("like"); // like | dislike

  const clips = tab === "like" ? likedClips : dislikedClips;

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
      `}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <header style={styles.header}>
        <h1 className="clip-title-font" style={styles.h1}>
          評価した動画
        </h1>
        <div style={styles.tabs}>
          <button
            onClick={() => setTab("like")}
            style={tab === "like" ? styles.tabActive : styles.tab}
          >
            いいね（{likedClips.length}）
          </button>
          <button
            onClick={() => setTab("dislike")}
            style={tab === "dislike" ? styles.tabActive : styles.tab}
          >
            よくないね（{dislikedClips.length}）
          </button>
        </div>
      </header>

      {loading ? (
        <div style={styles.loadingWrap}>
          <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ marginLeft: 10 }}>読み込み中…</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <div style={styles.list}>
          {clips.length === 0 && (
            <div style={styles.emptyState}>
              {tab === "like" ? "いいねした動画はまだありません。" : "よくないねした動画はまだありません。"}
            </div>
          )}
          {clips.map((clip) => (
            <Link key={clip.id} to={`/clips/${clip.id}`} style={styles.row}>
              <div style={styles.thumb}>
                {clip.thumbnail_url ? (
                  <img src={clip.thumbnail_url} alt="" style={styles.thumbImg} />
                ) : (
                  <span style={styles.thumbFallback}>{clip.game}</span>
                )}
              </div>
              <div style={styles.infoCol}>
                <p className="clip-title-font" style={styles.clipTitle}>{clip.title}</p>
                <p style={styles.metaLine}>
                  {clip.streamer} ・ {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴
                </p>
              </div>
              <span style={styles.reactedAt}>{timeAgo(new Date(clip.reactedAt).getTime())}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 20px 40px",
    maxWidth: 720,
    margin: "0 auto",
  },
  loadingWrap: {
    color: "#8A8A99",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 0",
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
  header: { borderBottom: "1px solid #24242F", paddingBottom: 18, marginBottom: 18 },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 14px" },
  tabs: { display: "flex", gap: 6 },
  tab: {
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#8A8A99",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
  },
  tabActive: {
    background: "#24242F",
    border: "1px solid #3A3A48",
    color: "#EDEDF2",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
  },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  emptyState: { color: "#6B6B78", fontSize: 14, padding: "40px 0", textAlign: "center" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "10px 14px",
    color: "#EDEDF2",
    textDecoration: "none",
  },
  thumb: {
    width: 56,
    height: 38,
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
    background: "#20202B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover" },
  thumbFallback: { fontSize: 9, color: "#8A8A99", textAlign: "center", padding: "0 2px" },
  infoCol: { flex: 1, minWidth: 0 },
  clipTitle: {
    fontSize: 14,
    fontWeight: 500,
    margin: "0 0 3px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  metaLine: {
    fontSize: 12,
    color: "#6B6B78",
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  reactedAt: { fontSize: 11.5, color: "#5A5A66", flexShrink: 0 },
};
