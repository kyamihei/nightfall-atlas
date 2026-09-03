import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Lock, LogOut, Mail, Flag, UserPlus, EyeOff, Eye, Check } from "lucide-react";
import {
  useAdminAuth,
  useAdminContactMessages,
  useAdminCommentReports,
  useAdminBroadcasterRequests,
} from "../lib/use-admin";

const CATEGORY_LABELS = {
  bug: "不具合の報告",
  request: "機能のご要望",
  report: "コンテンツの通報",
  other: "その他",
};

const REQUEST_STATUS_LABELS = {
  pending: "処理待ち",
  approved: "承認済み",
  rejected: "却下",
};

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function LoginForm({ login, verifying, error }) {
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    if (!draft.trim()) return;
    login(draft.trim());
  }

  return (
    <div style={styles.page}>
      <div style={styles.loginBox}>
        <Lock size={22} color="#8A8A99" />
        <h1 style={styles.loginTitle}>管理画面ログイン</h1>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="パスワード"
          style={styles.loginInput}
          autoFocus
        />
        <button onClick={handleSubmit} style={styles.loginBtn} disabled={verifying}>
          {verifying ? "確認中…" : "ログイン"}
        </button>
        {error && <p style={styles.errorText}>{error}</p>}
      </div>
    </div>
  );
}

function ContactMessagesPanel({ password }) {
  const { messages, loading, error, setStatus } = useAdminContactMessages(password);

  if (loading) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (messages.length === 0) return <p style={styles.emptyText}>お問い合わせはまだありません。</p>;

  return (
    <div style={styles.list}>
      {messages.map((m) => (
        <div key={m.id} style={{ ...styles.card, opacity: m.status === "read" ? 0.6 : 1 }}>
          <div style={styles.cardHead}>
            <span style={styles.categoryBadge}>{CATEGORY_LABELS[m.category] ?? m.category}</span>
            <span style={styles.cardTime}>{formatDateTime(m.created_at)}</span>
          </div>
          {m.email && <p style={styles.cardMeta}>返信先: {m.email}</p>}
          <p style={styles.cardBody}>{m.body}</p>
          <button
            onClick={() => setStatus(m.id, m.status === "unread" ? "read" : "unread")}
            style={styles.actionBtn}
          >
            <Check size={12} />
            {m.status === "unread" ? "既読にする" : "未読に戻す"}
          </button>
        </div>
      ))}
    </div>
  );
}

function CommentReportsPanel({ password }) {
  const { reports, loading, error, setHidden } = useAdminCommentReports(password);

  if (loading) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (reports.length === 0) return <p style={styles.emptyText}>通報はまだありません。</p>;

  return (
    <div style={styles.list}>
      {reports.map((r) => (
        <div key={r.comment_id} style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.categoryBadge}>通報{r.report_count}件</span>
            <span style={styles.cardTime}>最終通報: {formatDateTime(r.last_reported_at)}</span>
          </div>
          {r.clip_id && (
            <Link to={`/clips/${r.clip_id}`} style={styles.cardMetaLink}>
              「{r.clip_title ?? "元のクリップ（削除済み）"}」を見る
            </Link>
          )}
          <p style={styles.cardMeta}>{r.display_name}</p>
          <p style={styles.cardBody}>{r.body}</p>
          <button
            onClick={() => setHidden(r.comment_id, !r.is_hidden)}
            style={{ ...styles.actionBtn, color: r.is_hidden ? "#5DCAA5" : "#F0997B", borderColor: r.is_hidden ? "#5DCAA555" : "#F0997B55" }}
          >
            {r.is_hidden ? <Eye size={12} /> : <EyeOff size={12} />}
            {r.is_hidden ? "表示に戻す" : "非表示にする"}
          </button>
        </div>
      ))}
    </div>
  );
}

