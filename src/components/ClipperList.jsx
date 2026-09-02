import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Scissors, ChevronLeft, ChevronRight } from "lucide-react";
import { useTopClippers } from "../lib/use-clip-ranking";

const PAGE_SIZE = 30;
const RANK_ACCENTS = { 1: "#FFC857", 2: "#C9CEDA", 3: "#D98E5D" };

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

export default function ClipperList() {
  const [page, setPage] = useState(1);
  const { clippers, loading } = useTopClippers(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <div style={styles.page}>
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
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

      <header style={styles.header}>
        <div>
          <Link to="/" style={styles.backLink}>
            <ArrowLeft size={14} />
            ランキングに戻る
          </Link>
          <h1 className="clip-title-font" style={styles.h1}>
            <Scissors size={22} style={{ marginRight: 8, verticalAlign: -3 }} />
            クリップ職人ランキング
          </h1>
          <p style={styles.tagline}>
            クリップを作った視聴者を、そのクリップの合計視聴回数順に表示しています
          </p>
        </div>
      </header>

      {loading ? (
        <p style={styles.loadingText}>読み込み中…</p>
      ) : (
        <>
          <div style={styles.list}>
            {clippers.length === 0 && (
              <div style={styles.emptyState}>まだクリップ職人の記録がありません。</div>
            )}
            {clippers.map((c, i) => {
              const rank = (page - 1) * PAGE_SIZE + i + 1;
              const accent = RANK_ACCENTS[rank] || null;
              return (
                <Link
                  key={c.creator_id}
                  className="cv-list-row cv-fade-in-up"
                  to={`/clippers/${encodeURIComponent(c.creator_id)}`}
                  style={{
                    ...styles.row,
                    borderColor: accent ? `${accent}55` : styles.row.borderColor,
                    animationDelay: `${Math.min(i, 12) * 40}ms`,
                  }}
                >
                  <div
                    style={{
                      ...styles.rankNum,
                      color: accent || "#565660",
                      textShadow: accent ? `0 0 14px ${accent}66` : "none",
                    }}
                  >
                    {String(rank).padStart(2, "0")}
                  </div>
                  {c.profile_image_url ? (
                    <img src={c.profile_image_url} alt="" style={styles.avatar} />
                  ) : (
                    <div style={styles.avatarFallback} />
                  )}
                  <div style={styles.infoCol}>
                    <p style={styles.name}>{c.creator_name}</p>
                    <p style={styles.metaLine}>
                      合計 {formatViews(c.total_views)}回視聴 ・ クリップ{c.clip_count}件
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>

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
              onClick={() => setPage((p) => (clippers.length === PAGE_SIZE ? p + 1 : p))}
              disabled={clippers.length < PAGE_SIZE}
              style={{ ...styles.pageBtn, opacity: clippers.length < PAGE_SIZE ? 0.4 : 1 }}
              aria-label="次のページ"
            >
              <ChevronRight size={15} />
            </button>
          </div>
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
  h1: { fontSize: 26, fontWeight: 600, margin: "0 0 6px", letterSpacing: 0.5, display: "flex", alignItems: "center" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: 0 },
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
  name: { fontSize: 14.5, fontWeight: 500, margin: 0, color: "#EDEDF2" },
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
