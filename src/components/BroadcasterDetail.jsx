import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, X, Plus, MessageSquare } from "lucide-react";
import { useBroadcasterProfile, useBroadcasterTags } from "../lib/use-clip-ranking";
import { useDocumentMeta } from "../lib/use-document-meta";
import { useSmartBack } from "../lib/use-smart-back";
import Footer from "./Footer";
import ShareButtons from "./ShareButtons";

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
  const goBack = useSmartBack("/broadcasters");
  const [period, setPeriod] = useState("all"); // all | year | month | day
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const { clips, tag, avatarUrl, totalViews, clipCount, loading, error } = useBroadcasterProfile(
    streamer,
    50,
    period,
    period === "day" ? selectedDay : undefined,
  );
  const { tags: myTags, addTag, removeTag } = useBroadcasterTags(streamer);
  const [tagDraft, setTagDraft] = useState("");

  useDocumentMeta({
    title: !loading ? `${streamer}のクリップ一覧 | クリスレ` : null,
    description: !loading
      ? `${streamer}のTwitchクリップをランキングでチェック。合計${formatViews(totalViews)}回視聴・クリップ${clipCount}件。`
      : null,
    image: avatarUrl,
    path: `/broadcasters/${encodeURIComponent(streamer)}`,
  });

  function handleAddTag() {
    const trimmed = tagDraft.trim();
    if (!trimmed) return;
    addTag(trimmed);
    setTagDraft("");
  }

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <Loader2 size={22} style={{ animation: "cv-spin 1s linear infinite" }} />
        <span style={{ marginLeft: 10 }}>読み込み中…</span>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        a { cursor: pointer; text-decoration: none; }
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

      <button onClick={goBack} style={styles.backLink}>
        <ArrowLeft size={14} />
        配信者一覧に戻る
      </button>

      <header style={styles.header}>
        <div style={styles.headerRow}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" style={styles.avatar} />
          ) : (
            <div style={styles.avatarFallback} />
          )}
          <div>
            <div style={styles.nameRow}>
              <h1 className="clip-title-font" style={styles.name}>
                {streamer}
              </h1>
              {tag && <span style={styles.tagBadge}>{tag}</span>}
            </div>
            <p style={styles.stats}>
              合計 {formatViews(totalViews)}回視聴 ・ クリップ{clipCount}件
            </p>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <ShareButtons
            url={`https://kurisure.jp/broadcasters/${encodeURIComponent(streamer)}`}
            text={`${streamer}のクリップ一覧｜クリスレ`}
          />
        </div>
      </header>

      <div style={styles.myTagsSection}>
        <p style={styles.myTagsLabel}>マイタグ（自分だけに表示・お気に入りやイベント参加者などの絞り込みに使えます）</p>
        <div style={styles.myTagsRow}>
          {myTags.map((t) => (
            <span key={t} style={styles.myTagChip}>
              {t}
              <Link
                to={`/threads?new=${encodeURIComponent(t)}`}
                style={styles.myTagThreadLink}
                aria-label={`「${t}」についてスレを立てる/見る`}
                title="このタグについてスレを立てる・見る"
              >
                <MessageSquare size={11} />
              </Link>
              <button
                onClick={() => removeTag(t)}
                style={styles.myTagRemoveBtn}
                aria-label={`「${t}」タグを削除`}
                title="タグを削除"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <div style={styles.myTagInputRow}>
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
              }}
              placeholder="タグを追加…"
              style={styles.myTagInput}
              maxLength={20}
            />
            <button onClick={handleAddTag} style={styles.myTagAddBtn} aria-label="タグを追加">
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>

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
          <Link
            key={clip.id}
            className="cv-list-row cv-fade-in-up"
            to={`/clips/${clip.id}`}
            style={{ ...styles.row, animationDelay: `${Math.min(i, 12) * 40}ms` }}
          >
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

      <Footer />
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 32px 40px",
    maxWidth: 1200,
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
    fontFamily: "inherit",
    textDecoration: "none",
    background: "none",
    border: "none",
    padding: 0,
    marginBottom: 18,
  },
  header: { borderBottom: "1px solid #24242F", paddingBottom: 18, marginBottom: 18 },
  headerRow: { display: "flex", alignItems: "center", gap: 16 },
  avatar: { width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarFallback: { width: 64, height: 64, borderRadius: "50%", background: "#20202B", flexShrink: 0 },
  myTagsSection: { marginBottom: 18 },
  myTagsLabel: { fontSize: 11.5, color: "#6B6B78", margin: "0 0 8px" },
  myTagsRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  myTagChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 500,
    color: "#EDEDF2",
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 20,
    padding: "5px 6px 5px 12px",
  },
  myTagThreadLink: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#2A2A36",
    borderRadius: "50%",
    width: 16,
    height: 16,
    color: "#AFA9EC",
    flexShrink: 0,
    textDecoration: "none",
  },
  myTagRemoveBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#2A2A36",
    border: "none",
    borderRadius: "50%",
    width: 16,
    height: 16,
    color: "#9797A6",
    flexShrink: 0,
  },
  myTagInputRow: { display: "flex", alignItems: "center", gap: 6 },
  myTagInput: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 12.5,
    color: "#EDEDF2",
    width: 140,
  },
  myTagAddBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: "50%",
    width: 26,
    height: 26,
    color: "#C4C4D0",
    flexShrink: 0,
  },
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
