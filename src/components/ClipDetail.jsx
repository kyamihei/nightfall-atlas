import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Heart, ThumbsDown, Star, Send, Flag, Loader2, CornerUpLeft, X, Scissors, MessageSquare, Plus } from "lucide-react";
import {
  useClip,
  useReactions,
  useFavorites,
  useFavoriteCounts,
  useClipStamps,
  useClipTags,
  useComments,
  useCommentReport,
  useBroadcasterAvatars,
  useClipperRanks,
  useCommentMemberBadges,
  useMembership,
  REACTION_STAMPS,
} from "../lib/use-clip-ranking";
import { REACTIONS_ENABLED } from "../lib/feature-flags";
import { useDocumentMeta } from "../lib/use-document-meta";
import { useSmartBack } from "../lib/use-smart-back";
import { numberCommentsForDisplay, formatThreadTime } from "../lib/thread-format";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";
import ShareButtons from "./ShareButtons";
import CommentNameField from "./CommentNameField";

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

function formatDate(iso) {
  if (!iso) return "日時不明";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClipDetail() {
  const { id } = useParams();
  const goBack = useSmartBack("/");
  const { clip, loading, error } = useClip(id);
  // clip ? [clip.id] : [] を毎レンダー新しい配列として作ると、これに依存する
  // useReactions/useFavorites/useFavoriteCountsのuseEffectが再発火し続け、
  // 非同期取得→setState→再レンダー→配列再生成…の無限ループになる（実際に発生・修正）。
  const clipIds = useMemo(() => (clip ? [clip.id] : []), [clip]);
  const { counts, myVotes, vote } = useReactions(clipIds);
  const { favoritedIds, toggle: toggleFavoriteRaw } = useFavorites(clipIds);
  const { counts: favoriteCounts, refresh: refreshFavoriteCounts } = useFavoriteCounts(clipIds);
  async function toggleFavorite(clipId) {
    await toggleFavoriteRaw(clipId);
    refreshFavoriteCounts();
  }
  const { counts: stampCounts, myStamps, toggle: toggleStamp } = useClipStamps(clipIds);
  const { counts: clipTagCounts, myTags: myClipTags, toggle: toggleClipTag } = useClipTags(clipIds);
  const [tagInput, setTagInput] = useState("");
  function handleAddTag(e) {
    e.preventDefault();
    const trimmed = tagInput.trim();
    if (!trimmed || !clip) return;
    toggleClipTag(clip.id, trimmed);
    setTagInput("");
  }
  const avatars = useBroadcasterAvatars(clip ? [clip.streamer] : []);
  const clipperRanks = useClipperRanks(clip ? [clip.creator_id] : []);
  const { comments, submit, submitting, error: commentError } = useComments(id);
  const { report: reportComment } = useCommentReport();
  const commentIds = useMemo(() => comments.map((c) => c.id), [comments]);
  const memberBadges = useCommentMemberBadges(commentIds);

  useDocumentMeta({
    title: clip ? `${clip.title} - ${clip.streamer} | クリスレ` : null,
    description: clip
      ? `${clip.streamer}のクリップ「${clip.title}」・${formatViews(clip.view_count)}回視聴${clip.creator_name ? `・クリップ職人: ${clip.creator_name}` : ""}`
      : null,
    image: clip?.thumbnail_url,
    path: clip ? `/clips/${clip.id}` : null,
  });

  const { nickname } = useMembership();
  const [nameDraft, setNameDraft] = useState("");
  const [useNickname, setUseNickname] = useState(true);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());
  const [replyTo, setReplyTo] = useState(null); // { id, display_name } | null

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

  function handleReport(commentId) {
    if (reportedIds.has(commentId)) return;
    setReportedIds((prev) => new Set(prev).add(commentId));
    reportComment(commentId);
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
              onClick={() => handleReport(c.id)}
              disabled={alreadyReported}
              style={{ ...styles.reportBtn, color: alreadyReported ? "#4A4A54" : "#6B6B78" }}
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

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <Loader2 size={22} style={{ animation: "cv-spin 1s linear infinite" }} />
        <span style={{ marginLeft: 10 }}>読み込み中…</span>
      </div>
    );
  }

  if (error || !clip) {
    return (
      <div style={styles.page}>
        <BackgroundGlow />
        <button onClick={goBack} style={styles.backLink}>
          <ArrowLeft size={14} />
          ランキングに戻る
        </button>
        <p style={styles.errorText}>{error || "クリップが見つかりませんでした"}</p>
      </div>
    );
  }

  const stats = counts[clip.id] || { likes: 0, dislikes: 0 };
  const myVote = myVotes[clip.id];

  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <button onClick={goBack} style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </button>

      <div style={styles.playerWrap}>
        <iframe
          src={`https://clips.twitch.tv/embed?clip=${clip.id}&parent=${window.location.hostname}&autoplay=false`}
          style={styles.playerFrame}
          allowFullScreen
          title={clip.title}
        />
      </div>

      <h1 className="clip-title-font" style={styles.title}>
        {clip.title}
      </h1>
      <p style={styles.metaLine}>
        <Link to={`/broadcasters/${encodeURIComponent(clip.streamer)}`} style={styles.streamerLink}>
          {avatars[clip.streamer] ? (
            <img src={avatars[clip.streamer]} alt="" style={styles.rowAvatar} />
          ) : (
            <span style={styles.rowAvatarFallback} />
          )}
          {clip.streamer}
        </Link>
        {" ・ "}
        {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴 ・ {formatDate(clip.twitch_created_at)}
      </p>
      {clip.creator_id && (
        <Link to={`/clippers/${encodeURIComponent(clip.creator_id)}`} style={styles.clipperLine}>
          <Scissors size={12} />
          クリップ職人: {clip.creator_name}
          {clipperRanks[clip.creator_id] && (
            <span style={styles.clipperRankBadge}>総合{clipperRanks[clip.creator_id]}位</span>
          )}
        </Link>
      )}

      <div style={styles.actions}>
        {REACTIONS_ENABLED && (
          <>
            <button
              onClick={() => vote(clip.id, "like")}
              style={{
                ...styles.actionBtn,
                color: myVote === "like" ? "#FF4D6D" : "#8A8A99",
                borderColor: myVote === "like" ? "#FF4D6D55" : "#2E2E3A",
              }}
              aria-label="いいね"
            >
              <Heart size={16} fill={myVote === "like" ? "#FF4D6D" : "none"} />
              {stats.likes}
            </button>
            <button
              onClick={() => vote(clip.id, "dislike")}
              style={{
                ...styles.actionBtn,
                color: myVote === "dislike" ? "#4DD8FF" : "#8A8A99",
                borderColor: myVote === "dislike" ? "#4DD8FF55" : "#2E2E3A",
              }}
              aria-label="よくないね"
            >
              <ThumbsDown size={16} fill={myVote === "dislike" ? "#4DD8FF" : "none"} />
              {stats.dislikes}
            </button>
          </>
        )}
        <button
          onClick={() => toggleFavorite(clip.id)}
          style={{
            ...styles.actionBtn,
            color: favoritedIds.has(clip.id) ? "#FFC857" : "#8A8A99",
            borderColor: favoritedIds.has(clip.id) ? "#FFC85755" : "#2E2E3A",
          }}
          aria-label={favoritedIds.has(clip.id) ? "お気に入りから外す" : "お気に入りに追加"}
        >
          <Star size={16} fill={favoritedIds.has(clip.id) ? "#FFC857" : "none"} />
          {favoritedIds.has(clip.id) ? "お気に入り済み" : "お気に入り"}
          {favoriteCounts[clip.id] > 0 ? `（${favoriteCounts[clip.id]}）` : ""}
        </button>
        <Link to={`/general?from=${clip.id}`} style={styles.generalThreadBtn}>
          <MessageSquare size={14} />
          総合スレで話す
        </Link>
      </div>

      <div style={{ marginBottom: 14 }}>
        <ShareButtons
          url={`https://kurisure.jp/clips/${clip.id}`}
          text={`${clip.title} - ${clip.streamer}｜クリスレ`}
        />
      </div>

      <div style={styles.stampRow}>
        {REACTION_STAMPS.map((stamp) => {
          const count = stampCounts[clip.id]?.[stamp] ?? 0;
          const selected = myStamps[clip.id]?.has(stamp) ?? false;
          return (
            <button
              key={stamp}
              onClick={() => toggleStamp(clip.id, stamp)}
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

      <div style={styles.stampRow}>
        {Object.entries(clipTagCounts[clip.id] ?? {})
          .sort((a, b) => b[1] - a[1])
          .map(([tag, count]) => {
            const selected = myClipTags[clip.id]?.has(tag) ?? false;
            return (
              <button
                key={tag}
                onClick={() => toggleClipTag(clip.id, tag)}
                style={{
                  ...styles.stampBtn,
                  color: selected ? "#5DCAA5" : "#8A8A99",
                  borderColor: selected ? "#5DCAA555" : "#2E2E3A",
                  background: selected ? "#15302966" : "transparent",
                }}
              >
                {tag}
                {count > 0 && <span style={styles.stampCount}>{count}</span>}
              </button>
            );
          })}
        <form onSubmit={handleAddTag} style={styles.tagAddForm}>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="新しいタグ（15文字以内）"
            maxLength={15}
            style={styles.tagAddInput}
          />
          <button type="submit" style={styles.tagAddBtn} aria-label="タグを追加">
            <Plus size={14} />
          </button>
        </form>
      </div>

      <section style={styles.commentSection}>
        <h2 style={styles.commentHeading}>コメント（{comments.length}）</h2>
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
            onFreeTextChange={setNameDraft}
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
            <button onClick={handleSubmit} style={styles.sendBtn} aria-label="コメントを送信" disabled={submitting}>
              <Send size={15} />
            </button>
          </div>
          {(localError || commentError) && (
            <p style={styles.commentErrorText}>{localError || commentError}</p>
          )}
        </div>
      </section>

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
    maxWidth: 1000,
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
    marginBottom: 18,
    background: "none",
    border: "none",
    padding: 0,
  },
  errorText: { color: "#F0997B", fontSize: 14 },
  playerWrap: { marginBottom: 18 },
  playerFrame: {
    width: "100%",
    aspectRatio: "16 / 9",
    border: "none",
    borderRadius: 10,
  },
  title: { fontSize: 22, fontWeight: 600, margin: "0 0 8px", lineHeight: 1.3 },
  metaLine: { fontSize: 13, color: "#8A8A99", margin: "0 0 8px" },
  clipperLine: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "#8A8A99",
    textDecoration: "none",
    marginBottom: 20,
  },
  clipperRankBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#1C1417",
    background: "#FFC857",
    borderRadius: 10,
    padding: "1px 8px",
    marginLeft: 2,
  },
  streamerLink: {
    color: "#EDEDF2",
    fontWeight: 500,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    verticalAlign: "middle",
  },
  rowAvatar: { width: 20, height: 20, borderRadius: "50%", objectFit: "cover" },
  rowAvatarFallback: { width: 20, height: 20, borderRadius: "50%", background: "#20202B", display: "inline-block" },
  actions: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  generalThreadBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13.5,
    color: "#8A8A99",
    textDecoration: "none",
  },
  stampRow: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 28 },
  stampBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
  },
  stampCount: { fontSize: 11.5, color: "#6B6B78" },
  tagAddForm: { display: "flex", gap: 6 },
  tagAddInput: {
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 13,
    color: "#EDEDF2",
    width: 160,
  },
  tagAddBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#FF4D6D",
    border: "none",
    borderRadius: "50%",
    color: "#1C1417",
    width: 30,
    height: 30,
    flexShrink: 0,
  },
  actionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13.5,
  },
  commentSection: { borderTop: "1px solid #24242F", paddingTop: 20 },
  commentHeading: { fontSize: 15, fontWeight: 500, margin: "0 0 14px" },
  // 5ch風のフラットな1レス表示（カード無し、罫線区切りのみ）
  commentList: { display: "flex", flexDirection: "column", borderTop: "1px solid #24242F", marginBottom: 16 },
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
  reportBtn: { background: "transparent", border: "none", padding: 0, display: "flex", alignItems: "center" },
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
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    color: "#9797A6",
  },
  replyCancelBtn: { background: "transparent", border: "none", color: "#8A8A99", display: "flex", alignItems: "center" },
  commentErrorText: { fontSize: 12, color: "#F0997B", margin: "2px 0 0" },
  commentForm: { display: "flex", flexDirection: "column", gap: 6 },
  nameInput: {
    background: "#1C1C26",
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
    background: "#1C1C26",
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
