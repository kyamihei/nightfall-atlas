import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useBroadcasterProfile } from "../lib/use-clip-ranking";

const PERIOD_TABS = [
  { value: "all", label: "全期間" },
  { value: "year", label: "今年" },
  { value: "month", label: "今月" },
  { value: "day", label: "日別" },
];

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function getLastSevenDays() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

function formatDayLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

export default function BroadcasterDetail() {
  const { name } = useParams();
  const streamer = decodeURIComponent(name);
  const [period, setPeriod] = useState("all"); // all | year | month | day
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const { clips, tag, totalViews, clipCount, loading, error } = useBroadcasterProfile(
    streamer,
    50,
    period,
    period === "day" ? selectedDay : undefined,
  );

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginLeft: 10 }}>読み込み中…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        a { cursor: pointer; text-decoration: none; }
      `}</style>

      <Link to="/broadcasters" style={styles.backLink}>
        <ArrowLeft size={14} />
        配信者一覧に戻る
      </Link>

      <header style={styles.header}>
        <div style={styles.nameRow}>
          <h1 className="clip-title-font" style={styles.name}>
            {streamer}
          </h1>
          {tag && <span style={styles.tagBadge}>{tag}</span>}
        </div>
        <p style={styles.stats}>
          合計 {formatViews(totalViews)}回視聴 ・ クリップ{clipCount}件
        </p>
      </header>

      <div style={styles.periodTabs}>
        {PERIOD_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setPeriod(t.value)}
            style={period === t.value ? styles.tabActive : styles.tab}
          >
            {t.label}
          </button>
        ))}
      </div>

      {period === "day" && (
        <div style={styles.dayTabs}>
          {getLastSevenDays().map((d) => (
            <button
              key={d.toDateString()}
              onClick={() => setSelectedDay(d)}
              style={isSameDay(d, selectedDay) ? styles.tabActive : styles.tab}
            >
              {formatDayLabel(d)}
            </button>
          ))}
        </div>
      )}

      {error && <p style={styles.errorText}>{error}</p>}

      <div style={styles.list}>
        {clips.length === 0 && !error && (
          <div style={styles.emptyState}>この配信者のクリップはまだありません。</div>
        )}
        {clips.map((clip, i) => (
          <Link key={clip.id} to={`/clips/${clip.id}`} style={styles.row}>
            <div style={styles.rankNum}>{String(i + 1).padStart(2, "0")}</div>
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
                {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴
              </p>
            </div>
          </Link>
        ))}
      </div>
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
    minHeight: "100vh",
    background: "#14141B",
    color: "#8A8A99",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Inter, sans-serif",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#8A8A99",
    fontSize: 12.5,
    marginBottom: 18,
  },
  header: { borderBottom: "1px solid #24242F", paddingBottom: 18, marginBottom: 18 },
  periodTabs: { display: "flex", gap: 6, marginBottom: 12 },
  dayTabs: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 },
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
  nameRow: { display: "flex", alignItems: "center", gap: 10 },
  name: { fontSize: 24, fontWeight: 600, margin: 0 },
  tagBadge: {
    fontSize: 11.5,
    color: "#AFA9EC",
    background: "#241F3A",
    borderRadius: 12,
    padding: "3px 10px",
  },
  stats: { fontSize: 13, color: "#6B6B78", margin: "6px 0 0" },
  errorText: { color: "#F0997B", fontSize: 13, marginBottom: 12 },
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
  },
  rankNum: { fontSize: 14, fontWeight: 600, color: "#565660", width: 24, flexShrink: 0 },
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
  metaLine: { fontSize: 12, color: "#6B6B78", margin: 0 },
};