function BroadcasterRequestsPanel({ password }) {
  const { requests, loading, error } = useAdminBroadcasterRequests(password);

  if (loading) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (requests.length === 0) return <p style={styles.emptyText}>登録リクエストはまだありません。</p>;

  return (
    <div style={styles.list}>
      {requests.map((r) => (
        <div key={r.id} style={styles.card}>
          <div style={styles.cardHead}>
            <span
              style={{
                ...styles.categoryBadge,
                background: r.status === "approved" ? "#153029" : r.status === "rejected" ? "#3A241D" : "#241F3A",
                color: r.status === "approved" ? "#5DCAA5" : r.status === "rejected" ? "#F0997B" : "#AFA9EC",
              }}
            >
              {REQUEST_STATUS_LABELS[r.status] ?? r.status}
            </span>
            <span style={styles.cardTime}>{formatDateTime(r.created_at)}</span>
          </div>
          <p style={styles.cardBody}>{r.twitch_login}</p>
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { key: "contact", label: "お問い合わせ", icon: Mail },
  { key: "reports", label: "コメント通報", icon: Flag },
  { key: "requests", label: "配信者リクエスト", icon: UserPlus },
];

export default function AdminPage() {
  const { password, isAuthed, login, logout, verifying, error } = useAdminAuth();
  const [activeTab, setActiveTab] = useState("contact");

  if (!isAuthed) return <LoginForm login={login} verifying={verifying} error={error} />;

  return (
    <div style={styles.page}>
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        button, a { cursor: pointer; }
      `}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <header style={styles.header}>
        <h1 style={styles.h1}>管理画面</h1>
        <button onClick={logout} style={styles.logoutBtn}>
          <LogOut size={13} />
          ログアウト
        </button>
      </header>

      <div style={styles.tabsRow}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={activeTab === t.key ? styles.tabActive : styles.tab}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "contact" && <ContactMessagesPanel password={password} />}
      {activeTab === "reports" && <CommentReportsPanel password={password} />}
      {activeTab === "requests" && <BroadcasterRequestsPanel password={password} />}
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
  loginBox: {
    maxWidth: 320,
    margin: "80px auto 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    textAlign: "center",
  },
  loginTitle: { fontSize: 17, fontWeight: 600, margin: "4px 0 8px" },
  loginInput: {
    width: "100%",
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    padding: "9px 12px",
    fontSize: 14,
    color: "#EDEDF2",
  },
  loginBtn: {
    width: "100%",
    background: "#FF4D6D",
    border: "none",
    borderRadius: 6,
    color: "#1C1417",
    padding: "9px 12px",
    fontSize: 13.5,
    fontWeight: 600,
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
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #24242F",
    paddingBottom: 16,
    marginBottom: 16,
  },
  h1: { fontSize: 22, fontWeight: 600, margin: 0 },
  logoutBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 6,
    color: "#C4C4D0",
    padding: "6px 12px",
    fontSize: 12.5,
  },
  tabsRow: { display: "flex", gap: 6, marginBottom: 18 },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#8A8A99",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 12.5,
  },
  tabActive: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#24242F",
    border: "1px solid #3A3A48",
    color: "#EDEDF2",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 12.5,
    fontWeight: 500,
  },
  loadingText: { color: "#8A8A99", fontSize: 13, textAlign: "center", padding: "30px 0" },
  emptyText: { color: "#6B6B78", fontSize: 13, textAlign: "center", padding: "30px 0" },
  errorText: { color: "#F0997B", fontSize: 13, textAlign: "center", padding: "10px 0" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: { background: "#1C1C26", border: "1px solid #24242F", borderRadius: 10, padding: "12px 14px" },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  categoryBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#AFA9EC",
    background: "#241F3A",
    borderRadius: 12,
    padding: "2px 9px",
  },
  cardTime: { fontSize: 11, color: "#5A5A66" },
  cardMeta: { fontSize: 12, color: "#8A8A99", margin: "0 0 4px" },
  cardMetaLink: {
    display: "inline-block",
    fontSize: 12,
    color: "#8A8A99",
    textDecoration: "none",
    margin: "0 0 4px",
  },
  cardBody: { fontSize: 13.5, color: "#DADAE2", lineHeight: 1.5, margin: "0 0 10px", whiteSpace: "pre-wrap" },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#C4C4D0",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
  },
};
