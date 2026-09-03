import { useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, Send, CornerUpLeft, X } from "lucide-react";
import { useTagThread, useTagThreadComments } from "../lib/use-clip-ranking";
import { useSmartBack } from "../lib/use-smart-back";
import Footer from "./Footer";

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function TagThreadDetail() {
  const { id } = useParams();
  const goBack = useSmartBack("/threads");
  const { thread, loading: threadLoading } = useTagThread(id);
  const { comments, submit, submitting, error: commentError } = useTagThreadComments(id);

  const [nameDraft, setNameDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { id, display_name } | null

  const topLevelComments = comments.filter((c) => !c.parent_id);
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
          </div>
        </div>
        <p style={styles.commentBody}>{c.body}</p>
      </div>
    );
  }

  if (!threadLoading && !thread) {
    return (
      <div style={styles.page}>
        <button onClick={goBack} style={styles.backLink}>
          <ArrowLeft size={14} />
          タグスレ一覧に戻る
        </button>
        <p style={styles.notFound}>このスレは見つかりませんでした。</p>
        <Footer />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <button onClick={goBack} style={styles.backLink}>
        <ArrowLeft size={14} />
        タグスレ一覧に戻る
      </button>

      <header style={styles.header}>
        <h1 className="clip-title-font" style={styles.h1}>
          {threadLoading ? "読み込み中…" : thread.title}
        </h1>
        <p style={styles.tagline}>このタグに関連する話題を自由に投稿できます</p>
      </header>

      <div style={styles.commentList}>
        {comments.length === 0 && (
          <p style={styles.noComment}>まだ投稿はありません。最初のコメントを投稿してみましょう。</p>
        )}
        {topLevelComments.map((c) => (
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
            placeholder={replyTo ? `${replyTo.display_name} への返信…` : "このスレに投稿…"}
            style={styles.commentInput}
            rows={2}
            maxLength={280}
          />
          <button onClick={handleSubmit} style={styles.sendBtn} aria-label="投稿する" disabled={submitting}>
            <Send size={15} />
          </button>
        </div>
        {(localError || commentError) && <p style={styles.commentErrorText}>{localError || commentError}</p>}
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
    padding: "28px 32px 60px",
    maxWidth: 800,
    margin: "0 auto",
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
  notFound: { color: "#8A8A99", fontSize: 14, textAlign: "center", padding: "40px 0" },
  header: { borderBottom: "1px solid #24242F", paddingBottom: 20, marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 6px" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: 0 },
  commentList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 },
  noComment: { fontSize: 13, color: "#6B6B78", margin: "20px 0", textAlign: "center" },
  commentItem: { background: "#1C1C26", border: "1px solid #24242F", borderRadius: 8, padding: "10px 12px" },
  commentItemReply: { background: "#18181F", border: "1px solid #22222C", borderRadius: 8, padding: "9px 12px" },
  replyIndent: { marginLeft: 20, paddingLeft: 12, borderLeft: "2px solid #24242F", marginTop: 8 },
  commentHead: { display: "flex", justifyContent: "space-between", marginBottom: 3 },
  commentName: { fontSize: 12.5, fontWeight: 500, color: "#C4C4D0" },
  commentTime: { fontSize: 11.5, color: "#5A5A66" },
  commentBody: { fontSize: 13.5, margin: 0, lineHeight: 1.5, color: "#DADAE2" },
  replyBtn: { background: "transparent", border: "none", padding: 2, display: "flex", alignItems: "center", color: "#6B6B78" },
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
