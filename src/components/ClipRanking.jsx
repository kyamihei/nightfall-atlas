import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { Heart, ThumbsDown, MessageCircle, Send, Loader2, Flag, UserPlus, X, ChevronLeft, ChevronRight, ChevronDown, ListChecks, Film, Star, CornerUpLeft, Scissors, TrendingUp, MessageSquare, SlidersHorizontal, Play, Flame, Settings, Sparkles, Smile, Tag, Plus } from "lucide-react";
import {
  useClips,
  useReactions,
  useFavorites,
  useFavoriteCounts,
  useClipStamps,
  REACTION_STAMPS,
  useClipTags,
  useTopClipTags,
  useComments,
  useBroadcasterSearch,
  useBroadcasterRequest,
  useCommentReport,
  useBroadcasterAvatars,
  useClipperRanks,
  useTopClippersByPeriod,
  useTrendingClips,
  useActivityFeed,
  useMyBroadcasterTags,
  useCommentMemberBadges,
  useMembership,
  useTopGames,
} from "../lib/use-clip-ranking";
import { REACTIONS_ENABLED } from "../lib/feature-flags";
import { useActivityFeedPrefs, ACTIVITY_FEED_TYPES } from "../lib/use-activity-feed-prefs";
import { numberCommentsForDisplay, formatThreadTime } from "../lib/thread-format";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";
import CommentNameField from "./CommentNameField";

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
  { value: "reactions", label: "リアクション数順" },
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

// 日別タブで選択中の日付をURLの?dayクエリ（ローカル日付のYYYY-MM-DD）に保存するための変換。
// toISOString()はUTC基準になり日付がズレうるため使わず、ローカルの年月日フィールドから直接
// 文字列化・復元する（「毎日のランキングをXへ自動投稿」節で踏んだのと同種のJST日付境界の罠を避けるため）。
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


