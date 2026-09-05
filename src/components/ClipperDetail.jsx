import { useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, ExternalLink } from "lucide-react";
import { useClipperProfile } from "../lib/use-clip-ranking";
import { useDocumentMeta } from "../lib/use-document-meta";
import { useSmartBack } from "../lib/use-smart-back";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";
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

// 期間・日別選択中の日付をURLの?period/?dayクエリに保存するための変換（2026-09-05、
// ClipRanking.jsxで対応した「ブラウザバックで期間指定が失われる」不具合と同じ修正をこのページにも適用）。
// toISOString()はUTC基準になり日付がズレうるため使わず、ローカルの年月日フィールドから直接
// 文字列化・復元する。
function formatDayParam(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDayParam(value) {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

export default function ClipperDetail() {
  const { creatorId } = useParams();
  const goBack = useSmartBack("/clippers");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriodParam = searchParams.get("period");
  const initialPeriod = PERIOD_TABS.some((t) => t.value === initialPeriodParam) ? initialPeriodParam : "all";
  const [period, setPeriod] = useState(initialPeriod);
  const [selectedDay, setSelectedDay] = useState(() => parseDayParam(searchParams.get("day")) ?? new Date());

  // 期間・日別選択をstateと同時にURLへも反映する（ClipRanking.jsxの?period/?day同期と同じパターン）。
  function syncPeriodParams(nextPeriod, nextDay) {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (nextPeriod === "all") next.delete("period");
        else next.set("period", nextPeriod);
        if (nextPeriod === "day") next.set("day", formatDayParam(nextDay));
        else next.delete("day");
        return next;
      },
      { replace: true },
    );
  }

  function handlePeriodSelect(value) {
    setPeriod(value);
    syncPeriodParams(value, selectedDay);
  }

  function handleDaySelect(d) {
    setSelectedDay(d);
    syncPeriodParams(period, d);
  }

  const { clips, creatorName, avatarUrl, totalViews, clipCount, rank, loading, error } = useClipperProfile(
    creatorId,
    50,
    period,
    period === "day" ? selectedDay : undefined,
  );

  useDocumentMeta({
    title: !loading && creatorName ? `${creatorName}のクリップ一覧 | クリスレ` : null,
    description:
      !loading && creatorName
        ? `クリップ職人${creatorName}${rank ? `（総合${rank}位）` : ""}が作ったクリップ一覧。合計${formatViews(totalViews)}回視聴・クリップ${clipCount}件。`
        : null,
    image: avatarUrl,
    path: `/clippers/${encodeURIComponent(creatorId)}`,
  });

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
      <BackgroundGlow />
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
        クリップ職人ランキングに戻る
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
                {creatorName || "不明なクリップ職人"}
              </h1>
              {rank && <span style={styles.rankBadge}>総合{rank}位</span>}
              {creatorName && (
                <a
                  href={`https://www.twitch.tv/${encodeURIComponent(creatorName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.twitchLink}
                  aria-label="Twitchで見る"
                >
                  <ExternalLink size={13} />
                  Twitchで見る
                </a>
              )}
            </div>
            <p style={styles.stats}>
              合計 {formatViews(totalViews)}回視聴 ・ クリップ{clipCount}件
            </p>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <ShareButtons
            url={`https://kurisure.jp/clippers/${encodeURIComponent(creatorId)}`}
            text={`${creatorName || "クリップ職人"}のクリップ一覧｜クリスレ`}
          />
        </div>
      </header>

      <div style={styles.periodTabs}>
        {PERIOD_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => handlePeriodSelect(t.value)}
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
              onClick={() => handleDaySelect(d)}
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
          <div style={styles.emptyState}>この期間に作られたクリップはまだありません。</div>
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
                {clip.streamer} ・ {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴
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
  nameRow: { display: "flex", alignItems: "center", gap: 12 },
  name: { fontSize: 24, fontWeight: 600, margin: 0 },
  rankBadge: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "#1C1417",
    background: "#FFC857",
    borderRadius: 12,
    padding: "3px 10px",
  },
  twitchLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "#8A8A99",
    fontSize: 12.5,
    border: "1px solid #2E2E3A",
    borderRadius: 20,
    padding: "4px 10px",
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
