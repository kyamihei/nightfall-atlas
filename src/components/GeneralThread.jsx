import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Flag, CornerUpLeft, X, MessageSquare } from "lucide-react";
import { useComments, useCommentReport, useClip } from "../lib/use-clip-ranking";
import { supabase } from "../lib/supabase-client";

const GENERAL_THREAD_ID = "__general_thread__";
// 総合スレのコメント本文の先頭に付ける、元クリップを示す目印。表示時はこれを取り除いて
// 「◯◯について」チップに変換する（本文そのものへの埋め込みなのでDBスキーマ変更が不要）。
const CLIP_MARKER_RE = /^\[\[clip:([^\]]+)\]\]/;

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

function parseClipMarker(body) {
  const match = body.match(CLIP_MARKER_RE);
  if (!match) return { clipId: null, text: body };
  return { clipId: match[1], text: body.slice(match[0].length).trimStart() };
}

export default function GeneralThread() {
  const [searchParams] = useSearchParams();
  const fromClipId = searchParams.get("from");
  const { clip: fromClip } = useClip(fromClipId || "");

  const { comments, submit, submitting, error: commentError } = useComments(GENERAL_THREAD_ID);
  const { report: reportComment } = useCommentReport();

  const [nameDraft, setNameDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());
  const [replyTo, setReplyTo] = useState(null); // { id, display_name } | null
  const [clipTitles, setClipTitles] = useState({}); // clipId -> title（各コメントの元クリップ表示用）

  const topLevelComments = comments.filter((c) => !c.parent_id);
  const repliesByParent = comments.reduce((acc, c) => {
    if (!c.parent_id) return acc;
    (acc[c.parent_id] ??= []).push(c);
    return acc;
  }, {});

  // 各コメントに埋め込まれた元クリップIDをまとめて解決し、タイトルを取得する
  const referencedClipIds = useMemo(
    () => [...new Set(comments.map((c) => parseClipMarker(c.body).clipId).filter(Boolean))],
    [comments],
  );
  useEffect(() => {
    const missing = referencedClipIds.filter((id) => !(id in clipTitles));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("clips").select("id, title").in("id", missing);
      if (cancelled || !data) return;
      setClipTitles((prev) => {
        const next = { ...prev };
        for (const row of data) next[row.id] = row.title;
        for (const id of missing) if (!(id in next)) next[id] = null; // 見つからなかった分もnullで記録し、再取得を防ぐ
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencedClipIds.join(",")]);

  function handleSubmit() {
    const body = draft.trim();
    if (!body) {
      setLocalError("コメントを入力してください。");
      return;
    }
    setLocalError("");
    const prefixed = fromClipId ? `[[clip:${fromClipId}]]${body}` : body;
    submit(prefixed, nameDraft, replyTo?.id ?? null);
    setDraft("");
    setReplyTo(null);
  }

  function handleReport(commentId) {
    if (reportedIds.has(commentId)) return;
    setReportedIds((prev) => new Set(prev).add(commentId));
    reportComment(commentId);
  }

  function renderComment(c, isReply) {
    const { clipId, text } = parseClipMarker(c.body);
    const alreadyReported = reportedIds.has(c.id);
    return (
      <div style={isReply ? styles.commentItemReply : styles.commentItem}>
        {clipId && (
          <Link to={`/clips/${clipId}`} style={styles.clipTag}>
            <MessageSquare size={11} />
            {clipTitles[clipId] === undefined
              ? "読み込み中…"
              : clipTitles[clipId] === null
                ? "元のクリップ（削除済み）"
                : clipTitles[clipId]}
          </Link>
        )}
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
        <p style={styles.commentBody}>{text}</p>
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

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <header style={styles.header}>
        <h1 className="clip-title-font" style={styles.h1}>
          総合スレ
        </h1>
        <p style={styles.tagline}>クリップを問わず、この掲示板について自由に話すスレです</p>
        {fromClipId && (
          <div style={styles.fromBanner}>
            <span>
              <MessageSquare size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              「{fromClip?.title ?? "…"}」について投稿します
            </span>
            <Link to={`/clips/${fromClipId}`} style={styles.fromBannerLink}>
              クリップに戻る
            </Link>
          </div>
        )}
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
            placeholder={fromClipId ? "このクリップについて…" : "総合スレに投稿…"}
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
    textDecoration: "none",
    marginBottom: 18,
  },
  header: { borderBottom: "1px solid #24242F", paddingBottom: 20, marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 6px" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: 0 },
  fromBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "8px 12px",
    marginTop: 14,
    fontSize: 12.5,
    color: "#C4C4D0",
  },
  fromBannerLink: { color: "#8A8A99", fontSize: 12, textDecoration: "none", flexShrink: 0 },
  commentList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 },
  noComment: { fontSize: 13, color: "#6B6B78", margin: "20px 0", textAlign: "center" },
  commentItem: { background: "#1C1C26", border: "1px solid #24242F", borderRadius: 8, padding: "10px 12px" },
  commentItemReply: { background: "#18181F", border: "1px solid #22222C", borderRadius: 8, padding: "9px 12px" },
  replyIndent: { marginLeft: 20, paddingLeft: 12, borderLeft: "2px solid #24242F", marginTop: 8 },
  clipTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: "#9797A6",
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 12,
    padding: "2px 9px",
    marginBottom: 6,
    textDecoration: "none",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  commentHead: { display: "flex", justifyContent: "space-between", marginBottom: 3 },
  commentName: { fontSize: 12.5, fontWeight: 500, color: "#C4C4D0" },
  commentTime: { fontSize: 11.5, color: "#5A5A66" },
  commentBody: { fontSize: 13.5, margin: 0, lineHeight: 1.5, color: "#DADAE2" },
  reportBtn: { background: "transparent", border: "none", padding: 2, display: "flex", alignItems: "center" },
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
