import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search, Loader2, Film } from "lucide-react";
import { useClipSearch, extractClipIdFromUrl, SEARCH_MIN_LENGTH } from "../lib/use-clip-ranking";
import { supabase } from "../lib/supabase-client";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n);
}

export default function ClipSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState(searchParams.get("q") ?? "");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [urlLookupError, setUrlLookupError] = useState("");
  const navigate = useNavigate();
  const { results, loading, error } = useClipSearch(query);

  // 入力のデバウンス（300ms）。URLっぽい入力はデバウンスせず即座に解決を試みる。
  useEffect(() => {
    const clipId = extractClipIdFromUrl(input);
    if (clipId) {
      setUrlLookupError("");
      (async () => {
        const { data } = await supabase.from("clips").select("id").eq("id", clipId).maybeSingle();
        if (data) {
          navigate(`/clips/${data.id}`);
        } else {
          setUrlLookupError("このURLのクリップは見つかりませんでした。まだ収集されていない可能性があります。");
        }
      })();
      return;
    }
    setUrlLookupError("");
    const t = setTimeout(() => {
      setQuery(input);
      setSearchParams(input.trim() ? { q: input } : {}, { replace: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const trimmed = input.trim();
  const isUrlInput = !!extractClipIdFromUrl(input);
  const tooShort = !isUrlInput && trimmed.length > 0 && trimmed.length < SEARCH_MIN_LENGTH;

  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        input:focus { outline: 2px solid #FF4D6D33; }
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
          <Search size={22} style={{ marginRight: 8, verticalAlign: -3 }} />
          クリップ検索
        </h1>
        <p style={styles.tagline}>クリップのタイトルで検索、またはTwitchのクリップURLを直接貼り付けられます</p>
        <div style={styles.searchBox}>
          <Search size={16} color="#6B6B78" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="クリップのタイトル、または https://clips.twitch.tv/... を貼り付け…"
            style={styles.searchInput}
          />
        </div>
      </header>

      {urlLookupError && <div style={styles.errorBanner}>{urlLookupError}</div>}
      {isUrlInput && !urlLookupError && (
        <p style={styles.hintText}>
          <Loader2 size={13} style={{ animation: "cv-spin 1s linear infinite", marginRight: 6, verticalAlign: -2 }} />
          クリップURLを確認しています…
        </p>
      )}
      {tooShort && <p style={styles.hintText}>{SEARCH_MIN_LENGTH}文字以上入力すると検索できます。</p>}
      {error && <div style={styles.errorBanner}>{error}</div>}

      {!isUrlInput && !tooShort && trimmed.length >= SEARCH_MIN_LENGTH && (
        <div style={styles.list}>
          {loading ? (
            <p style={styles.loadingText}>検索中…</p>
          ) : results.length === 0 ? (
            <div style={styles.emptyState}>
              <Film size={26} color="#3E3E4A" style={{ marginBottom: 10 }} />
              <p style={{ margin: 0 }}>「{trimmed}」に一致するクリップは見つかりませんでした。</p>
            </div>
          ) : (
            results.map((clip, i) => (
              <Link
                key={clip.id}
                className="cv-list-row cv-fade-in-up"
                to={`/clips/${clip.id}`}
                style={{ ...styles.row, animationDelay: `${Math.min(i, 12) * 40}ms` }}
              >
                <div style={styles.thumb}>
                  {clip.thumbnail_url ? (
                    <img src={clip.thumbnail_url} alt="" style={styles.thumbImg} />
                  ) : (
                    <span style={styles.thumbFallback}>{clip.game}</span>
                  )}
                </div>
                <div style={styles.infoCol}>
                  <p className="clip-title-font" style={styles.clipTitle}>{clip.title}</p>
                  <p style={styles.metaLine}>
                    {clip.streamer} ・ {clip.game} ・ ▶ {formatViews(clip.view_count)}回視聴
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

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
    padding: "28px 32px 40px",
    maxWidth: 1200,
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
  h1: { fontSize: 26, fontWeight: 600, margin: "0 0 6px", letterSpacing: 0.5, display: "flex", alignItems: "center" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: "0 0 16px" },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: "10px 14px",
    maxWidth: 560,
  },
  searchInput: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#EDEDF2",
    fontSize: 14,
    width: "100%",
  },
  hintText: { fontSize: 12.5, color: "#6B6B78", margin: "0 0 16px", display: "flex", alignItems: "center" },
  errorBanner: {
    background: "#3A1D1D",
    color: "#F0997B",
    fontSize: 13,
    padding: "8px 12px",
    borderRadius: 8,
    marginBottom: 16,
  },
  loadingText: { color: "#8A8A99", fontSize: 14, textAlign: "center", padding: "40px 0" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  emptyState: {
    color: "#6B6B78",
    fontSize: 14,
    padding: "48px 0",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 10,
    padding: "10px 14px",
    color: "#EDEDF2",
    textDecoration: "none",
  },
  thumb: {
    width: 64,
    height: 44,
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
    background: "#20202B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover" },
  thumbFallback: { fontSize: 9, color: "#8A8A99", textAlign: "center", padding: "0 2px" },
  infoCol: { flex: 1, minWidth: 0 },
  clipTitle: {
    fontSize: 14.5,
    fontWeight: 500,
    margin: "0 0 4px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  metaLine: { fontSize: 12.5, color: "#6B6B78", margin: 0 },
};