function ClipRow({
  clip,
  likes,
  dislikes,
  myVote,
  onVote,
  isFavorited,
  onToggleFavorite,
  favoriteCount,
  stampCounts,
  myStamps,
  onToggleStamp,
  tagCounts,
  myClipTags,
  onToggleClipTag,
  topClipTags,
  commentsActive,
  onOpenComments,
  onCommentsUpdate,
  avatarUrl,
  clipperRank,
  trendingViewsPerHour,
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
  const [reactionsOpen, setReactionsOpen] = useState(false);
  // ポップアップの表示座標（position: fixed用、ボタンのgetBoundingClientRectから算出）。
  // カード（row）は常時transformを付けているため独自のスタッキングコンテキストを作ってしまい、
  // カード内に普通にposition: absoluteで置くと下の行のカードに隠れてしまう（実機確認済みの不具合）。
  // そのためdocument.bodyへcreatePortalし、画面座標で直接配置することでこれを回避する。
  const [reactionPopupPos, setReactionPopupPos] = useState(null);
  const reactionTriggerRef = useRef(null);
  const reactionPanelRef = useRef(null);

  // タグ追加ポップアップ（2026-09-05追加）。リアクションポップアップと全く同じ
  // createPortal + position:fixed パターン（カードの常時transformによるスタッキング
  // コンテキストの罠を避けるため）。
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagPopupPos, setTagPopupPos] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const tagTriggerRef = useRef(null);
  const tagPanelRef = useRef(null);

  useEffect(() => {
    if (!reactionsOpen) return;
    function handleClickOutside(e) {
      if (reactionTriggerRef.current?.contains(e.target) || reactionPanelRef.current?.contains(e.target)) {
        return;
      }
      setReactionsOpen(false);
    }
    // スクロール/リサイズで座標がずれるため、固定の再計算はせずシンプルに閉じる
    function handleScrollOrResize() {
      setReactionsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [reactionsOpen]);

  useEffect(() => {
    if (!tagsOpen) return;
    function handleClickOutside(e) {
      if (tagTriggerRef.current?.contains(e.target) || tagPanelRef.current?.contains(e.target)) {
        return;
      }
      setTagsOpen(false);
    }
    function handleScrollOrResize() {
      setTagsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [tagsOpen]);

  function toggleReactionPopup(e) {
    e.stopPropagation();
    if (reactionsOpen) {
      setReactionsOpen(false);
      return;
    }
    const rect = reactionTriggerRef.current.getBoundingClientRect();
    const width = 232;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    setReactionPopupPos({ top: rect.bottom + 8, left });
    setReactionsOpen(true);
  }

  function toggleTagsPopup(e) {
    e.stopPropagation();
    if (tagsOpen) {
      setTagsOpen(false);
      return;
    }
    const rect = tagTriggerRef.current.getBoundingClientRect();
    const width = 232;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    setTagPopupPos({ top: rect.bottom + 8, left });
    setTagsOpen(true);
  }

  function handleAddTag(e) {
    e.preventDefault();
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    onToggleClipTag(clip.id, trimmed);
    setTagInput("");
  }

  useEffect(() => {
    onCommentsUpdate(clip.id, { comments, submit, submitting, error });
  }, [clip.id, comments, submit, submitting, error, onCommentsUpdate]);

  const tagStyle = getTagColor(clip.game);
  const rankAccent = getRankAccent(clip.rank);
  const totalStampCount = stampCounts ? Object.values(stampCounts).reduce((sum, n) => sum + n, 0) : 0;
  const clipTagList = tagCounts ? Object.entries(tagCounts).sort((a, b) => b[1] - a[1]) : [];
  const suggestedTags = (topClipTags ?? []).filter((t) => !tagCounts?.[t.tag]).slice(0, 6);

  return (
    <div
      className="cv-fade-in-up cv-clip-card"
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
      title="クリックでコメントを開く（サムネイル＝動画再生、タイトル＝詳細ページ）"
    >
      <div className="cv-row-main" style={styles.rowMain}>
        <div className="cv-thumb-wrap">
          <div
            className="clip-rank-num"
            style={{
              color: rankAccent || "#565660",
              textShadow: rankAccent ? `0 0 14px ${rankAccent}66` : "none",
            }}
          >
            {String(clip.rank).padStart(2, "0")}
          </div>

          {playerOpen ? (
            <div className="cv-clip-thumb" style={{ ...styles.thumb, padding: 0, overflow: "hidden", border: "none" }}>
              <iframe
                src={`https://clips.twitch.tv/embed?clip=${clip.id}&parent=${window.location.hostname}&autoplay=true&muted=true`}
                style={{ width: "100%", height: "100%", border: "none" }}
                allowFullScreen
                title={clip.title}
              />
            </div>
          ) : (
            <button
              className="cv-clip-thumb"
              onClick={(e) => {
                e.stopPropagation();
                setPlayerOpen(true);
              }}
              style={{
                ...styles.thumb,
                background: clip.thumbnail_url ? "transparent" : tagStyle.bg,
                color: tagStyle.text,
                padding: clip.thumbnail_url ? 0 : styles.thumb.padding,
                overflow: "hidden",
                border: "none",
                position: "relative",
              }}
              aria-label="動画を再生"
              title="クリックでこの場で動画を再生"
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
              <span style={styles.thumbPlayOverlay}>
                <span style={styles.thumbPlayIcon}>
                  <Play size={12} fill="#14141B" color="#14141B" style={{ marginLeft: 1 }} />
                </span>
              </span>
            </button>
          )}
        </div>

        <div style={styles.infoCol}>
          <Link
            to={`/clips/${clip.id}`}
            className="cv-clip-title-link"
            style={styles.clipTitleLink}
            onClick={(e) => e.stopPropagation()}
            title="クリックで詳細ページを開く"
          >
            <p className="clip-title-font cv-clip-title" style={styles.clipTitle}>{clip.title}</p>
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
            {trendingViewsPerHour != null && ` ・ 時間あたり${formatViews(Math.round(trendingViewsPerHour))}回`}
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
          <button
            ref={reactionTriggerRef}
            onClick={toggleReactionPopup}
            style={{
              ...styles.actionBtn,
              color: reactionsOpen || totalStampCount > 0 ? "#EDEDF2" : "#8A8A99",
              borderColor: reactionsOpen ? "#3A3A48" : "#2E2E3A",
            }}
            aria-expanded={reactionsOpen}
            aria-label="リアクションする"
          >
            <Smile size={15} />
            リアクションする
            {totalStampCount > 0 && <span style={styles.stampCount}>{totalStampCount}</span>}
            <ChevronDown
              size={13}
              style={{ transform: reactionsOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
            />
          </button>
          <button
            ref={tagTriggerRef}
            onClick={toggleTagsPopup}
            style={{
              ...styles.actionBtn,
              color: tagsOpen || clipTagList.length > 0 ? "#EDEDF2" : "#8A8A99",
              borderColor: tagsOpen ? "#3A3A48" : "#2E2E3A",
            }}
            aria-expanded={tagsOpen}
            aria-label="タグを付ける"
          >
            <Tag size={15} />
            タグ
            {clipTagList.length > 0 && <span style={styles.stampCount}>{clipTagList.length}</span>}
            <ChevronDown
              size={13}
              style={{ transform: tagsOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
            />
          </button>
        </div>
      </div>

      {tagsOpen &&
        tagPopupPos &&
        createPortal(
          <div
            ref={tagPanelRef}
            className="cv-fade-in"
            style={{ ...styles.tagPopup, top: tagPopupPos.top, left: tagPopupPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {clipTagList.length > 0 && (
              <div style={styles.tagChipRow}>
                {clipTagList.map(([tag, count]) => {
                  const selected = myClipTags?.has(tag) ?? false;
                  return (
                    <button
                      key={tag}
                      onClick={() => onToggleClipTag(clip.id, tag)}
                      style={{
                        ...styles.stampBtn,
                        color: selected ? "#5DCAA5" : "#8A8A99",
                        borderColor: selected ? "#5DCAA555" : "#2E2E3A",
                        background: selected ? "#15302966" : "transparent",
                      }}
                    >
                      {tag}
                      <span style={styles.stampCount}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <form onSubmit={handleAddTag} style={styles.tagAddForm}>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="新しいタグ（15文字以内）"
                maxLength={15}
                style={styles.tagAddInput}
              />
              <button type="submit" style={styles.tagAddBtn} aria-label="タグを追加">
                <Plus size={14} />
              </button>
            </form>
            {suggestedTags.length > 0 && (
              <div style={styles.tagSuggestRow}>
                {suggestedTags.map((t) => (
                  <button
                    key={t.tag}
                    onClick={() => onToggleClipTag(clip.id, t.tag)}
                    style={styles.tagSuggestBtn}
                  >
                    <Plus size={11} />
                    {t.tag}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}

      {reactionsOpen &&
        reactionPopupPos &&
        createPortal(
          <div
            ref={reactionPanelRef}
            className="cv-fade-in"
            style={{ ...styles.reactionPopup, top: reactionPopupPos.top, left: reactionPopupPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {REACTION_STAMPS.map((stamp) => {
              const count = stampCounts?.[stamp] ?? 0;
              const selected = myStamps?.has(stamp) ?? false;
              return (
                <button
                  key={stamp}
                  onClick={() => onToggleStamp(clip.id, stamp)}
                  style={{
                    ...styles.stampBtn,
                    color: selected ? "#FFC857" : "#8A8A99",
                    borderColor: selected ? "#FFC85755" : "#2E2E3A",
                    background: selected ? "#3A2E1466" : "transparent",
                  }}
                >
                  {stamp}
                  {count > 0 && <span style={styles.stampCount}>{count}</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}

    </div>
  );
}

/**
 * クリップ一覧の右側に固定表示するコメントサイドパネル。
 * コメントの購読はClipRow側で行っているため、ここでは親から渡されたデータを表示するだけ
 * （同一clipへの二重購読を避けるため、自前でuseCommentsは呼ばない）。
 */
function CommentSidebar({
  clip,
  commentsData,
  nameDraft,
  onNameDraftChange,
  nickname,
  reportedIds,
  onReport,
  onClose,
}) {
  const { comments, submit, submitting, error } = commentsData ?? {
    comments: [],
    submit: () => {},
    submitting: false,
    error: null,
  };
  const [draft, setDraft] = useState("");
  const [useNickname, setUseNickname] = useState(true);
  const [localError, setLocalError] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { id, display_name } | null

  const commentIds = useMemo(() => comments.map((c) => c.id), [comments]);
  const memberBadges = useCommentMemberBadges(commentIds);

  // 5ch風にレス番号を振り、新しい順（上が最新）で表示する（2026-09-04、ユーザー要望）。
  const { display: displayComments, numberById } = numberCommentsForDisplay(comments);

  function handleSubmit() {
    const body = draft.trim();
    if (!body) {
      setLocalError("コメントを入力してください。");
      return;
    }
    setLocalError("");
    const displayName = nickname && useNickname ? nickname : nameDraft;
    submit(body, displayName, replyTo?.id ?? null);
    setDraft("");
    setReplyTo(null);
  }

  function renderComment(c) {
    const alreadyReported = reportedIds.has(c.id);
    const parentNumber = c.parent_id ? numberById.get(c.parent_id) : null;
    return (
      <div key={c.id} style={styles.commentItem}>
        <div style={styles.commentHead}>
          <span style={styles.postNumber}>{c.number}</span>
          <span style={styles.commentName}>
            {c.display_name}
            {memberBadges[c.id]?.memberNumber && (
              <span style={styles.memberBadge}>#{memberBadges[c.id].memberNumber}</span>
            )}
            {memberBadges[c.id]?.clipperBadge && (
              <span style={styles.clipperBadge}>
                <Scissors size={9} />
                クリップ職人
              </span>
            )}
          </span>
          <span style={styles.commentTime}>{formatThreadTime(c.created_at)}</span>
          <div style={styles.commentHeadActions}>
            <button
              onClick={() => setReplyTo({ id: c.id, display_name: c.display_name })}
              style={styles.replyBtn}
              aria-label="返信"
              title="このコメントに返信"
            >
              <CornerUpLeft size={12} />
              レス
            </button>
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
        <p style={styles.commentBody}>
          {parentNumber && <span style={styles.quoteRef}>&gt;&gt;{parentNumber}</span>}
          {c.body}
        </p>
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
      <Link to={`/general?from=${clip.id}`} style={styles.generalThreadLink}>
        <MessageSquare size={12} />
        総合スレで話す
      </Link>

      <div style={styles.commentList}>
        {comments.length === 0 && (
          <p style={styles.noComment}>まだコメントはありません。最初のコメントを投稿してみましょう。</p>
        )}
        {displayComments.map((c) => renderComment(c))}
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
        <CommentNameField
          nickname={nickname}
          useNickname={useNickname}
          onUseNicknameChange={setUseNickname}
          freeText={nameDraft}
          onFreeTextChange={onNameDraftChange}
          inputStyle={styles.nameInput}
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

const NEW_SITE_BANNER_DISMISSED_KEY = "cv-new-site-banner-dismissed";

/**
 * 「最近できたばかりのサイトだと視聴者に伝え、今のうちに使えば古参になれるかもという
 * 承認欲求に訴えたい」という要望で追加（2026-09-04）。トップページに来て最初に目に入る
 * ヘッダー直上に表示する。一度閉じたら二度と出さないよう閉じた状態をlocalStorageに保存する
 * （お気に入り/配信者タグ等と違いアカウントに紐付ける必要が薄い、端末ごとの表示上の好みのため
 * `useActivityFeedPrefs`と同じ考え方でlocalStorageのみで完結させている）。
 */
function NewSiteBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(NEW_SITE_BANNER_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(NEW_SITE_BANNER_DISMISSED_KEY, "1");
    } catch {
      // プライベートブラウジング等でlocalStorageが使えない場合は保存を諦める（今回の表示は閉じたままにする）
    }
  }

  if (dismissed) return null;

  return (
    <div style={styles.newSiteBanner}>
      <Sparkles size={16} style={styles.newSiteBannerIcon} />
      <span style={styles.newSiteBannerText}>
        クリスレは2026年9月にスタートしたばかりの新しいサイトです。今のうちに使い始めれば、あなたも「古参」になれるかも？
      </span>
      <button onClick={handleDismiss} style={styles.newSiteBannerClose} aria-label="閉じる">
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * トップページ上部に表示するライブ活動フィード。新着コメント/スタンプを1件ずつ順番に見せる
 * ティッカー（「何かが常に動いている」状態を作りたいという要望で追加、2026-09-03）。
 * 新着イベントが届いた瞬間はそれを即座に先頭表示し、以降は数秒おきに他の直近イベントも
 * 巡回表示する。keyにitem.idを使うことで表示切り替えのたびにcv-fade-inを再生させている。
 */
function ActivityTicker({ items }) {
  const [index, setIndex] = useState(0);
  const topIdRef = useRef(null);

  useEffect(() => {
    // 件数が上限に達した後は配列の長さが変わらなくなる（hot_thread/rising_clipperのような
    // スナップショット枠の更新も、件数を増やさず中身だけ入れ替わる）ため、長さではなく
    // 「先頭要素のid」の変化で新着判定する
    const topId = items[0]?.id ?? null;
    if (topId !== null && topId !== topIdRef.current) {
      setIndex(0); // 新着・更新が来た瞬間はそれを見せる
    }
    topIdRef.current = topId;
  }, [items]);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;
  const item = items[index % items.length];
  const linkTo = item.type === "rising_clipper" ? `/clippers/${encodeURIComponent(item.creatorId)}` : `/clips/${item.clipId}`;

  return (
    <Link key={item.id} to={linkTo} className="cv-fade-in" style={styles.activityTicker}>
      <span className="cv-live-dot" style={styles.activityDot} />
      <span style={styles.activityText}>
        {item.type === "comment" && (
          <>
            <MessageCircle size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
            <strong style={{ color: "#EDEDF2" }}>{item.displayName}</strong>さんが「{item.clipTitle}」にコメントしました
          </>
        )}
        {item.type === "stamp" && (
          <>
            <span style={{ marginRight: 4 }}>{item.stamp}</span>
            「{item.clipTitle}」にリアクションが押されました
          </>
        )}
        {item.type === "new_clip" && (
          <>
            <Film size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
            「{item.clipTitle}」（{item.streamer}）をクリップに追加しました
          </>
        )}
        {item.type === "hot_thread" && (
          <>
            <Flame size={13} style={{ marginRight: 4, verticalAlign: -2 }} color="#FF9F45" />
            いま「{item.clipTitle}」のスレが盛り上がっています！（コメント{item.commentCount}件）
          </>
        )}
        {item.type === "rising_clipper" && (
          <>
            <TrendingUp size={13} style={{ marginRight: 4, verticalAlign: -2 }} color="#5DCAA5" />
            急上昇中のクリップ職人：<strong style={{ color: "#EDEDF2" }}>{item.creatorName}</strong>さん
          </>
        )}
      </span>
    </Link>
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
          ? Array.from({ length: 10 }).map((_, i) => (
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
      <div className="cv-row-main" style={styles.rowMain}>
        <div className="cv-thumb-wrap">
          <div className="cv-skeleton clip-rank-num" style={styles.skeletonRank} />
          <div className="cv-skeleton cv-clip-thumb" style={styles.skeletonThumb} />
        </div>
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
  // 期間タブ（全期間/今年/今月/日別）・日別選択中の日付をURLの?period/?dayクエリにも同期する
  // （2026-09-05、「日別9/4を見ていてブラウザバックすると全期間に戻ってしまう」不具合対応）。
  // activeView（ランキング/トレンドタブ）で既に使っている「stateを真実の源にしつつURLへ反映し、
  // 初期stateはマウント時にURLから復元する」パターンをそのまま踏襲している。
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriodParam = searchParams.get("period");
  const initialPeriod = PERIOD_TABS.some((t) => t.value === initialPeriodParam) ? initialPeriodParam : "day";
  const [period, setPeriod] = useState(initialPeriod);
  const [selectedDay, setSelectedDay] = useState(() => parseDayParam(searchParams.get("day")) ?? new Date());
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("views"); // views | newest | likes | comments
  const [tagFilter, setTagFilter] = useState(""); // ""=絞り込みなし。自分で付けた配信者タグで絞り込む
  const { tags: myTags, streamersByTag } = useMyBroadcasterTags();
  const tagStreamerFilter = tagFilter ? streamersByTag[tagFilter] ?? [] : null;

  // ゲームカテゴリでの絞り込み（2026-09-04追加）。「今流行っているゲームだけ見たい」という要望への
  // 対応。ドロップダウンの選択肢は人気順（総視聴回数順）で、今何が流行っているか一目でわかる。
  const [gameFilter, setGameFilter] = useState(""); // ""=絞り込みなし
  const { games: topGames } = useTopGames(150);

  // クリップタグでの絞り込み（2026-09-05追加）。「ワイプ芸」のような、配信者・ゲームを問わず
  // 複数のクリップに共通する特徴でまとめて見たい、という要望への対応。上の`tagFilter`
  // （配信者タグ、私用の絞り込み）とは別物のため、変数名を`clipTagFilter`にして区別している。
  const [clipTagFilter, setClipTagFilter] = useState(""); // ""=絞り込みなし
  const { tags: topClipTags } = useTopClipTags(100);

  // コメント投稿時の「ニックネームで投稿」選択肢用（ヘッダー側の会員バッジ/ログアウト等は
  // 共通ヘッダーHeader.jsxへ移設済み、2026-09-04）。
  const { nickname } = useMembership();
  const { clips, loading, error: clipsError, totalCount } = useClips(
    PAGE_SIZE,
    period,
    period === "day" ? selectedDay : undefined,
    page,
    sortBy,
    tagStreamerFilter,
    gameFilter || null,
    clipTagFilter || null,
  );
  const { clips: trendingClips, loading: trendingLoading } = useTrendingClips(PAGE_SIZE, 72);
  const { items: activityItems } = useActivityFeed(15);

  // お知らせフィード（ライブ活動フィード）の表示設定。「指定したタグの新着クリップだけ知りたい」
  // という要望への対応（2026-09-04）。種類ごとのON/OFFと、「新着クリップ」を自分の配信者タグで
  // 絞り込む設定をlocalStorageに保存し、取得済みのactivityItemsを表示直前にクライアント側で絞り込む
  // （DB側のクエリ自体は変えない。件数上限15件の中からの絞り込みなので、絞り込み条件次第では
  // 表示件数が実質的に減ることを許容している）。
  const { prefs: activityFeedPrefs, toggleType: toggleActivityFeedType, setNewClipTag } = useActivityFeedPrefs();
  const filteredActivityItems = useMemo(() => {
    const tagStreamers = activityFeedPrefs.newClipTag
      ? new Set(streamersByTag[activityFeedPrefs.newClipTag] ?? [])
      : null;
    return activityItems.filter((item) => {
      if (!activityFeedPrefs.types[item.type]) return false;
      if (item.type === "new_clip" && tagStreamers && !tagStreamers.has(item.streamer)) return false;
      return true;
    });
  }, [activityItems, activityFeedPrefs, streamersByTag]);
  const [activityPrefsOpen, setActivityPrefsOpen] = useState(false);
  const activityPrefsRef = useRef(null);

  useEffect(() => {
    if (!activityPrefsOpen) return;
    function handleClickOutside(e) {
      if (activityPrefsRef.current && !activityPrefsRef.current.contains(e.target)) {
        setActivityPrefsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activityPrefsOpen]);

  // ランキング欄とトレンド欄を同じ場所でタブ切り替え表示するため、リアクション/お気に入り/
  // スタンプ/アバター/クリッパー順位はどちらのタブに出てくるクリップIDもまとめて取得しておく
  // （タブを切り替えるたびに読み込み直すと表示がちらつくため）。
  const clipIds = useMemo(() => {
    const ids = new Set(clips.map((c) => c.id));
    trendingClips.forEach((c) => ids.add(c.id));
    return [...ids];
  }, [clips, trendingClips]);
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
  const { counts: stampCounts, myStamps, toggle: toggleStamp } = useClipStamps(clipIds);
  const { counts: clipTagCounts, myTags: myClipTags, toggle: toggleClipTag } = useClipTags(clipIds);
  const streamerNames = useMemo(() => {
    const names = new Set(clips.map((c) => c.streamer));
    trendingClips.forEach((c) => names.add(c.streamer));
    return [...names];
  }, [clips, trendingClips]);
  const avatars = useBroadcasterAvatars(streamerNames);
  const creatorIds = useMemo(() => {
    const ids = new Set(clips.map((c) => c.creator_id));
    trendingClips.forEach((c) => ids.add(c.creator_id));
    return [...ids];
  }, [clips, trendingClips]);
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
    10,
  );

  const [activeCommentClipId, setActiveCommentClipId] = useState(null);
  const [commentsDataByClip, setCommentsDataByClip] = useState({});
  const [nameDraft, setNameDraft] = useState("");
  const [requestDraft, setRequestDraft] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());

  // ランキング欄／トレンド欄のタブ切り替え。slideDirは切り替え時のスライド方向
  // （タブクリックでは並び順から、スワイプでは指の動きから決める）。
  // 選択中のタブはURLのクエリ（?view=trending）にも反映する。クリップ詳細ページから
  // ブラウザの戻る/「戻る」リンクで復帰した際に、トレンドタブを見ていたのにランキングタブへ
  // 戻ってしまう（活性タブがコンポーネント内のstateだけで管理されており、詳細ページへの遷移で
  // アンマウントされると失われるため）不具合の対応（2026-09-04）。
  const VIEW_TABS = ["ranking", "trending"];
  // 配信者名検索はヘッダー（Header.jsx）側のstateから?qクエリ経由で受け取る
  // （ヘッダーはコンポーネントツリー上ここの親ではないためpropsで渡せない、2026-09-04）。
  const searchQuery = searchParams.get("q") ?? "";
  const initialView = searchParams.get("view") === "trending" ? "trending" : "ranking";
  const [activeView, setActiveView] = useState(initialView);
  const [slideDir, setSlideDir] = useState("right");
  const touchStartXRef = useRef(null);

  function switchView(next) {
    setActiveView((prev) => {
      if (prev === next) return prev;
      setSlideDir(VIEW_TABS.indexOf(next) > VIEW_TABS.indexOf(prev) ? "right" : "left");
      setSearchParams(
        (params) => {
          const next2 = new URLSearchParams(params);
          if (next === "ranking") next2.delete("view");
          else next2.set("view", next);
          return next2;
        },
        { replace: true },
      );
      return next;
    });
  }

  function handleViewTouchStart(e) {
    touchStartXRef.current = e.touches[0].clientX;
  }

  function handleViewTouchEnd(e) {
    if (touchStartXRef.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (deltaX < -50) switchView("trending");
    else if (deltaX > 50) switchView("ranking");
  }

  // 期間指定欄はボタン1つに畳み、押したときだけ選択肢を開く。外側クリックで閉じる。
  // 期間・並び替え・ゲーム・配信者タグの4つの絞り込みを「フィルター」という1つのボタンに
  // 統合したパネル（2026-09-04、「3つのドロップダウンを1つに結合してほしい」という要望への
  // 対応）。以前は期間だけがこの「ボタン→パネル」形式で、並び替え/ゲームは常時表示の
  // 別々のセレクトだった。パネルは複数のセクションを持つため、期間タブを選んでも
  // 自動では閉じない（並び替え・ゲームも続けて調整できるように、外側クリックか
  // ボタン再クリックでのみ閉じる）。
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    if (!filterOpen) return;
    function handleClickOutside(e) {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  // 期間・日別選択をstateと同時にURLへも反映する（activeViewの?viewクエリ同期と同じパターン）。
  // 日別以外はday自体が無意味なため、periodがdayでなくなったらdayクエリは消す。
  function syncPeriodParams(nextPeriod, nextDay) {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (nextPeriod === "day") {
          next.delete("period");
          next.set("day", formatDayParam(nextDay));
        } else {
          next.set("period", nextPeriod);
          next.delete("day");
        }
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

  const { results: broadcasterResults, searching: broadcasterSearching } = useBroadcasterSearch(searchQuery);
  const { request: requestBroadcaster, submitting: requesting, result: requestResult } = useBroadcasterRequest();
  const { report: reportComment } = useCommentReport();

  // 期間・日付・並び替え・検索条件・タグ絞り込み・ゲーム絞り込みが変わったら1ページ目に戻す
  // （違うページに条件が引き継がれて空表示になるのを防ぐ）
  useEffect(() => {
    setPage(1);
  }, [period, selectedDay, sortBy, searchQuery, tagFilter, gameFilter, clipTagFilter]);

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
  const trendingRanked = trendingClips.map((c, i) => ({ ...c, rank: i + 1 }));

  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-rank-num { font-family: 'Oswald', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button { cursor: pointer; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
        .cv-clip-thumb { width: 64px; height: 44px; }
        .cv-clip-title { font-size: 15px; }
        .cv-clip-title-link:hover .cv-clip-title { text-decoration: underline; }

        /* クリップ一覧: スマホ〜タブレットは縦積みリスト、PC幅（901px〜）はカード型グリッドに
           切り替える（2026-09-04、「PC用画面とスマホ用画面を明確に分けたい」という要望への対応）。
           display/flex-direction等をここでまとめて制御する（インライン styles.list/rowMain/rankNum
           側には幅・レイアウト系プロパティを一切置かない設計。インラインスタイルは常に
           このCSSより優先されてしまい@mediaで上書きできないため） */
        .cv-clip-list { display: flex; flex-direction: column; gap: 10px; }
        .cv-row-main { display: flex; align-items: center; gap: 14px; }
        .clip-rank-num { font-size: 26px; font-weight: 600; width: 34px; flex-shrink: 0; }
        /* サムネイルと順位バッジをまとめたラッパー。スマホ時はdisplay:contentsで
           レイアウトに影響を与えず（順位バッジ・サムネイルは従来通りcv-row-mainの
           直接の子として横並びになる）、PC幅ではposition:relativeにしてバッジを
           サムネイル左上にオーバーレイ表示する */
        .cv-thumb-wrap { display: contents; }

        @media (min-width: 901px) {
          .cv-clip-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
          /* グリッドの同じ行にあるカードは高さが揃う（grid既定のstretch）が、タイトルや配信者名の
             行数はカードごとに違うため、コメント/お気に入り/リアクションするボタンの行が
             カードごとにバラバラの高さに来てしまう。cv-clip-card→cv-row-mainをflex縦積みで
             カード全体の高さまで伸ばし、cv-row-actionsをmargin-top: autoで下端に押し付けることで
             ボタン行を常にカード下端に揃える（2026-09-04、「下揃えにしてほしい」という要望）。 */
          .cv-clip-card { display: flex; flex-direction: column; }
          .cv-row-main { flex: 1; flex-direction: column; align-items: stretch; gap: 10px; }
          .cv-row-actions { margin-top: auto; }
          .cv-thumb-wrap { display: block; position: relative; }
          .cv-clip-thumb { width: 100%; height: auto; aspect-ratio: 16 / 9; }
          .cv-clip-title { font-size: 17px; }
          .clip-rank-num {
            position: absolute;
            top: 8px;
            left: 8px;
            z-index: 1;
            width: auto;
            font-size: 14px;
            padding: 2px 9px;
            border-radius: 6px;
            background: rgba(20, 20, 27, 0.82);
          }
        }
        @media (min-width: 1400px) {
          .cv-clip-list { grid-template-columns: repeat(4, 1fr); }
        }
        @media (max-width: 640px) {
          .cv-row-main { flex-wrap: wrap; row-gap: 10px; }
          .cv-row-actions { flex-basis: 100%; justify-content: flex-end; }
        }
      `}</style>

      <NewSiteBanner />

      <div style={styles.activityBarRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ActivityTicker items={filteredActivityItems} />
        </div>
        <div ref={activityPrefsRef} style={styles.activityPrefsWrap}>
          <button
            onClick={() => setActivityPrefsOpen((o) => !o)}
            style={styles.activityPrefsBtn}
            aria-expanded={activityPrefsOpen}
            aria-label="お知らせフィードの設定"
            title="お知らせフィードの設定"
          >
            <Settings size={14} />
          </button>
          {activityPrefsOpen && (
            <div className="cv-fade-in" style={styles.activityPrefsPanel}>
              <p style={styles.activityPrefsTitle}>お知らせフィードの設定</p>
              <div style={styles.activityPrefsCheckboxList}>
                {ACTIVITY_FEED_TYPES.map((t) => (
                  <label key={t.value} style={styles.activityPrefsCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={activityFeedPrefs.types[t.value]}
                      onChange={() => toggleActivityFeedType(t.value)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              {myTags.length > 0 && (
                <div style={styles.activityPrefsTagFilter}>
                  <label style={styles.activityPrefsTagLabel} htmlFor="activity-new-clip-tag">
                    新着クリップをタグで絞り込む
                  </label>
                  <select
                    id="activity-new-clip-tag"
                    value={activityFeedPrefs.newClipTag}
                    onChange={(e) => setNewClipTag(e.target.value)}
                    style={styles.sortSelect}
                  >
                    <option value="">絞り込みなし</option>
                    {myTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <WeeklyClipperBoard clippers={weeklyClippers} loading={weeklyClippersLoading} />

      <div style={styles.viewTabsRow}>
        <button
          onClick={() => switchView("ranking")}
          style={activeView === "ranking" ? styles.viewTabActive : styles.viewTab}
        >
          <ListChecks size={14} />
          総合ランキング
        </button>
        <button
          onClick={() => switchView("trending")}
          style={activeView === "trending" ? styles.viewTabActive : styles.viewTab}
        >
          <TrendingUp size={14} />
          トレンドランキング
        </button>
      </div>

      <div
        key={activeView}
        className={slideDir === "right" ? "cv-slide-in-from-right" : "cv-slide-in-from-left"}
        onTouchStart={handleViewTouchStart}
        onTouchEnd={handleViewTouchEnd}
      >
        {activeView === "ranking" ? (
          <>
            <div className="cv-ranking-controls" style={styles.rankingControlsRow}>
              <div ref={filterRef} style={styles.periodPickerWrap}>
                <button
                  onClick={() => setFilterOpen((o) => !o)}
                  style={styles.periodPickerBtn}
                  aria-expanded={filterOpen}
                >
                  <SlidersHorizontal size={13} />
                  フィルター
                  <ChevronDown
                    size={13}
                    style={{
                      transform: filterOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.15s ease",
                    }}
                  />
                </button>
                {filterOpen && (
                  <div className="cv-fade-in" style={styles.periodPickerPanel}>
                    <p style={styles.filterSectionLabel}>期間</p>
                    <div style={styles.periodPickerTabs}>
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
                      <div style={styles.periodPickerDays}>
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

                    <p style={styles.filterSectionLabel}>並び替え</p>
                    <div style={styles.periodPickerTabs}>
                      {SORT_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => setSortBy(o.value)}
                          style={sortBy === o.value ? styles.tabActive : styles.tab}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>

                    <p style={styles.filterSectionLabel}>ゲーム</p>
                    <select
                      value={gameFilter}
                      onChange={(e) => setGameFilter(e.target.value)}
                      style={styles.filterSelect}
                      aria-label="ゲームで絞り込み"
                    >
                      <option value="">すべてのゲーム</option>
                      {topGames.map((g) => (
                        <option key={g.game} value={g.game}>
                          {g.game}
                        </option>
                      ))}
                    </select>

                    {topClipTags.length > 0 && (
                      <>
                        <p style={styles.filterSectionLabel}>タグ</p>
                        <select
                          value={clipTagFilter}
                          onChange={(e) => setClipTagFilter(e.target.value)}
                          style={styles.filterSelect}
                          aria-label="クリップタグで絞り込み"
                        >
                          <option value="">すべてのタグ</option>
                          {topClipTags.map((t) => (
                            <option key={t.tag} value={t.tag}>
                              {t.tag}（{t.clip_count}）
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    {myTags.length > 0 && (
                      <>
                        <p style={styles.filterSectionLabel}>配信者タグ</p>
                        <select
                          value={tagFilter}
                          onChange={(e) => setTagFilter(e.target.value)}
                          style={styles.filterSelect}
                          aria-label="マイタグで絞り込み"
                        >
                          <option value="">すべての配信者</option>
                          {myTags.map((t) => (
                            <option key={t} value={t}>
                              「{t}」タグのみ
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {clipsError && <div style={styles.errorBanner}>{clipsError}</div>}

            <div className="cv-clip-list" style={styles.list}>
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
                      stampCounts={stampCounts[clip.id]}
                      myStamps={myStamps[clip.id]}
                      onToggleStamp={toggleStamp}
                      tagCounts={clipTagCounts[clip.id]}
                      myClipTags={myClipTags[clip.id]}
                      onToggleClipTag={toggleClipTag}
                      topClipTags={topClipTags}
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
          </>
        ) : (
          <div className="cv-clip-list" style={styles.list}>
            {trendingLoading && (
              <>
                {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <SkeletonRow key={i} delay={i * 40} />
                ))}
              </>
            )}
            {!trendingLoading && trendingRanked.length === 0 && (
              <div style={styles.emptyState}>
                <TrendingUp size={26} color="#3E3E4A" style={{ marginBottom: 10 }} />
                <p style={{ margin: 0 }}>直近72時間以内に伸びているクリップはまだありません。</p>
              </div>
            )}
            {!trendingLoading &&
              trendingRanked.map((clip) => {
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
                    stampCounts={stampCounts[clip.id]}
                    myStamps={myStamps[clip.id]}
                    onToggleStamp={toggleStamp}
                    tagCounts={clipTagCounts[clip.id]}
                    myClipTags={myClipTags[clip.id]}
                    onToggleClipTag={toggleClipTag}
                    topClipTags={topClipTags}
                    commentsActive={activeCommentClipId === clip.id}
                    onOpenComments={toggleComments}
                    onCommentsUpdate={handleCommentsUpdate}
                    avatarUrl={avatars[clip.streamer]}
                    clipperRank={clip.creator_id ? clipperRanks[clip.creator_id] : undefined}
                    trendingViewsPerHour={clip.views_per_hour}
                  />
                );
              })}
          </div>
        )}
      </div>

      <Footer note="お気に入り・コメントはすべてのブラウザで共有されます。" />

      {activeCommentClipId && (() => {
        const activeClip =
          clips.find((c) => c.id === activeCommentClipId) ??
          trendingClips.find((c) => c.id === activeCommentClipId);
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
              nickname={nickname}
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
    position: "relative",
    zIndex: 0, // bgGlowのzIndex:-1をこの要素基準でスタッキングさせるために必須（position:relativeだけでは不十分）
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 32px 40px",
    maxWidth: 1600,
    margin: "0 auto",
  },
  newSiteBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "linear-gradient(90deg, #FF4D6D26, #7E14FF26)",
    border: "1px solid #FF4D6D4D",
    borderRadius: 10,
    padding: "10px 14px",
    marginBottom: 16,
  },
  newSiteBannerIcon: { flexShrink: 0, color: "#FF4D6D" },
  newSiteBannerText: { flex: 1, fontSize: 13, color: "#EDEDF2", lineHeight: 1.5 },
  newSiteBannerClose: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    background: "none",
    border: "none",
    color: "#9797A6",
    padding: 4,
  },
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
    gap: 10,
    marginBottom: 16,
  },
  sortSelect: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    color: "#C4C4D0",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12.5,
  },
  viewTabsRow: { display: "flex", gap: 8, marginBottom: 16 },
  viewTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#8A8A99",
    borderRadius: 20,
    padding: "8px 16px",
    fontSize: 13.5,
    fontWeight: 500,
  },
  viewTabActive: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#FF4D6D14",
    border: "1px solid #FF4D6D55",
    color: "#EDEDF2",
    borderRadius: 20,
    padding: "8px 16px",
    fontSize: 13.5,
    fontWeight: 600,
  },
  periodPickerWrap: { position: "relative" },
  periodPickerBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    color: "#C4C4D0",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 13,
    fontWeight: 500,
  },
  periodPickerPanel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: 0,
    zIndex: 20,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    minWidth: 280,
  },
  periodPickerTabs: { display: "flex", flexWrap: "wrap", gap: 6 },
  periodPickerDays: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #24242F",
  },
  // 「フィルター」パネル内の各項目（期間・並び替え・ゲーム・配信者タグ）の見出し
  // （2026-09-04、3つの独立したドロップダウンを1つのフィルターパネルに統合した際に追加）。
  filterSectionLabel: {
    fontSize: 11.5,
    color: "#6B6B78",
    fontWeight: 600,
    margin: "14px 0 6px",
  },
  filterSelect: {
    display: "block",
    width: "100%",
    background: "#20202B",
    border: "1px solid #2E2E3A",
    color: "#C4C4D0",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12.5,
  },
  activityTicker: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 8,
    padding: "9px 14px",
    textDecoration: "none",
    color: "#9797A6",
    fontSize: 12.5,
    overflow: "hidden",
  },
  activityDot: { flexShrink: 0 },
  activityText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  activityBarRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 20 },
  activityPrefsWrap: { position: "relative", flexShrink: 0 },
  activityPrefsBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    color: "#9797A6",
    borderRadius: 8,
  },
  activityPrefsPanel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    zIndex: 20,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: 14,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    minWidth: 240,
  },
  activityPrefsTitle: { fontSize: 13, fontWeight: 600, color: "#EDEDF2", margin: "0 0 10px" },
  activityPrefsCheckboxList: { display: "flex", flexDirection: "column", gap: 8 },
  activityPrefsCheckboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "#C4C4D0",
    cursor: "pointer",
  },
  activityPrefsTagFilter: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #24242F",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  activityPrefsTagLabel: { fontSize: 12, color: "#8A8A99" },
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
  list: {}, // レイアウト（縦積み/グリッド切り替え）は.cv-clip-listクラス側で制御（PC/SP分岐のため）
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
  // display/alignItems/gap/flexDirectionは.cv-row-mainクラス側で制御（PC幅ではカード表示に
  // 縦積み切り替えするため。インライン指定するとCSSの@media側が上書きできなくなる）
  rowMain: {},
  skeletonRank: { height: 26, borderRadius: 4 },
  skeletonThumb: { borderRadius: 6, flexShrink: 0 },
  skeletonTitle: { width: "70%", height: 14, borderRadius: 4 },
  skeletonMeta: { width: "40%", height: 11, borderRadius: 4 },
  skeletonPill: { width: 52, height: 26, borderRadius: 8 },
  // fontSize/width/flexShrinkは.clip-rank-numクラス側で制御（同上）
  rankNum: {},
  thumb: {
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
  thumbPlayOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(10,10,14,0.15)",
  },
  thumbPlayIcon: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.92)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
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
    fontWeight: 600,
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
  reactionPopup: {
    position: "fixed",
    zIndex: 1000,
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    width: 232,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  },
  stampBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid",
    borderRadius: 20,
    padding: "5px 11px",
    fontSize: 12.5,
    fontWeight: 500,
  },
  stampCount: { fontSize: 11, color: "#6B6B78" },
  tagPopup: {
    position: "fixed",
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    width: 232,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  },
  tagChipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  tagAddForm: { display: "flex", gap: 6 },
  tagAddInput: {
    flex: 1,
    minWidth: 0,
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 12.5,
    color: "#EDEDF2",
  },
  tagAddBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#FF4D6D",
    border: "none",
    borderRadius: 8,
    color: "#1C1417",
    width: 30,
    flexShrink: 0,
  },
  tagSuggestRow: { display: "flex", flexWrap: "wrap", gap: 6, borderTop: "1px solid #24242F", paddingTop: 8 },
  tagSuggestBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "1px dashed #2E2E3A",
    borderRadius: 20,
    padding: "4px 9px",
    fontSize: 11.5,
    color: "#6B6B78",
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
  generalThreadLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    color: "#8A8A99",
    textDecoration: "none",
    marginTop: -8,
    marginBottom: 12,
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
  // 5ch風のフラットな1レス表示（カード無し、罫線区切りのみ）
  commentList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    borderTop: "1px solid #24242F",
    marginBottom: 14,
  },
  noComment: { fontSize: 13, color: "#6B6B78", margin: "20px 0" },
  commentItem: { padding: "10px 2px", borderBottom: "1px solid #24242F" },
  commentHead: { display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 8px", marginBottom: 4 },
  postNumber: { fontSize: 12.5, fontWeight: 700, color: "#FF4D6D", fontFamily: "'Consolas', monospace" },
  commentName: { fontSize: 12.5, fontWeight: 600, color: "#5DCAA5" },
  memberBadge: {
    display: "inline-block",
    marginLeft: 6,
    fontSize: 10.5,
    fontWeight: 700,
    color: "#FF4D6D",
    background: "#FF4D6D1A",
    border: "1px solid #FF4D6D40",
    borderRadius: 20,
    padding: "1px 6px",
    verticalAlign: 1,
  },
  clipperBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    marginLeft: 6,
    fontSize: 10.5,
    fontWeight: 700,
    color: "#7E14FF",
    background: "#7E14FF1A",
    border: "1px solid #7E14FF40",
    borderRadius: 20,
    padding: "1px 7px 1px 6px",
    verticalAlign: 1,
  },
  commentTime: { fontSize: 11.5, color: "#6B6B78", fontFamily: "'Consolas', monospace" },
  commentHeadActions: { display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" },
  commentBody: { fontSize: 13.5, margin: 0, lineHeight: 1.7, color: "#DADAE2", whiteSpace: "pre-wrap" },
  quoteRef: { color: "#5B8DEF", marginRight: 6 },
  reportBtn: {
    background: "transparent",
    border: "none",
    padding: 0,
    display: "flex",
    alignItems: "center",
  },
  replyBtn: {
    background: "transparent",
    border: "none",
    padding: 0,
    display: "flex",
    alignItems: "center",
    gap: 3,
    color: "#6B6B78",
    fontSize: 11.5,
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
};
