import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MessageSquare, Plus, Search } from "lucide-react";
import { useTagThreads, useGetOrCreateTagThread } from "../lib/use-clip-ranking";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function TagThreadList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { threads, loading } = useTagThreads();
  const { getOrCreate, submitting, error } = useGetOrCreateTagThread();
  const [searchQuery, setSearchQuery] = useState("");
  const [titleDraft, setTitleDraft] = useState("");

  // BroadcasterDetail.jsxの「マイタグ」チップから「?new=タグ名」で来た場合、作成欄に自動入力する
  useEffect(() => {
    const prefill = searchParams.get("new");
    if (prefill) setTitleDraft(prefill);
  }, [searchParams]);

  const visible = threads.filter(
    (t) => !searchQuery.trim() || t.title.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  async function handleCreate() {
    const trimmed = titleDraft.trim();
    if (!trimmed) return;
    const result = await getOrCreate(trimmed);
    if (result) navigate(`/threads/${result.id}`);
  }

  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; text-decoration: none; }
        textarea:focus, input:focus { outline: 2px solid #FF4D6D33; }
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

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <header style={styles.header}>
        <h1 className="clip-title-font" style={styles.h1}>
          タグスレ
        </h1>
        <p style={styles.tagline}>
          マイタグに関連する話題（例:「ZETA」のイベントについて等）を自由に立てて話せるスレです
        </p>
      </header>

      <div style={styles.createBox}>
        <p style={styles.createLabel}>新しいスレを立てる</p>
        <div style={styles.createRow}>
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="スレのタイトル（例: ZETA）"
            style={styles.createInput}
            maxLength={40}
          />
          <button onClick={handleCreate} style={styles.createBtn} disabled={submitting}>
            <Plus size={14} />
            {submitting ? "作成中…" : "スレを立てる"}
          </button>
        </div>
        {error && <p style={styles.errorText}>{error}</p>}
        <p style={styles.createNote}>※ 同じタイトルのスレが既にある場合は、そのスレに移動します</p>
      </div>

      <div className="cv-search-box" style={styles.searchBox}>
        <Search size={14} color="#6B6B78" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="スレを検索…"
          style={styles.searchInput}
        />
      </div>

      <div style={styles.list}>
        {loading && <p style={styles.loadingText}>読み込み中…</p>}
        {!loading && visible.length === 0 && (
          <div style={styles.emptyState}>
            {searchQuery.trim() ? "該当するスレが見つかりませんでした。" : "まだスレがありません。最初のスレを立ててみましょう。"}
          </div>
        )}
        {!loading &&
          visible.map((t, i) => (
            <Link
              key={t.id}
              className="cv-list-row cv-fade-in-up"
              to={`/threads/${t.id}`}
              style={{ ...styles.row, animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <div style={styles.rowIcon}>
                <MessageSquare size={16} />
              </div>
              <div style={styles.infoCol}>
                <p className="clip-title-font" style={styles.rowTitle}>
                  {t.title}
                </p>
                <p style={styles.rowMeta}>
                  コメント{t.comment_count}件 ・ {timeAgo(new Date(t.created_at).getTime())}
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
    marginBottom: 18,
  },
  header: { borderBottom: "1px solid #24242F", paddingBottom: 20, marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 6px" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: 0 },
  createBox: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 18,
  },
  createLabel: { fontSize: 12.5, fontWeight: 600, color: "#C4C4D0", margin: "0 0 8px" },
  createRow: { display: "flex", gap: 8 },
  createInput: {
    flex: 1,
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 13.5,
    color: "#EDEDF2",
  },
  createBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#FF4D6D",
    border: "none",
    borderRadius: 6,
    color: "#1C1417",
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  errorText: { fontSize: 12, color: "#F0997B", margin: "8px 0 0" },
  createNote: { fontSize: 11.5, color: "#5A5A66", margin: "8px 0 0" },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "8px 12px",
    marginBottom: 16,
  },
  searchInput: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#EDEDF2",
    fontSize: 13,
    width: "100%",
  },
  loadingText: { color: "#8A8A99", fontSize: 14, textAlign: "center", padding: "30px 0" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  emptyState: { color: "#6B6B78", fontSize: 14, padding: "30px 0", textAlign: "center" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "12px 14px",
    color: "#EDEDF2",
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: "#20202B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#8A8A99",
    flexShrink: 0,
  },
  infoCol: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, fontWeight: 600, margin: "0 0 3px" },
  rowMeta: { fontSize: 12, color: "#6B6B78", margin: 0 },
};
