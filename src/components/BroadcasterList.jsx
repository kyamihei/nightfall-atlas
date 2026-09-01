import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useTopBroadcasters } from "../lib/use-clip-ranking";

const PAGE_SIZE = 30;

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

export default function BroadcasterList() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const { broadcasters, loading } = useTopBroadcasters(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const visible = broadcasters.filter(
    (b) => !searchQuery.trim() || b.streamer.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        input:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <header style={styles.header}>
        <div>
          <Link to="/" style={styles.backLink}>
            <ArrowLeft size={14} />
            ランキングに戻る
          </Link>
          <h1 className="clip-title-font" style={styles.h1}>
            配信者一覧
          </h1>
          <p style={styles.tagline}>合計視聴回数順</p>
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
      </header>

      {loading ? (
        <p style={styles.loadingText}>読み込み中…</p>
      ) : (
        <>
          <div style={styles.list}>
            {visible.length === 0 && <div style={styles.emptyState}>該当する配信者が見つかりませんでした。</div>}
            {visible.map((b, i) => (
              <Link key={b.streamer} to={`/broadcasters/${encodeURIComponent(b.streamer)}`} style={styles.row}>
                <div style={styles.rankNum}>{String((page - 1) * PAGE_SIZE + i + 1).padStart(2, "0")}</div>
                {b.profile_image_url ? (
                  <img src={b.profile_image_url} alt="" style={styles.avatar} />
                ) : (
                  <div style={styles.avatarFallback} />
                )}
                <div style={styles.infoCol}>
                  <div style={styles.nameRow}>
                    <p style={styles.name}>{b.streamer}</p>
                    {b.tag && <span style={styles.tagBadge}>{b.tag}</span>}
                  </div>
                  <p style={styles.metaLine}>
                    合計 {formatViews(b.total_views)}回視聴 ・ クリップ{b.clip_count}件
                  </p>
                </div>
              </Link>
            ))}
          </div>

          {!searchQuery.trim() && (
            <div style={styles.pagination}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
                aria-label="前のページ"
              >
                <ChevronLeft size={15} />
              </button>
              <span style={styles.pageInfo}>{page}</span>
              <button
                onClick={() => setPage((p) => (broadcasters.length === PAGE_SIZE ? p + 1 : p))}
                disabled={broadcasters.length < PAGE_SIZE}
                style={{ ...styles.pageBtn, opacity: broadcasters.length < PAGE_SIZE ? 0.4 : 1 }}
                aria-label="次のページ"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
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
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#8A8A99",
    fontSize: 12.5,
    textDecoration: "none",
    marginBottom: 10,
  },
  h1: { fontSize: 26, fontWeight: 600, margin: "0 0 6px", letterSpacing: 0.5 },
  tagline: { fontSize: 13, color: "#6B6B78", margin: 0 },
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
  loadingText: { color: "#8A8A99", fontSize: 14, textAlign: "center", padding: "40px 0" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  emptyState: { color: "#6B6B78", fontSize: 14, padding: "40px 0", textAlign: "center" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "12px 16px",
    color: "#EDEDF2",
    textDecoration: "none",
  },
  rankNum: { fontSize: 15, fontWeight: 600, color: "#565660", width: 28, flexShrink: 0 },
  avatar: { width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarFallback: { width: 36, height: 36, borderRadius: "50%", background: "#20202B", flexShrink: 0 },
  infoCol: { flex: 1, minWidth: 0 },
  nameRow: { display: "flex", alignItems: "center", gap: 8 },
  name: { fontSize: 14.5, fontWeight: 500, margin: 0, color: "#EDEDF2" },
  tagBadge: {
    fontSize: 11,
    color: "#AFA9EC",
    background: "#241F3A",
    borderRadius: 12,
    padding: "2px 8px",
  },
  metaLine: { fontSize: 12.5, color: "#6B6B78", margin: "3px 0 0" },
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
};
