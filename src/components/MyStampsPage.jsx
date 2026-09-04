import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Film, Smile } from "lucide-react";
import { useMyStamps, useBroadcasterAvatars, REACTION_STAMPS } from "../lib/use-clip-ranking";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

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

export default function MyStampsPage() {
  const { clipsByStamp, loading } = useMyStamps();
  const [tab, setTab] = useState(REACTION_STAMPS[0]);

  const clips = clipsByStamp[tab] ?? [];
  const streamerNames = useMemo(() => [...new Set(clips.map((c) => c.streamer))], [clips]);
  const avatars = useBroadcasterAvatars(streamerNames);

  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        .cv-list-row {
          transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
        }
        .cv-list-row:hover {
          background: #22222E;
          border-color: #33333F;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.28);
        }
      `}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <header style={styles.header}>
        <h1 className="clip-title-font" style={styles.h1}>
          <Smile size={20} style={{ marginRight: 8, verticalAlign: -3 }} />
          リアクションしたクリップ
        </h1>
        <p style={styles.tagline}>リアクションの種類ごとに、自分が押したクリップを確認できます</p>

        <div style={styles.tabs}>
          {REACTION_STAMPS.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              style={tab === s ? styles.tabActive : styles.tab}
            >
              {s}
              {clipsByStamp[s]?.length > 0 && <span style={styles.tabCount}>{clipsByStamp[s].length}</span>}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div style={styles.loadingWrap}>
          <Loader2 size={22} style={{ animation: "cv-spin 1s linear infinite" }} />
          <span style={{ marginLeft: 10 }}>読み込み中…</span>
        </div>
      ) : (
        <div style={styles.list}>
          {clips.length === 0 && (
            <div style={styles.emptyState}>
              <Film size={26} color="#3E3E4A" style={{ marginBottom: 10 }} />
              <p style={{ margin: 0 }}>「{tab}」でリアクションしたクリップはまだありません。</p>
            </div>
          )}
          {clips.map((clip, i) => (
            <Link
              key={clip.id}
              className="cv-list-row cv-fade-in-up"
              to={`/clips/${clip.id}`}
              style={{ ...styles.row, animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
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
                  {avatars[clip.streamer] ? (
                    <img src={avatars[clip.streamer]} alt="" style={styles.rowAvatar} />
                  ) : (
                    <span style={styles.rowAvatarFallback} />
                  )}
                  {clip.streamer} ・ {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴
                </p>
              </div>
              <span style={styles.reactedAt}>{timeAgo(new Date(clip.stampedAt).getTime())}</span>
            </Link>
          ))}
        </div>
      )}

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
    padding: "28px 32px 40px",
    maxWidth: 1200,
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
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 6px", display: "flex", alignItems: "center" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: "0 0 14px" },
  tabs: { display: "flex", flexWrap: "wrap", gap: 6 },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#8A8A99",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
  },
  tabActive: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#3A2E1466",
    border: "1px solid #FFC85755",
    color: "#FFC857",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 600,
  },
  tabCount: { fontSize: 11, opacity: 0.8 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  emptyState: {
    color: "#6B6B78",
    fontSize: 14,
    padding: "48px 0",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
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
    display: "flex",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowAvatar: { width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  rowAvatarFallback: { width: 16, height: 16, borderRadius: "50%", background: "#20202B", flexShrink: 0 },
  reactedAt: { fontSize: 11.5, color: "#5A5A66", flexShrink: 0 },
};
