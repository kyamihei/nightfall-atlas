import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Heart, ThumbsDown, Send, Flag, Loader2 } from "lucide-react";
import {
  useClip,
  useReactions,
  useComments,
  useCommentReport,
} from "../lib/use-clip-ranking";

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

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function ClipDetail() {
  const { id } = useParams();
  const { clip, loading, error } = useClip(id);
  const clipIds = clip ? [clip.id] : [];
  const { counts, myVotes, vote } = useReactions(clipIds);
  const { comments, submit, submitting, error: commentError } = useComments(id);
  const { report: reportComment } = useCommentReport();

  const [nameDraft, setNameDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());

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

  function handleReport(commentId) {
    if (reportedIds.has(commentId)) return;
    setReportedIds((prev) => new Set(prev).add(commentId));
    reportComment(commentId);
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

  if (error || !clip) {
    return (
      <div style={styles.page}>
        <Link to="/" style={styles.backLink}>
          <ArrowLeft size={14} />
          ランキングに戻る
        </Link>
        <p style={styles.errorText}>{error || "クリップが見つかりませんでした"}</p>
      </div>
    );
  }

  const stats = counts[clip.id] || { likes: 0, dislikes: 0 };
  const myVote = myVotes[clip.id];

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

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
          {clip.streamer}
        </Link>
        {" ・ "}
        {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴 ・ {formatDate(clip.twitch_created_at)}
      </p>

      <div style={styles.actions}>
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
      </div>

      <section style={styles.commentSection}>
        <h2 style={styles.commentHeading}>コメント（{comments.length}）</h2>
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
                      onClick={() => handleReport(c.id)}
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
            onChange={(e) => setNameDraft(e.target.value)}
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
            <button onClick={handleSubmit} style={styles.sendBtn} aria-label="コメントを送信" disabled={submitting}>
              <Send size={15} />
            </button>
          </div>
          {(localError || commentError) && (
            <p style={styles.commentErrorText}>{localError || commentError}</p>
          )}
        </div>
      </section>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 20px 60px",
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
    textDecoration: "none",
    marginBottom: 18,
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
  metaLine: { fontSize: 13, color: "#8A8A99", margin: "0 0 18px" },
  streamerLink: { color: "#EDEDF2", fontWeight: 500, textDecoration: "none" },
  actions: { display: "flex", gap: 8, marginBottom: 28 },
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
  commentList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 },
  noComment: { fontSize: 13, color: "#6B6B78", margin: 0 },
  commentItem: { background: "#1C1C26", border: "1px solid #24242F", borderRadius: 8, padding: "10px 12px" },
  commentHead: { display: "flex", justifyContent: "space-between", marginBottom: 3 },
  commentName: { fontSize: 12.5, fontWeight: 500, color: "#C4C4D0" },
  commentTime: { fontSize: 11.5, color: "#5A5A66" },
  commentBody: { fontSize: 13.5, margin: 0, lineHeight: 1.5, color: "#DADAE2" },
  reportBtn: { background: "transparent", border: "none", padding: 2, display: "flex", alignItems: "center" },
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
