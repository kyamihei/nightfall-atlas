import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Flag, CornerUpLeft, X, MessageSquare } from "lucide-react";
import { useComments, useCommentReport, useClip, useCommentMemberBadges } from "../lib/use-clip-ranking";
import { numberCommentsForDisplay, formatThreadTime } from "../lib/thread-format";
import { supabase } from "../lib/supabase-client";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

const GENERAL_THREAD_ID = "__general_thread__";
// 総合スレのコメント本文の先頭に付ける、元クリップを示す目印。表示時はこれを取り除いて
// 「◯◯について」チップに変換する（本文そのものへの埋め込みなのでDBスキーマ変更が不要）。
const CLIP_MARKER_RE = /^\[\[clip:([^\]]+)\]\]/;

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
  const commentIds = useMemo(() => comments.map((c) => c.id), [comments]);
  const memberBadges = useCommentMemberBadges(commentIds);

  const [nameDraft, setNameDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [reportedIds, setReportedIds] = useState(new Set());
  const [replyTo, setReplyTo] = useState(null); // { id, display_name } | null
  const [clipTitles, setClipTitles] = useState({}); // clipId -> title（各コメントの元クリップ表示用）

  // 5ch風にレス番号を振り、新しい順（上が最新）で表示する（2026-09-04、ユーザー要望）。
  // レス番号は投稿順で固定（表示順を変えても">>N"の参照先がズレないように）。
  const { display: displayComments, numberById } = numberCommentsForDisplay(comments);

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

  function renderComment(c) {
    const { clipId, text } = parseClipMarker(c.body);
    const alreadyReported = reportedIds.has(c.id);
    const parentNumber = c.parent_id ? numberById.get(c.parent_id) : null;
    return (
      <div key={c.id} style={styles.commentItem}>
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
          <span style={styles.postNumber}>{c.number}</span>
          <span style={styles.commentName}>
            {c.display_name}
            {memberBadges[c.id] && <span style={styles.memberBadge}>#{memberBadges[c.id]}</span>}
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
          {text}
        </p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <BackgroundGlow />
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
  commentList: { display: "flex", flexDirection: "column", borderTop: "1px solid #24242F", marginBottom: 16 },
  noComment: { fontSize: 13, color: "#6B6B78", margin: "20px 0", textAlign: "center" },
  // 5ch風のフラットな1レス表示（カード無し、罫線区切りのみ）。返信も同じ見た目で並べ、
  // 本文冒頭の">>N"で参照先を示す（indentによるネスト表現はやめた、2026-09-04）。
  commentItem: { padding: "10px 2px", borderBottom: "1px solid #24242F" },
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
  commentTime: { fontSize: 11.5, color: "#6B6B78", fontFamily: "'Consolas', monospace" },
  commentHeadActions: { display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" },
  commentBody: { fontSize: 13.5, margin: 0, lineHeight: 1.7, color: "#DADAE2", whiteSpace: "pre-wrap" },
  quoteRef: { color: "#5B8DEF", marginRight: 6 },
  reportBtn: { background: "transparent", border: "none", padding: 2, display: "flex", alignItems: "center" },
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
