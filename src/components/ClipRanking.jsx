import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, ThumbsDown, MessageCircle, Send, Loader2, Flag, Search, UserPlus, X, ChevronLeft, ChevronRight, Users, ListChecks } from "lucide-react";
import {
  useClips,
  useReactions,
  useComments,
  useBroadcasterSearch,
  useBroadcasterRequest,
  useCommentReport,
  useBroadcasterAvatars,
} from "../lib/use-clip-ranking";

const PERIOD_TABS = [
  { value: "all", label: "全期間" },
  { value: "year", label: "今年" },
  { value: "month", label: "今月" },
  { value: "day", label: "日別" },
];

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 今日を含む過去7日分の日付を新しい順で返す（日別タブの選択肢用） */
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

const TAG_COLORS = {
  coral: { bg: "#3A241D", text: "#F0997B" },
  amber: { bg: "#3A2E14", text: "#EF9F27" },
  teal: { bg: "#153029", text: "#5DCAA5" },
  purple: { bg: "#241F3A", text: "#AFA9EC" },
  pink: { bg: "#331A24", text: "#ED93B1" },
};
const TAG_COLOR_KEYS = Object.keys(TAG_COLORS);

// ゲーム名からタグ色を決定的に選ぶ（バックエンドは色情報を持たないため）
function getTagColor(game) {
  const key = game || "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TAG_COLORS[TAG_COLOR_KEYS[hash % TAG_COLOR_KEYS.length]];
}

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

function ClipRow({
  clip,
  likes,
  dislikes,
  myVote,
  onVote,
  commentsActive,
  onOpenComments,
  onCommentsUpdate,
  avatarUrl,
}) {
  // このクリップのコメント購読はここ1箇所のみで行い、サイドパネル用のデータは
  // onCommentsUpdate経由で親に伝える（同一clipへの二重購読はSupabase Realtimeがエラーになるため）
  const commentsState = useComments(clip.id);
  const { comments, submit, submitting, error } = commentsState;
  const [playerOpen, setPlayerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    onCommentsUpdate(clip.id, { comments, submit, submitting, error });
  }, [clip.id, comments, submit, submitting, error, onCommentsUpdate]);

  const tagStyle = getTagColor(clip.game);

  return (
    <div
      style={{
        ...styles.row,
        cursor: "pointer",
        background: hovered ? "#22222E" : styles.row.background,
        border: hovered ? "1px solid #33333F" : styles.row.border,
      }}
      onClick={() => onOpenComments(clip.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.rowMain}>
        <div
          className="clip-rank-num"
          style={{
            ...styles.rankNum,
            color: clip.rank === 1 ? "#FFC857" : "#565660",
          }}
        >
          {String(clip.rank).padStart(2, "0")}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setPlayerOpen((o) => !o);
          }}
          style={{
            ...styles.thumb,
            background: clip.thumbnail_url ? "transparent" : tagStyle.bg,
            color: tagStyle.text,
            padding: clip.thumbnail_url ? 0 : styles.thumb.padding,
            overflow: "hidden",
            border: "none",
          }}
          aria-label={playerOpen ? "動画を閉じる" : "動画を再生"}
        >
          {clip.thumbnail_url ? (
            <img
              src={clip.thumbnail_url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            clip.game
          )}
        </button>

        <div style={styles.infoCol}>
          <Link
            to={`/clips/${clip.id}`}
            style={styles.clipTitleLink}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="clip-title-font" style={styles.clipTitle}>{clip.title}</p>
          </Link>
          <p style={styles.metaLine}>
            <Link
              to={`/broadcasters/${encodeURIComponent(clip.streamer)}`}
              style={styles.streamerLink}
              onClick={(e) => e.stopPropagation()}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" style={styles.rowAvatar} />
              ) : (
                <span style={styles.rowAvatarFallback} />
              )}
              {clip.streamer}
            </Link>
            {" ・ ▶ "}{formatViews(clip.view_count)}回視聴
          </p>
        </div>

        <div style={styles.actions}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVote(clip.id, "like");
            }}
            style={{
              ...styles.actionBtn,
              color: myVote === "like" ? "#FF4D6D" : "#8A8A99",
              borderColor: myVote === "like" ? "#FF4D6D55" : "#2E2E3A",
            }}
            aria-label="いいね"
          >
            <Heart size={15} fill={myVote === "like" ? "#FF4D6D" : "none"} />
            {likes}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVote(clip.id, "dislike");
            }}
            style={{
              ...styles.actionBtn,
              color: myVote === "dislike" ? "#4DD8FF" : "#8A8A99",
              borderColor: myVote === "dislike" ? "#4DD8FF55" : "#2E2E3A",
            }}
            aria-label="よくないね"
          >
            <ThumbsDown size={15} fill={myVote === "dislike" ? "#4DD8FF" : "none"} />
            {dislikes}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenComments(clip.id);
            }}
            style={{
              ...styles.actionBtn,
              color: commentsActive ? "#EDEDF2" : "#8A8A99",
              borderColor: commentsActive ? "#3A3A48" : "#2E2E3A",
            }}
            aria-label="コメントを開く"
          >
            <MessageCircle size={15} />
            {comments.length}
          </button>
        </div>
      </div>

      {playerOpen && (
        <div style={styles.playerPanel} onClick={(e) => e.stopPropagation()}>
          <iframe
            src={`https://clips.twitch.tv/embed?clip=${clip.id}&parent=${window.location.hostname}&autoplay=false`}
            style={styles.playerFrame}
            allowFullScreen
            title={clip.title}
          />
        </div>
      )}
    </div>
  );
}

