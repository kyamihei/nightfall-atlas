import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Users, Scissors, Search, MessageSquare, Hash, ListChecks, Smile, Star, Award, LogOut, UserPlus, ExternalLink,
} from "lucide-react";
import { supabase } from "../lib/supabase-client";
import { useMembership } from "../lib/use-clip-ranking";
import { REACTIONS_ENABLED } from "../lib/feature-flags";

/**
 * 全ページ共通のヘッダー（2026-09-04追加）。「どの画面に遷移してもヘッダーが常に表示されて
 * いるように」という要望への対応。以前はClipRanking.jsx（トップページ）にしか無く、他の
 * ページでは「← ランキングに戻る」という簡易リンクのみだった。App.jsxのRoutesの外側に
 * 1つだけ配置し、全ページで共通して表示する。
 *
 * 配信者名検索欄は元々ClipRanking.jsx内のローカルstateでクリップ一覧を絞り込む作りだった
 * （配信者が見つからない場合の「追加リクエスト」導線も含む）。ヘッダーを切り出した後もこの
 * ページ固有の挙動はそのまま維持しつつ、他ページからも検索を使えるようにするため、
 * URLの?qクエリパラメータを介して連携する設計にした（ヘッダーとClipRanking.jsxはコンポーネント
 * ツリー上の親子関係にないため、propsではなくURLで状態を共有する）。トップページにいる間は
 * 入力のたびに?qを書き換えて（history.replaceで）従来通りの「入力するそばから絞り込まれる」
 * 挙動を維持し、他のページにいる間はEnterキーで初めてトップページへ遷移する（キー入力のたびに
 * ページ遷移するとなにか作業中に誤操作で画面が切り替わってしまうため）。
 */
export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/";

  const [searchInput, setSearchInput] = useState(() => new URLSearchParams(location.search).get("q") ?? "");

  // ブラウザの戻る/進む等、自分の入力以外の理由でURLの?qが変わった場合にも追従させる
  useEffect(() => {
    setSearchInput(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.pathname, location.search]);

  const {
    memberNumber,
    isAnonymous: isAnonymousSession,
    loading: membershipLoading,
  } = useMembership();

  async function handleLogout() {
    await supabase.auth.signOut({ scope: "local" });
    window.location.reload(); // 新しい匿名セッションで全データを作り直すのが確実なため
  }

  function goToSearch(value, { push = false } = {}) {
    const q = value.trim();
    navigate(`/${q ? `?q=${encodeURIComponent(q)}` : ""}`, { replace: !push && isHome });
  }

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearchInput(value);
    if (isHome) goToSearch(value);
  }

  function handleSearchKeyDown(e) {
    if (e.key === "Enter" && !isHome) goToSearch(searchInput, { push: true });
  }

  return (
    <header className="cv-header" style={styles.header}>
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        button, a { cursor: pointer; }
        input:focus { outline: 2px solid #FF4D6D33; }
        .cv-nav-link {
          transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
        }
        .cv-nav-link:hover {
          background: #FF4D6D14;
          border-color: #FF4D6D55;
          color: #EDEDF2;
          transform: translateY(-1px);
        }
        .cv-search-box { margin-left: auto; }
        @media (max-width: 640px) {
          .cv-header-top { flex-direction: column; align-items: flex-start; }
          .cv-nav-links { justify-content: flex-start; }
          .cv-search-box { width: 100%; margin-left: 0; }
        }
      `}</style>

      <div className="cv-header-top" style={styles.headerTop}>
        <Link to="/" style={styles.h1Link}>
          <img src="/favicon.ico" alt="" style={styles.h1Icon} />
          <span style={styles.h1}>クリスレ</span>
        </Link>

        <nav className="cv-nav-links" style={styles.headerLinks}>
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
        </nav>

        <div className="cv-search-box" style={styles.searchBox}>
          <Search size={14} color="#6B6B78" />
          <input
            value={searchInput}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="配信者名で検索…"
            style={styles.searchInput}
          />
        </div>
      </div>

      <div style={styles.eyebrowRow}>
        <span className="cv-live-dot" style={styles.liveDot} />
        <span style={styles.eyebrow}>Twitchクリップの掲示板・みんなのお気に入りのクリップにコメントしてみよう！</span>
      </div>
    </header>
  );
}

const styles = {
  header: {
    position: "relative",
    zIndex: 10,
    background: "#14141B",
    borderBottom: "1px solid #24242F",
    padding: "16px 32px",
  },
  headerTop: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16 },
  h1Link: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    textDecoration: "none",
    flexShrink: 0,
  },
  h1Icon: { width: 26, height: 26, borderRadius: 6, flexShrink: 0 },
  h1: {
    fontFamily: "'RocknRoll One', sans-serif",
    fontSize: 22,
    fontWeight: 400,
    letterSpacing: 0.5,
    color: "#EDEDF2",
  },
  headerLinks: { display: "flex", flexWrap: "wrap", gap: 8 },
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
    textDecoration: "none",
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
    flexShrink: 0,
  },
  searchInput: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#EDEDF2",
    fontSize: 13,
    width: "100%",
  },
  eyebrowRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#FF4D6D",
    display: "inline-block",
    flexShrink: 0,
  },
  eyebrow: { fontSize: 12, color: "#9797A6", letterSpacing: 0.3 },
};
