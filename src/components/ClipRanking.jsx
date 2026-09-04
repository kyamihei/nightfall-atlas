import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Heart, ThumbsDown, MessageCircle, Send, Loader2, Flag, Search, UserPlus, X, ChevronLeft, ChevronRight, ChevronDown, Users, ListChecks, Film, Star, CornerUpLeft, Scissors, TrendingUp, MessageSquare, Smile, Calendar, Play, Flame, Hash, ExternalLink, Settings, Sparkles, Award, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase-client";
import {
  useClips,
  useReactions,
  useFavorites,
  useFavoriteCounts,
  useClipStamps,
  REACTION_STAMPS,
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
      title="クリックでコメントを開く（サムネイル＝動画再生、タイトル＝詳細ページ）"
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
          className="cv-clip-thumb"
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
            position: "relative",
          }}
          aria-label={playerOpen ? "動画を閉じる" : "動画を再生"}
          title={playerOpen ? "動画を閉じる" : "クリックでこの場で動画を再生"}
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
          {!playerOpen && (
            <span style={styles.thumbPlayOverlay}>
              <span style={styles.thumbPlayIcon}>
                <Play size={12} fill="#14141B" color="#14141B" style={{ marginLeft: 1 }} />
              </span>
            </span>
          )}
        </button>

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
        </div>
      </div>

      <div className="cv-fade-in" style={styles.stampPickerRow} onClick={(e) => e.stopPropagation()}>
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
            「{item.clipTitle}」にスタンプが押されました
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
        <div className="cv-skeleton cv-clip-thumb" style={styles.skeletonThumb} />
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
  const [tagFilter, setTagFilter] = useState(""); // ""=絞り込みなし。自分で付けた配信者タグで絞り込む
  const { tags: myTags, streamersByTag } = useMyBroadcasterTags();
  const tagStreamerFilter = tagFilter ? streamersByTag[tagFilter] ?? [] : null;

  // ヘッダーの「会員登録」リンクをログイン中のユーザーには出さない・代わりにログアウトを
  // 出す判定用（2026-09-04追加。ログイン中に「新規登録」フォームへ入ると既存メールの変更
  // フローに入ってしまい混乱を招く不具合が実際に発生したための対応）。
  const {
    memberNumber,
    nickname,
    isAnonymous: isAnonymousSession,
    loading: membershipLoading,
  } = useMembership();
  async function handleLogout() {
    await supabase.auth.signOut({ scope: "local" });
    window.location.reload(); // 新しい匿名セッションで全データを作り直すのが確実なため
  }
  const { clips, loading, error: clipsError, totalCount } = useClips(
    PAGE_SIZE,
    period,
    period === "day" ? selectedDay : undefined,
    page,
    sortBy,
    tagStreamerFilter,
  );
  const { clips: trendingClips, loading: trendingLoading } = useTrendingClips(5, 72);
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
    5,
  );

  const [activeCommentClipId, setActiveCommentClipId] = useState(null);
  const [commentsDataByClip, setCommentsDataByClip] = useState({});
  const [nameDraft, setNameDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [requestDraft, setRequestDraft] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());

  // ランキング欄／トレンド欄のタブ切り替え。slideDirは切り替え時のスライド方向
  // （タブクリックでは並び順から、スワイプでは指の動きから決める）。
  // 選択中のタブはURLのクエリ（?view=trending）にも反映する。クリップ詳細ページから
  // ブラウザの戻る/「戻る」リンクで復帰した際に、トレンドタブを見ていたのにランキングタブへ
  // 戻ってしまう（活性タブがコンポーネント内のstateだけで管理されており、詳細ページへの遷移で
  // アンマウントされると失われるため）不具合の対応（2026-09-04）。
  const VIEW_TABS = ["ranking", "trending"];
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const periodPickerRef = useRef(null);

  useEffect(() => {
    if (!periodPickerOpen) return;
    function handleClickOutside(e) {
      if (periodPickerRef.current && !periodPickerRef.current.contains(e.target)) {
        setPeriodPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [periodPickerOpen]);

  function handlePeriodSelect(value) {
    setPeriod(value);
    if (value !== "day") setPeriodPickerOpen(false);
  }

  function handleDaySelect(d) {
    setSelectedDay(d);
    setPeriodPickerOpen(false);
  }

  const periodButtonLabel =
    period === "day" ? formatDayLabel(selectedDay) : PERIOD_TABS.find((t) => t.value === period)?.label ?? "";

  const { results: broadcasterResults, searching: broadcasterSearching } = useBroadcasterSearch(searchQuery);
  const { request: requestBroadcaster, submitting: requesting, result: requestResult } = useBroadcasterRequest();
  const { report: reportComment } = useCommentReport();

  // 期間・日付・並び替え・検索条件・タグ絞り込みが変わったら1ページ目に戻す
  // （違うページに条件が引き継がれて空表示になるのを防ぐ）
  useEffect(() => {
    setPage(1);
  }, [period, selectedDay, sortBy, searchQuery, tagFilter]);

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
        .cv-nav-link {
          transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
        }
        .cv-nav-link:hover {
          background: #FF4D6D14;
          border-color: #FF4D6D55;
          color: #EDEDF2;
          transform: translateY(-1px);
        }
        .cv-clip-thumb { width: 64px; height: 44px; }
        .cv-clip-title { font-size: 15px; }
        .cv-clip-title-link:hover .cv-clip-title { text-decoration: underline; }
        @media (min-width: 901px) {
          .cv-clip-thumb { width: 132px; height: 74px; }
          .cv-clip-title { font-size: 19px; }
        }
        @media (max-width: 640px) {
          .cv-header { flex-direction: column; align-items: flex-start; }
          .cv-header-controls { align-items: flex-start; width: 100%; }
          .cv-nav-links { justify-content: flex-start; }
          .cv-search-box { width: 100%; }
          .cv-row-main { flex-wrap: wrap; row-gap: 10px; }
          .cv-row-actions { flex-basis: 100%; justify-content: flex-end; }
        }
      `}</style>

      <NewSiteBanner />

      <header className="cv-header" style={styles.header}>
        <div>
          <div style={styles.eyebrowRow}>
            <span className="cv-live-dot" style={styles.liveDot} />
            <span style={styles.eyebrow}>Twitchクリップの掲示板</span>
          </div>
          <h1 style={styles.h1}>
            <img src="/favicon.ico" alt="" style={styles.h1Icon} />
            クリスレ
          </h1>
          <p style={styles.tagline}>みんなのお気に入りのクリップにコメントしてみよう！</p>
        </div>
        <div className="cv-header-controls" style={styles.headerControls}>
          <div className="cv-nav-links" style={styles.headerLinks}>
            <Link to="/broadcasters" className="cv-nav-link" style={styles.navLink}>
              <Users size={15} />
              配信者一覧
            </Link>
            <Link to="/clippers" className="cv-nav-link" style={styles.navLink}>
              <Scissors size={15} />
              クリップ職人
            </Link>
            <Link to="/search" className="cv-nav-link" style={styles.navLink}>
              <Search size={15} />
              クリップ検索
            </Link>
            <Link to="/general" className="cv-nav-link" style={styles.navLink}>
              <MessageSquare size={15} />
              総合スレ
            </Link>
            <Link to="/threads" className="cv-nav-link" style={styles.navLink}>
              <Hash size={15} />
              タグスレ
            </Link>
            {REACTIONS_ENABLED && (
              <Link to="/my-reactions" className="cv-nav-link" style={styles.navLink}>
                <ListChecks size={15} />
                評価した動画
              </Link>
            )}
            <Link to="/my-stamps" className="cv-nav-link" style={styles.navLink}>
              <Smile size={15} />
              スタンプ一覧
            </Link>
            <Link to="/favorites" className="cv-nav-link" style={styles.navLink}>
              <Star size={15} />
              お気に入り
            </Link>
            {!membershipLoading && !isAnonymousSession ? (
              <>
                {memberNumber !== null && (
                  <Link to="/mypage" className="cv-nav-link" style={styles.navLinkStatic}>
                    <Award size={15} />
                    会員 #{memberNumber}
                  </Link>
                )}
                <button onClick={handleLogout} className="cv-nav-link" style={styles.navLinkBtn}>
                  <LogOut size={15} />
                  ログアウト
                </button>
              </>
            ) : (
              <Link to="/register" className="cv-nav-link" style={styles.navLink}>
                <UserPlus size={15} />
                会員登録
              </Link>
            )}
            <a
              href="https://x.com/kurisure_info"
              target="_blank"
              rel="noopener noreferrer"
              className="cv-nav-link"
              style={{ ...styles.navLink, color: "#AFA9EC", borderColor: "#3D3766" }}
            >
              <ExternalLink size={15} />
              Xでフォロー
            </a>
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
              <div ref={periodPickerRef} style={styles.periodPickerWrap}>
                <button
                  onClick={() => setPeriodPickerOpen((o) => !o)}
                  style={styles.periodPickerBtn}
                  aria-expanded={periodPickerOpen}
                >
                  <Calendar size={13} />
                  {periodButtonLabel}
                  <ChevronDown
                    size={13}
                    style={{
                      transform: periodPickerOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.15s ease",
                    }}
                  />
                </button>
                {periodPickerOpen && (
                  <div className="cv-fade-in" style={styles.periodPickerPanel}>
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
                  </div>
                )}
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
              {myTags.length > 0 && (
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  style={styles.sortSelect}
                  aria-label="マイタグで絞り込み"
                >
                  <option value="">すべての配信者</option>
                  {myTags.map((t) => (
                    <option key={t} value={t}>
                      「{t}」タグのみ
                    </option>
                  ))}
                </select>
              )}
            </div>

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
                      stampCounts={stampCounts[clip.id]}
                      myStamps={myStamps[clip.id]}
                      onToggleStamp={toggleStamp}
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
          <div style={styles.list}>
            {trendingLoading && (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
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
    maxWidth: 1200,
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
  headerControls: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 },
  headerLinks: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  navLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "8px 14px",
    color: "#C4C4D0",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  navLinkStatic: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#FF4D6D1A",
    border: "1px solid #FF4D6D40",
    borderRadius: 8,
    padding: "8px 14px",
    color: "#FF4D6D",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  navLinkBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "8px 14px",
    color: "#C4C4D0",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    whiteSpace: "nowrap",
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
  h1: {
    fontFamily: "'RocknRoll One', sans-serif",
    fontSize: 32,
    fontWeight: 400,
    margin: "0 0 6px",
    letterSpacing: 0.5,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  h1Icon: { width: 30, height: 30, borderRadius: 6, flexShrink: 0 },
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
    minWidth: 240,
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
  skeletonThumb: { borderRadius: 6, flexShrink: 0 },
  skeletonTitle: { width: "70%", height: 14, borderRadius: 4 },
  skeletonMeta: { width: "40%", height: 11, borderRadius: 4 },
  skeletonPill: { width: 52, height: 26, borderRadius: 8 },
  rankNum: { fontSize: 26, fontWeight: 600, width: 34, flexShrink: 0 },
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
  stampPickerRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #24242F",
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