/**
 * クリップ一覧の右側に固定表示するコメントサイドパネル。
 * コメントの購読はClipRow側で行っているため、ここでは親から渡されたデータを表示するだけ
 * （同一clipへの二重購読を避けるため、自前でuseCommentsは呼ばない）。
 */
function CommentSidebar({ clip, commentsData, nameDraft, onNameDraftChange, reportedIds, onReport, onClose }) {
  const { comments, submit, submitting, error } = commentsData ?? {
    comments: [],
    submit: () => {},
    submitting: false,
    error: null,
  };
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");

  function handleSubmit() {
    const body = draft.trim();
    if (!body) {
      setLocalError("コメントを入力してください。");
      return;
    }
    setLocalError("");
    submit(body, nameDraft);
    setDraft("");
  }

  return (
    <div style={styles.commentSidebar}>
      <div style={styles.commentSidebarHeader}>
        <p style={styles.commentSidebarTitle}>{clip.title}</p>
        <button onClick={onClose} style={styles.closeBtn} aria-label="コメントを閉じる">
          <X size={18} />
        </button>
      </div>

      <div style={styles.commentList}>
        {comments.length === 0 && (
          <p style={styles.noComment}>まだコメントはありません。最初のコメントを投稿してみましょう。</p>
        )}
        {comments.map((c) => {
          const alreadyReported = reportedIds.has(c.id);
          return (
            <div key={c.id} style={styles.commentItem}>
              <div style={styles.commentHead}>
                <span style={styles.commentName}>{c.display_name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={styles.commentTime}>{timeAgo(new Date(c.created_at).getTime())}</span>
                  <button
                    onClick={() => onReport(c.id)}
                    disabled={alreadyReported}
                    style={{
                      ...styles.reportBtn,
                      color: alreadyReported ? "#4A4A54" : "#6B6B78",
                    }}
                    aria-label="コメントを通報"
                    title={alreadyReported ? "通報済み" : "不適切なコメントを通報"}
                  >
                    <Flag size={12} />
                  </button>
                </div>
              </div>
              <p style={styles.commentBody}>{c.body}</p>
            </div>
          );
        })}
      </div>

      <div style={styles.commentForm}>
        <input
          value={nameDraft}
          onChange={(e) => onNameDraftChange(e.target.value)}
          placeholder="名前（任意・空欄なら匿名）"
          style={styles.nameInput}
          maxLength={20}
        />
        <div style={styles.commentInputRow}>
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (localError) setLocalError("");
            }}
            placeholder="このクリップについてコメント…"
            style={styles.commentInput}
            rows={2}
            maxLength={280}
          />
          <button
            onClick={handleSubmit}
            style={styles.sendBtn}
            aria-label="コメントを送信"
            disabled={submitting}
          >
            <Send size={15} />
          </button>
        </div>
        {(localError || error) && <p style={styles.commentErrorText}>{localError || error}</p>}
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function ClipRanking() {
  const [period, setPeriod] = useState("day"); // all | year | month | day
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [page, setPage] = useState(1);
  const { clips, loading, error: clipsError, totalCount } = useClips(
    PAGE_SIZE,
    period,
    period === "day" ? selectedDay : undefined,
    page,
  );
  const clipIds = useMemo(() => clips.map((c) => c.id), [clips]);
  const { counts, myVotes, vote } = useReactions(clipIds);
  const streamerNames = useMemo(() => [...new Set(clips.map((c) => c.streamer))], [clips]);
  const avatars = useBroadcasterAvatars(streamerNames);

  const [activeCommentClipId, setActiveCommentClipId] = useState(null);
  const [commentsDataByClip, setCommentsDataByClip] = useState({});
  const [nameDraft, setNameDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [requestDraft, setRequestDraft] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());

  const { results: broadcasterResults, searching: broadcasterSearching } = useBroadcasterSearch(searchQuery);
  const { request: requestBroadcaster, submitting: requesting, result: requestResult } = useBroadcasterRequest();
  const { report: reportComment } = useCommentReport();

  // 期間・日付・検索条件が変わったら1ページ目に戻す（違うページに条件が引き継がれて空表示になるのを防ぐ）
  useEffect(() => {
    setPage(1);
  }, [period, selectedDay, searchQuery]);

  function toggleComments(clipId) {
    setActiveCommentClipId((prev) => (prev === clipId ? null : clipId));
  }

  const handleCommentsUpdate = useCallback((clipId, data) => {
    setCommentsDataByClip((prev) => ({ ...prev, [clipId]: data }));
  }, []);

  function handleReport(commentId) {
    if (reportedIds.has(commentId)) return; // 二重通報を防止
    setReportedIds((prev) => new Set(prev).add(commentId));
    reportComment(commentId);
  }

  function handleBroadcasterRequest() {
    const name = requestDraft.trim();
    if (!name) return;
    requestBroadcaster(name);
  }

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginLeft: 10 }}>読み込み中…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const rankedClips = clips.map((c, i) => ({ ...c, rank: i + 1 }));
  const visibleClips = rankedClips.filter((c) => {
    if (searchQuery.trim() && !c.streamer.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
      return false;
    }
    return true;
  });
  const showNoResultRequest = searchQuery.trim() && visibleClips.length === 0;

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        .clip-rank-num { font-family: 'Oswald', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button { cursor: pointer; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <header style={styles.header}>
        <div>
          <div style={styles.eyebrowRow}>
            <span style={styles.liveDot} />
            <span style={styles.eyebrow}>デイリークリップランキング</span>
          </div>
          <h1 className="clip-title-font" style={styles.h1}>
            Twitchクリップ掲示板
          </h1>
          <p style={styles.tagline}>視聴回数順のクリップランキング</p>
        </div>
        <div style={styles.headerControls}>
          <div style={styles.headerLinks}>
            <Link to="/broadcasters" style={styles.broadcastersLink}>
              <Users size={13} />
              配信者一覧
            </Link>
            <Link to="/my-reactions" style={styles.broadcastersLink}>
              <ListChecks size={13} />
              評価した動画
            </Link>
          </div>
          <div style={styles.searchBox}>
            <Search size={14} color="#6B6B78" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="配信者名で検索…"
              style={styles.searchInput}
            />
          </div>
        </div>
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

      {clipsError && <div style={styles.errorBanner}>{clipsError}</div>}

      <div style={styles.list}>
        {visibleClips.length === 0 && !showNoResultRequest && (
          <div style={styles.emptyState}>まだクリップがありません。</div>
        )}
        {showNoResultRequest && (
          <div style={styles.requestCard}>
            <div style={styles.requestHead}>
              <UserPlus size={16} color="#FF4D6D" />
              <p style={styles.requestTitle}>「{searchQuery}」に一致する配信者は見つかりませんでした</p>
            </div>
            {broadcasterSearching ? (
              <p style={styles.requestSub}>検索中…</p>
            ) : broadcasterResults.length > 0 ? (
              <p style={styles.requestSub}>
                「{searchQuery}」は登録済みの配信者です。現在ランキング対象のクリップはありません。
              </p>
            ) : (
              <>
                <p style={styles.requestSub}>
                  まだ登録されていない配信者かもしれません。Twitchのチャンネル名を入力してリクエストできます。
                </p>
                <div style={styles.requestForm}>
                  <input
                    value={requestDraft}
                    onChange={(e) => setRequestDraft(e.target.value)}
                    placeholder="Twitchのチャンネル名（例: shroud）"
                    style={styles.requestInput}
                    maxLength={30}
                  />
                  <button onClick={handleBroadcasterRequest} style={styles.requestBtn} disabled={requesting}>
                    {requesting ? "送信中…" : "登録をリクエスト"}
                  </button>
                </div>
                {requestResult && (
                  <p
                    style={{
                      ...styles.requestMessage,
                      color: requestResult.ok ? "#5DCAA5" : "#F0997B",
                    }}
                  >
                    {requestResult.message}
                  </p>
                )}
                <p style={styles.requestNote}>
                  ※ Twitch APIで実在確認が取れた配信者のみ自動的にランキングへ反映されます。
                </p>
              </>
            )}
          </div>
        )}
        {visibleClips.map((clip) => {
          const stats = counts[clip.id] || { likes: 0, dislikes: 0 };
          return (
            <ClipRow
              key={clip.id}
              clip={clip}
              likes={stats.likes}
              dislikes={stats.dislikes}
              myVote={myVotes[clip.id]}
              onVote={vote}
              commentsActive={activeCommentClipId === clip.id}
              onOpenComments={toggleComments}
              onCommentsUpdate={handleCommentsUpdate}
              avatarUrl={avatars[clip.streamer]}
            />
          );
        })}
      </div>

      {!searchQuery.trim() && totalCount > PAGE_SIZE && (
        <div style={styles.pagination}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
            aria-label="前のページ"
          >
            <ChevronLeft size={15} />
          </button>
          <span style={styles.pageInfo}>
            {page} / {Math.ceil(totalCount / PAGE_SIZE)}
          </span>
          <button
            onClick={() => setPage((p) => (p * PAGE_SIZE < totalCount ? p + 1 : p))}
            disabled={page * PAGE_SIZE >= totalCount}
            style={{ ...styles.pageBtn, opacity: page * PAGE_SIZE >= totalCount ? 0.4 : 1 }}
            aria-label="次のページ"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      <footer style={styles.footer}>
        いいね・よくないね・コメントはすべてのブラウザで共有されます。
      </footer>

      {activeCommentClipId && (() => {
        const activeClip = clips.find((c) => c.id === activeCommentClipId);
        if (!activeClip) return null;
        return (
          <CommentSidebar
            key={activeClip.id}
            clip={activeClip}
            commentsData={commentsDataByClip[activeClip.id]}
            nameDraft={nameDraft}
            onNameDraftChange={setNameDraft}
            reportedIds={reportedIds}
            onReport={handleReport}
            onClose={() => setActiveCommentClipId(null)}
          />
        );
      })()}
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
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 16,
    borderBottom: "1px solid #24242F",
    paddingBottom: 20,
    marginBottom: 20,
  },
  headerControls: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  headerLinks: { display: "flex", gap: 14 },
  broadcastersLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "#8A8A99",
    fontSize: 12.5,
    textDecoration: "none",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "6px 10px",
    width: 220,
  },
  searchInput: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#EDEDF2",
    fontSize: 13,
    width: "100%",
  },
  eyebrowRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#FF4D6D",
    display: "inline-block",
  },
  eyebrow: { fontSize: 12, color: "#9797A6", letterSpacing: 0.3 },
  h1: { fontSize: 30, fontWeight: 600, margin: "0 0 6px", letterSpacing: 0.5 },
  tagline: { fontSize: 13, color: "#6B6B78", margin: 0 },
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
  periodTabs: { display: "flex", gap: 6, marginBottom: 16 },
  dayTabs: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    marginTop: 20,
  },
  pageBtn: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    color: "#EDEDF2",
    borderRadius: 8,
    padding: "6px 10px",
    display: "flex",
    alignItems: "center",
  },
  pageInfo: { fontSize: 13, color: "#8A8A99" },
  errorBanner: {
    background: "#3A1D1D",
    color: "#F0997B",
    fontSize: 13,
    padding: "8px 12px",
    borderRadius: 8,
    marginBottom: 16,
  },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  emptyState: {
    color: "#6B6B78",
    fontSize: 14,
    padding: "40px 0",
    textAlign: "center",
  },
  requestCard: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: "18px 20px",
  },
  requestHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  requestTitle: { fontSize: 14.5, fontWeight: 500, margin: 0, color: "#EDEDF2" },
  requestSub: { fontSize: 13, color: "#9797A6", margin: "0 0 12px" },
  requestForm: { display: "flex", gap: 8 },
  requestInput: {
    flex: 1,
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13.5,
    color: "#EDEDF2",
  },
  requestBtn: {
    background: "#FF4D6D",
    border: "none",
    borderRadius: 6,
    color: "#1C1417",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  requestMessage: { fontSize: 12.5, margin: "10px 0 0" },
  requestNote: { fontSize: 11.5, color: "#4E4E58", margin: "12px 0 0", lineHeight: 1.5 },
  row: {
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "14px 16px",
    transition: "background-color 0.15s ease, border-color 0.15s ease",
  },
  rowMain: { display: "flex", alignItems: "center", gap: 14 },
  rankNum: { fontSize: 26, fontWeight: 600, width: 34, flexShrink: 0 },
  thumb: {
    width: 64,
    height: 44,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 600,
    textAlign: "center",
    padding: "2px 4px",
    flexShrink: 0,
  },
  infoCol: { flex: 1, minWidth: 0 },
  clipTitleLink: { textDecoration: "none", color: "inherit" },
  streamerLink: {
    color: "#EDEDF2",
    textDecoration: "none",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    verticalAlign: "middle",
  },
  rowAvatar: { width: 16, height: 16, borderRadius: "50%", objectFit: "cover" },
  rowAvatarFallback: { width: 16, height: 16, borderRadius: "50%", background: "#20202B", display: "inline-block" },
  clipTitle: {
    fontSize: 15,
    fontWeight: 500,
    margin: "0 0 4px",
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  metaLine: { fontSize: 12.5, color: "#6B6B78", margin: 0 },
  actions: { display: "flex", gap: 6, flexShrink: 0 },
  actionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "1px solid",
    borderRadius: 8,
    padding: "6px 9px",
    fontSize: 12.5,
  },
  playerPanel: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #24242F",
  },
  playerFrame: {
    width: "100%",
    aspectRatio: "16 / 9",
    border: "none",
    borderRadius: 8,
  },
  commentSidebar: {
    position: "fixed",
    top: 0,
    right: 0,
    height: "100vh",
    width: "min(380px, 100vw)",
    background: "#1C1C26",
    borderLeft: "1px solid #2E2E3A",
    boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    padding: 20,
  },
  commentSidebarHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 14,
    marginBottom: 14,
    borderBottom: "1px solid #24242F",
  },
  commentSidebarTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: "#EDEDF2",
    margin: 0,
    lineHeight: 1.4,
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#8A8A99",
    padding: 2,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  commentList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 14,
  },
  noComment: { fontSize: 13, color: "#6B6B78", margin: 0 },
  commentItem: { background: "#20202B", borderRadius: 8, padding: "8px 10px" },
  commentHead: { display: "flex", justifyContent: "space-between", marginBottom: 3 },
  commentName: { fontSize: 12.5, fontWeight: 500, color: "#C4C4D0" },
  commentTime: { fontSize: 11.5, color: "#5A5A66" },
  commentBody: { fontSize: 13.5, margin: 0, lineHeight: 1.5, color: "#DADAE2" },
  reportBtn: {
    background: "transparent",
    border: "none",
    padding: 2,
    display: "flex",
    alignItems: "center",
  },
  commentErrorText: { fontSize: 12, color: "#F0997B", margin: "2px 0 0" },
  commentForm: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  nameInput: {
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12.5,
    color: "#EDEDF2",
    width: "45%",
  },
  commentInputRow: { display: "flex", gap: 8, alignItems: "flex-end" },
  commentInput: {
    flex: 1,
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13.5,
    color: "#EDEDF2",
    resize: "none",
  },
  sendBtn: {
    background: "#FF4D6D",
    border: "none",
    borderRadius: 6,
    color: "#1C1417",
    padding: "9px 11px",
    display: "flex",
    alignItems: "center",
  },
  footer: {
    marginTop: 28,
    fontSize: 11.5,
    color: "#4E4E58",
    textAlign: "center",
  },
};
