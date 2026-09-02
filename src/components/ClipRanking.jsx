import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, ThumbsDown, MessageCircle, Send, Loader2, Flag, Search, UserPlus, X, ChevronLeft, ChevronRight, Users, ListChecks, Film, Star, CornerUpLeft, Scissors } from "lucide-react";
import {
  useClips,
  useReactions,
  useFavorites,
  useFavoriteCounts,
  useComments,
  useBroadcasterSearch,
  useBroadcasterRequest,
  useCommentReport,
  useBroadcasterAvatars,
  useClipperRanks,
  useTopClippersByPeriod,
} from "../lib/use-clip-ranking";
import { REACTIONS_ENABLED } from "../lib/feature-flags";

const PERIOD_TABS = [
  { value: "all", label: "全期間" },
  { value: "year", label: "今年" },
  { value: "month", label: "今月" },
  { value: "day", label: "日別" },
];

const SORT_OPTIONS = [
  { value: "views", label: "視聴回数順" },
  { value: "newest", label: "新着順" },
  ...(REACTIONS_ENABLED ? [{ value: "likes", label: "いいね順" }] : []),
  { value: "favorites", label: "お気に入り数順" },
  { value: "comments", label: "コメント数順" },
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

const RANK_ACCENTS = { 1: "#FFC857", 2: "#C9CEDA", 3: "#D98E5D" };

// 上位3位だけ金・銀・銅のアクセントカラーを付ける
function getRankAccent(rank) {
  return RANK_ACCENTS[rank] || null;
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
  isFavorited,
  onToggleFavorite,
  favoriteCount,
  commentsActive,
  onOpenComments,
  onCommentsUpdate,
  avatarUrl,
  clipperRank,
}) {
  // このクリップのコメント購読はここ1箇所のみで行い、サイドパネル用のデータは
  // onCommentsUpdate経由で親に伝える（同一clipへの二重購読はSupabase Realtimeがエラーになるため）
  const commentsState = useComments(clip.id);
  const { comments, submit, submitting, error } = commentsState;
  const [playerOpen, setPlayerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  // クリックのたびに1増やし、keyに使うことでアイコンを再マウントさせ、cv-popのバウンド
  // アニメーションを毎回リプレイさせる（0のままの初期表示ではアニメーションさせない）
  const [likeBump, setLikeBump] = useState(0);
  const [dislikeBump, setDislikeBump] = useState(0);
  const [favBump, setFavBump] = useState(0);

  useEffect(() => {
    onCommentsUpdate(clip.id, { comments, submit, submitting, error });
  }, [clip.id, comments, submit, submitting, error, onCommentsUpdate]);

  const tagStyle = getTagColor(clip.game);
  const rankAccent = getRankAccent(clip.rank);

  return (
    <div
      className="cv-fade-in-up"
      style={{
        ...styles.row,
        cursor: "pointer",
        background: hovered ? "#22222E" : styles.row.background,
        borderColor: hovered ? "#33333F" : rankAccent ? `${rankAccent}55` : styles.row.borderColor,
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,0.28)" : "none",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        animationDelay: `${Math.min(clip.rank - 1, 12) * 40}ms`,
      }}
      onClick={() => onOpenComments(clip.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="cv-row-main" style={styles.rowMain}>
        <div
          className="clip-rank-num"
          style={{
            ...styles.rankNum,
            color: rankAccent || "#565660",
            textShadow: rankAccent ? `0 0 14px ${rankAccent}66` : "none",
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
          {clip.creator_id && (
            <Link
              to={`/clippers/${encodeURIComponent(clip.creator_id)}`}
              style={styles.clipperLine}
              onClick={(e) => e.stopPropagation()}
            >
              <Scissors size={11} />
              {clip.creator_name}
              {clipperRank && <span style={styles.clipperRankBadge}>総合{clipperRank}位</span>}
            </Link>
          )}
        </div>

        <div className="cv-row-actions" style={styles.actions}>
          {REACTIONS_ENABLED && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLikeBump((n) => n + 1);
                  onVote(clip.id, "like");
                }}
                style={{
                  ...styles.actionBtn,
                  color: myVote === "like" ? "#FF4D6D" : "#8A8A99",
                  borderColor: myVote === "like" ? "#FF4D6D55" : "#2E2E3A",
                }}
                aria-label="いいね"
              >
                <Heart
                  key={likeBump}
                  className={likeBump > 0 ? "cv-pop" : undefined}
                  size={15}
                  fill={myVote === "like" ? "#FF4D6D" : "none"}
                />
                {likes}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDislikeBump((n) => n + 1);
                  onVote(clip.id, "dislike");
                }}
                style={{
                  ...styles.actionBtn,
                  color: myVote === "dislike" ? "#4DD8FF" : "#8A8A99",
                  borderColor: myVote === "dislike" ? "#4DD8FF55" : "#2E2E3A",
                }}
                aria-label="よくないね"
              >
                <ThumbsDown
                  key={dislikeBump}
                  className={dislikeBump > 0 ? "cv-pop" : undefined}
                  size={15}
                  fill={myVote === "dislike" ? "#4DD8FF" : "none"}
                />
                {dislikes}
              </button>
            </>
          )}
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFavBump((n) => n + 1);
              onToggleFavorite(clip.id);
            }}
            style={{
              ...styles.actionBtn,
              ...styles.favBtn,
              color: isFavorited ? "#FFC857" : "#8A8A99",
              borderColor: isFavorited ? "#FFC85755" : "#2E2E3A",
            }}
            aria-label={isFavorited ? "お気に入りから外す" : "お気に入りに追加"}
            title={isFavorited ? "お気に入りから外す" : "お気に入りに追加"}
          >
            <Star
              key={favBump}
              className={favBump > 0 ? "cv-pop" : undefined}
              size={15}
              fill={isFavorited ? "#FFC857" : "none"}
            />
            {favoriteCount > 0 ? favoriteCount : ""}
          </button>
        </div>
      </div>

      {playerOpen && (
        <div className="cv-fade-in" style={styles.playerPanel} onClick={(e) => e.stopPropagation()}>
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
  const [replyTo, setReplyTo] = useState(null); // { id, display_name } | null

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesByParent = comments.reduce((acc, c) => {
    if (!c.parent_id) return acc;
    (acc[c.parent_id] ??= []).push(c);
    return acc;
  }, {});

  function handleSubmit() {
    const body = draft.trim();
    if (!body) {
      setLocalError("コメントを入力してください。");
      return;
    }
    setLocalError("");
    submit(body, nameDraft, replyTo?.id ?? null);
    setDraft("");
    setReplyTo(null);
  }

  function renderComment(c, isReply) {
    const alreadyReported = reportedIds.has(c.id);
    return (
      <div key={c.id} style={isReply ? styles.commentItemReply : styles.commentItem}>
        <div style={styles.commentHead}>
          <span style={styles.commentName}>{c.display_name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={styles.commentTime}>{timeAgo(new Date(c.created_at).getTime())}</span>
            {!isReply && (
              <button
                onClick={() => setReplyTo({ id: c.id, display_name: c.display_name })}
                style={styles.replyBtn}
                aria-label="返信"
                title="このコメントに返信"
              >
                <CornerUpLeft size={12} />
              </button>
            )}
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
  }

  return (
    <div className="cv-slide-in-right" style={styles.commentSidebar}>
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
        {topLevel.map((c) => (
          <div key={c.id}>
            {renderComment(c, false)}
            {(repliesByParent[c.id] ?? []).map((r) => (
              <div key={r.id} style={styles.replyIndent}>
                {renderComment(r, true)}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={styles.commentForm}>
        {replyTo && (
          <div style={styles.replyBanner}>
            <span>
              <CornerUpLeft size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              {replyTo.display_name} に返信中
            </span>
            <button onClick={() => setReplyTo(null)} style={styles.replyCancelBtn} aria-label="返信をやめる">
              <X size={12} />
            </button>
          </div>
        )}
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
            placeholder={replyTo ? `${replyTo.display_name} への返信…` : "このクリップについてコメント…"}
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

const WEEKLY_RANK_ACCENTS = { 1: "#FFC857", 2: "#C9CEDA", 3: "#D98E5D" };

/** トップページに表示する週間クリップ職人ランキング（直近7日間に作られたクリップの合計視聴回数順） */
function WeeklyClipperBoard({ clippers, loading }) {
  if (!loading && clippers.length === 0) return null;

  return (
    <div style={styles.weeklyBoard}>
      <div style={styles.weeklyBoardHeader}>
        <p style={styles.weeklyBoardTitle}>
          <Scissors size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          週間クリップ職人ランキング
        </p>
        <Link to="/clippers" style={styles.weeklyBoardMore}>
          全体ランキングを見る
          <ChevronRight size={12} />
        </Link>
      </div>
      <div style={styles.weeklyBoardList}>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="cv-skeleton" style={styles.weeklyChipSkeleton} />
            ))
          : clippers.map((c, i) => {
              const rank = i + 1;
              const accent = WEEKLY_RANK_ACCENTS[rank] || null;
              return (
                <Link
                  key={c.creator_id}
                  to={`/clippers/${encodeURIComponent(c.creator_id)}`}
                  style={{
                    ...styles.weeklyChip,
                    borderColor: accent ? `${accent}55` : styles.weeklyChip.borderColor,
                  }}
                >
                  <span style={{ ...styles.weeklyChipRank, color: accent || "#8A8A99" }}>{rank}</span>
                  {c.profile_image_url ? (
                    <img src={c.profile_image_url} alt="" style={styles.weeklyChipAvatar} />
                  ) : (
                    <span style={styles.weeklyChipAvatarFallback} />
                  )}
                  <span style={styles.weeklyChipInfo}>
                    <span style={styles.weeklyChipName}>{c.creator_name}</span>
                    <span style={styles.weeklyChipViews}>{formatViews(c.total_views)}回視聴</span>
                  </span>
                </Link>
              );
            })}
      </div>
    </div>
  );
}

/** 読み込み中に表示するクリップ行の骨組み（レイアウトのガタつきを防ぐ） */
function SkeletonRow({ delay }) {
  return (
    <div style={{ ...styles.row, animationDelay: `${delay}ms` }} className="cv-fade-in-up">
      <div style={styles.rowMain}>
        <div className="cv-skeleton" style={styles.skeletonRank} />
        <div className="cv-skeleton" style={styles.skeletonThumb} />
        <div style={{ ...styles.infoCol, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="cv-skeleton" style={styles.skeletonTitle} />
          <div className="cv-skeleton" style={styles.skeletonMeta} />
        </div>
        <div style={styles.actions}>
          <div className="cv-skeleton" style={styles.skeletonPill} />
          <div className="cv-skeleton" style={styles.skeletonPill} />
          <div className="cv-skeleton" style={styles.skeletonPill} />
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function ClipRanking() {
  const [period, setPeriod] = useState("day"); // all | year | month | day
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("views"); // views | newest | likes | comments
  const { clips, loading, error: clipsError, totalCount } = useClips(
    PAGE_SIZE,
    period,
    period === "day" ? selectedDay : undefined,
    page,
    sortBy,
  );
  const clipIds = useMemo(() => clips.map((c) => c.id), [clips]);
  const { counts, myVotes, vote } = useReactions(clipIds);
  const { favoritedIds, toggle: toggleFavoriteRaw } = useFavorites(clipIds);
  const { counts: favoriteCounts, refresh: refreshFavoriteCounts } = useFavoriteCounts(clipIds);
  const toggleFavorite = useCallback(
    async (clipId) => {
      await toggleFavoriteRaw(clipId);
      refreshFavoriteCounts();
    },
    [toggleFavoriteRaw, refreshFavoriteCounts],
  );
  const streamerNames = useMemo(() => [...new Set(clips.map((c) => c.streamer))], [clips]);
  const avatars = useBroadcasterAvatars(streamerNames);
  const creatorIds = useMemo(() => clips.map((c) => c.creator_id), [clips]);
  const clipperRanks = useClipperRanks(creatorIds);

  // 週間クリップ職人ランキング（トップページ表示用）。7日間の範囲はマウント時に1度だけ固定し、
  // 毎レンダーでnew Date()を作って参照が変わり続ける（＝useEffectが無限に再発火する）のを防ぐ。
  const weekRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);
  const { clippers: weeklyClippers, loading: weeklyClippersLoading } = useTopClippersByPeriod(
    weekRange.start,
    weekRange.end,
    5,
  );

  const [activeCommentClipId, setActiveCommentClipId] = useState(null);
  const [commentsDataByClip, setCommentsDataByClip] = useState({});
  const [nameDraft, setNameDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [requestDraft, setRequestDraft] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());

  const { results: broadcasterResults, searching: broadcasterSearching } = useBroadcasterSearch(searchQuery);
  const { request: requestBroadcaster, submitting: requesting, result: requestResult } = useBroadcasterRequest();
  const { report: reportComment } = useCommentReport();

  // 期間・日付・並び替え・検索条件が変わったら1ページ目に戻す（違うページに条件が引き継がれて空表示になるのを防ぐ）
  useEffect(() => {
    setPage(1);
  }, [period, selectedDay, sortBy, searchQuery]);

  // コメントパネルを開いている間はEscで閉じられるようにし、背後のページスクロールを止める
  useEffect(() => {
    if (!activeCommentClipId) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") setActiveCommentClipId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [activeCommentClipId]);

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
        * { font-family: 'Inter', sans-serif; }
        .clip-rank-num { font-family: 'Oswald', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button { cursor: pointer; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
        @media (max-width: 640px) {
          .cv-header { flex-direction: column; align-items: flex-start; }
          .cv-header-controls { align-items: flex-start; width: 100%; }
          .cv-search-box { width: 100%; }
          .cv-row-main { flex-wrap: wrap; row-gap: 10px; }
          .cv-row-actions { flex-basis: 100%; justify-content: flex-end; }
        }
      `}</style>

      <header className="cv-header" style={styles.header}>
        <div>
          <div style={styles.eyebrowRow}>
            <span className="cv-live-dot" style={styles.liveDot} />
            <span style={styles.eyebrow}>デイリークリップランキング</span>
          </div>
          <h1 className="clip-title-font" style={styles.h1}>
            Twitchクリップ掲示板
          </h1>
          <p style={styles.tagline}>視聴回数順のクリップランキング</p>
        </div>
        <div className="cv-header-controls" style={styles.headerControls}>
          <div style={styles.headerLinks}>
            <Link to="/broadcasters" style={styles.broadcastersLink}>
              <Users size={13} />
              配信者一覧
            </Link>
            <Link to="/clippers" style={styles.broadcastersLink}>
              <Scissors size={13} />
              クリップ職人
            </Link>
            {REACTIONS_ENABLED && (
              <Link to="/my-reactions" style={styles.broadcastersLink}>
                <ListChecks size={13} />
                評価した動画
              </Link>
            )}
            <Link to="/favorites" style={styles.broadcastersLink}>
              <Star size={13} />
              お気に入り
            </Link>
          </div>
          <div className="cv-search-box" style={styles.searchBox}>
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

      <WeeklyClipperBoard clippers={weeklyClippers} loading={weeklyClippersLoading} />

      <div className="cv-ranking-controls" style={styles.rankingControlsRow}>
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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={styles.sortSelect}
          aria-label="並び替え"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
        {loading && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} delay={i * 40} />
            ))}
          </>
        )}
        {!loading && visibleClips.length === 0 && !showNoResultRequest && (
          <div style={styles.emptyState}>
            <Film size={26} color="#3E3E4A" style={{ marginBottom: 10 }} />
            <p style={{ margin: 0 }}>まだクリップがありません。</p>
          </div>
        )}
        {!loading && showNoResultRequest && (
          <div style={styles.requestCard}>
            <div style={styles.requestHead}>
              <UserPlus size={16} color="#FF4D6D" />
              <p style={styles.requestTitle}>「{searchQuery}」に一致する配信者は見つかりませんでした</p>
            </div>
            {broadcasterSearching ? (
              <p style={{ ...styles.requestSub, display: "flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={13} style={{ animation: "cv-spin 1s linear infinite" }} />
                検索中…
              </p>
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
        {!loading &&
          visibleClips.map((clip) => {
            const stats = counts[clip.id] || { likes: 0, dislikes: 0 };
            return (
              <ClipRow
                key={clip.id}
                clip={clip}
                likes={stats.likes}
                dislikes={stats.dislikes}
                myVote={myVotes[clip.id]}
                onVote={vote}
                isFavorited={favoritedIds.has(clip.id)}
                onToggleFavorite={toggleFavorite}
                favoriteCount={favoriteCounts[clip.id] || 0}
                commentsActive={activeCommentClipId === clip.id}
                onOpenComments={toggleComments}
                onCommentsUpdate={handleCommentsUpdate}
                avatarUrl={avatars[clip.streamer]}
                clipperRank={clip.creator_id ? clipperRanks[clip.creator_id] : undefined}
              />
            );
          })}
      </div>

      {!loading && !searchQuery.trim() && totalCount > PAGE_SIZE && (
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
        お気に入り・コメントはすべてのブラウザで共有されます。
      </footer>

      {activeCommentClipId && (() => {
        const activeClip = clips.find((c) => c.id === activeCommentClipId);
        if (!activeClip) return null;
        return (
          <>
            <div
              className="cv-fade-in"
              style={styles.commentBackdrop}
              onClick={() => setActiveCommentClipId(null)}
            />
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
          </>
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
  rankingControlsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  periodTabs: { display: "flex", flexWrap: "wrap", gap: 6 },
  sortSelect: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    color: "#C4C4D0",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12.5,
  },
  dayTabs: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  weeklyBoard: {
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 20,
  },
  weeklyBoardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  weeklyBoardTitle: { fontSize: 13.5, fontWeight: 600, color: "#EDEDF2", margin: 0, display: "flex", alignItems: "center" },
  weeklyBoardMore: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 12,
    color: "#8A8A99",
    textDecoration: "none",
    flexShrink: 0,
  },
  weeklyBoardList: { display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 },
  weeklyChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "8px 12px",
    textDecoration: "none",
    color: "#EDEDF2",
    flexShrink: 0,
    minWidth: 160,
  },
  weeklyChipRank: { fontSize: 14, fontWeight: 700, width: 16, flexShrink: 0, textAlign: "center" },
  weeklyChipAvatar: { width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  weeklyChipAvatarFallback: { width: 26, height: 26, borderRadius: "50%", background: "#2A2A36", flexShrink: 0 },
  weeklyChipInfo: { display: "flex", flexDirection: "column", minWidth: 0 },
  weeklyChipName: {
    fontSize: 12.5,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 100,
  },
  weeklyChipViews: { fontSize: 11, color: "#6B6B78" },
  weeklyChipSkeleton: { width: 160, height: 42, borderRadius: 8, flexShrink: 0 },
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
    padding: "48px 0",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
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
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#24242F",
    borderRadius: 10,
    padding: "14px 16px",
    transition: "background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease",
  },
  rowMain: { display: "flex", alignItems: "center", gap: 14 },
  skeletonRank: { width: 34, height: 26, borderRadius: 4, flexShrink: 0 },
  skeletonThumb: { width: 64, height: 44, borderRadius: 6, flexShrink: 0 },
  skeletonTitle: { width: "70%", height: 14, borderRadius: 4 },
  skeletonMeta: { width: "40%", height: 11, borderRadius: 4 },
  skeletonPill: { width: 52, height: 26, borderRadius: 8 },
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
  clipperLine: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    color: "#6B6B78",
    textDecoration: "none",
    margin: "4px 0 0",
  },
  clipperRankBadge: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "#1C1417",
    background: "#FFC857",
    borderRadius: 10,
    padding: "1px 7px",
  },
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
  favBtn: { padding: "6px 8px" },
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
  commentBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,10,14,0.55)",
    zIndex: 49,
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
  commentItem: { background: "#20202B", borderRadius: 8, padding: "8px 10px", marginBottom: 6 },
  commentItemReply: { background: "#1C1C26", borderRadius: 8, padding: "7px 10px" },
  replyIndent: { marginLeft: 16, paddingLeft: 10, borderLeft: "2px solid #2A2A36", marginBottom: 6 },
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
  replyBtn: {
    background: "transparent",
    border: "none",
    padding: 2,
    display: "flex",
    alignItems: "center",
    color: "#6B6B78",
  },
  replyBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    color: "#9797A6",
  },
  replyCancelBtn: {
    background: "transparent",
    border: "none",
    color: "#8A8A99",
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
