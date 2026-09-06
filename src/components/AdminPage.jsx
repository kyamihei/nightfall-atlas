import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Lock, LogOut, Mail, Flag, UserPlus, EyeOff, Eye, Check,
  LayoutDashboard, Users, Film, MessageCircle, Heart, Smile, Tag, Hash,
  TrendingUp, Search, RefreshCw, Clock, Award, Trash2, BarChart3,
} from "lucide-react";
import {
  useAdminAuth,
  useAdminDashboard,
  useAdminContactMessages,
  useAdminCommentReports,
  useAdminBroadcasterRequests,
  useAdminMembers,
  useAdminClipTags,
  useAdminPageViews,
} from "../lib/use-admin";

function formatNumber(n) {
  return new Intl.NumberFormat("ja-JP").format(n ?? 0);
}

function timeAgo(ts) {
  if (!ts) return "―";
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

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

function formatShortDate(dateStr) {
  if (!dateStr) return "―";
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
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

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statHead}>
        <Icon size={13} color="#8A8A99" />
        <span style={styles.statLabel}>{label}</span>
      </div>
      <div style={styles.statValue}>{formatNumber(value)}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>
        <Icon size={14} color="#AFA9EC" />
        {title}
      </div>
      {children}
    </div>
  );
}

function RankRow({ rank, label, value, link }) {
  const inner = (
    <>
      <span style={styles.rankNum}>{rank}</span>
      <span style={styles.rankLabel}>{label}</span>
      <span style={styles.rankValue}>{value}</span>
    </>
  );
  return link ? (
    <Link to={link} style={styles.rankRowLink}>
      {inner}
    </Link>
  ) : (
    <div style={styles.rankRow}>{inner}</div>
  );
}

function DashboardPanel({ password }) {
  const { data, loading, error, refresh } = useAdminDashboard(password);

  if (loading && !data) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (!data) return null;

  const { overview, growth, moderation, search } = data;
  const syncedPct = overview.total_clips
    ? Math.round((growth.view_synced_count / overview.total_clips) * 100)
    : 0;

  return (
    <div>
      <button onClick={refresh} style={styles.refreshBtn}>
        <RefreshCw size={12} />
        更新
      </button>

      <Section icon={Users} title="全体サマリー">
        <div style={styles.statGrid}>
          <StatCard icon={Film} label="総クリップ数" value={overview.total_clips} />
          <StatCard icon={Users} label="配信者数" value={overview.total_broadcasters} />
          <StatCard icon={Users} label="クリップ職人数" value={overview.total_clippers} />
          <StatCard icon={MessageCircle} label="総コメント数" value={overview.total_comments} sub={`うち非表示 ${formatNumber(overview.hidden_comments)}`} />
          <StatCard icon={Heart} label="お気に入り数" value={overview.total_favorites} />
          <StatCard icon={Smile} label="スタンプ数" value={overview.total_reaction_stamps} />
          <StatCard icon={Hash} label="タグスレ数" value={overview.total_tag_threads} sub={`コメント${formatNumber(overview.total_tag_thread_comments)}件`} />
          <StatCard icon={Tag} label="配信者タグ" value={overview.total_broadcaster_tags} sub={`種類${formatNumber(overview.unique_tags)}`} />
          <StatCard icon={Users} label="総訪問者数" value={overview.total_visitors} sub="匿名セッション累計" />
        </div>
      </Section>

      <Section icon={TrendingUp} title="直近の伸び">
        <div style={styles.statGrid}>
          <StatCard icon={Film} label="新規クリップ(24h)" value={growth.new_clips_24h} />
          <StatCard icon={Film} label="新規クリップ(7日)" value={growth.new_clips_7d} />
          <StatCard icon={MessageCircle} label="新規コメント(24h)" value={growth.new_comments_24h} />
          <StatCard icon={MessageCircle} label="新規コメント(7日)" value={growth.new_comments_7d} />
        </div>
        <p style={styles.metaLine}>最新クリップ: {timeAgo(growth.latest_clip_created_at)}</p>
        <p style={styles.metaLine}>
          view_count同期率: {syncedPct}%（{formatNumber(growth.view_synced_count)} / {formatNumber(overview.total_clips)}）
          ・最も古い同期: {timeAgo(growth.oldest_view_sync_at)}
        </p>
      </Section>

      <Section icon={TrendingUp} title="人気ランキング TOP5">
        <div style={styles.rankGrid}>
          <div>
            <p style={styles.rankGroupTitle}>配信者（総視聴回数）</p>
            {(data.top_broadcasters ?? []).map((b, i) => (
              <RankRow key={b.streamer} rank={i + 1} label={b.streamer} value={formatNumber(b.total_views)} link={`/broadcasters/${encodeURIComponent(b.streamer)}`} />
            ))}
          </div>
          <div>
            <p style={styles.rankGroupTitle}>クリップ職人（総視聴回数）</p>
            {(data.top_clippers ?? []).map((c, i) => (
              <RankRow key={c.creator_id} rank={i + 1} label={c.creator_name} value={formatNumber(c.total_views)} link={`/clippers/${c.creator_id}`} />
            ))}
          </div>
          <div>
            <p style={styles.rankGroupTitle}>クリップ（視聴回数）</p>
            {(data.top_clips_by_views ?? []).map((c, i) => (
              <RankRow key={c.id} rank={i + 1} label={c.title} value={formatNumber(c.view_count)} link={`/clips/${c.id}`} />
            ))}
          </div>
          <div>
            <p style={styles.rankGroupTitle}>クリップ（コメント数）</p>
            {(data.top_clips_by_comments ?? []).map((c, i) => (
              <RankRow key={c.id} rank={i + 1} label={c.title} value={`${formatNumber(c.comment_count)}件`} link={`/clips/${c.id}`} />
            ))}
            {(data.top_clips_by_comments ?? []).length === 0 && <p style={styles.emptyText}>まだありません</p>}
          </div>
        </div>
        {(data.top_broadcaster_tags ?? []).length > 0 && (
          <>
            <p style={styles.rankGroupTitle}>人気タグ</p>
            <div style={styles.tagChips}>
              {data.top_broadcaster_tags.map((t) => (
                <span key={t.tag} style={styles.tagChip}>
                  {t.tag} <span style={styles.tagChipCount}>{t.use_count}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section icon={Hash} title="新着タグスレ">
        {(data.recent_tag_threads ?? []).length === 0 && <p style={styles.emptyText}>まだありません</p>}
        {(data.recent_tag_threads ?? []).map((t) => (
          <Link key={t.id} to={`/threads/${t.id}`} style={styles.rankRowLink}>
            <span style={styles.rankLabel}>{t.title}</span>
            <span style={styles.rankValue}>{formatNumber(t.comment_count)}件・{timeAgo(t.created_at)}</span>
          </Link>
        ))}
      </Section>

      <Section icon={Flag} title="モデレーション状況">
        <div style={styles.statGrid}>
          <StatCard icon={Mail} label="未読お問い合わせ" value={moderation.unread_contact_count} />
          <StatCard icon={Flag} label="通報中コメント" value={moderation.reported_visible_comments} />
          <StatCard icon={UserPlus} label="保留中リクエスト" value={moderation.pending_broadcaster_requests} />
        </div>
      </Section>

      <Section icon={Search} title="検索キーワード">
        <p style={styles.rankGroupTitle}>直近7日間の人気ワード</p>
        {(search.top_queries_7d ?? []).length === 0 && <p style={styles.emptyText}>まだありません</p>}
        <div style={styles.tagChips}>
          {(search.top_queries_7d ?? []).map((q) => (
            <span key={q.query} style={styles.tagChip}>
              {q.query} <span style={styles.tagChipCount}>{q.search_count}</span>
            </span>
          ))}
        </div>
        {(search.recent_searches ?? []).length > 0 && (
          <>
            <p style={styles.rankGroupTitle}>直近の検索ログ</p>
            {search.recent_searches.map((s, i) => (
              <div key={i} style={styles.rankRow}>
                <span style={styles.rankLabel}>{s.query}</span>
                <span style={styles.rankValue}>{s.result_count}件・{timeAgo(s.created_at)}</span>
              </div>
            ))}
          </>
        )}
      </Section>

      <Section icon={Clock} title="定期同期(pg_cron)の実行状況">
        {(data.cron_runs ?? []).map((r, i) => (
          <div key={i} style={styles.rankRow}>
            <span style={{ ...styles.cronStatus, color: r.status === "succeeded" ? "#5DCAA5" : "#F0997B" }}>
              {r.status === "succeeded" ? "成功" : r.status}
            </span>
            <span style={styles.rankLabel}>{r.jobname}</span>
            <span style={styles.rankValue}>{timeAgo(r.start_time)}</span>
          </div>
        ))}
      </Section>

      <Section icon={Trash2} title="クリップの自動整理（低視聴回数の削除）">
        <div style={styles.statGrid}>
          <StatCard icon={Trash2} label="累計削除件数" value={data.cleanup?.total_deleted ?? 0} />
        </div>
        <p style={styles.metaLine}>
          作成から14日を過ぎ、視聴回数が50回未満のクリップを毎日自動削除（DB容量削減のため）
        </p>
        {(data.cleanup?.recent_runs ?? []).length === 0 && <p style={styles.emptyText}>まだ実行履歴がありません</p>}
        {(data.cleanup?.recent_runs ?? []).map((r, i) => (
          <div key={i} style={styles.rankRow}>
            <span style={styles.rankLabel}>{formatNumber(r.deleted_count)}件削除</span>
            <span style={styles.rankValue}>
              猶予{r.grace_period_days}日・{r.view_threshold}回未満・{timeAgo(r.run_at)}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function PageViewChart({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return (
    <div>
      <div style={styles.chartBars}>
        {daily.map((d) => (
          <div key={d.date} style={styles.chartBarCol} title={`${formatShortDate(d.date)}: ${formatNumber(d.count)}件`}>
            <div style={{ ...styles.chartBar, height: `${Math.max(2, (d.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div style={styles.chartAxisRow}>
        <span>{formatShortDate(daily[0]?.date)}</span>
        <span>{formatShortDate(daily[daily.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

function PageViewsPanel({ password }) {
  const { data, loading, error, refresh } = useAdminPageViews(password);

  if (loading && !data) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (!data) return null;

  return (
    <div>
      <button onClick={refresh} style={styles.refreshBtn}>
        <RefreshCw size={12} />
        更新
      </button>

      <Section icon={BarChart3} title="ページビュー">
        <div style={styles.statGrid}>
          <StatCard icon={BarChart3} label="過去24時間" value={data.total_24h} />
          <StatCard icon={BarChart3} label="過去7日間" value={data.total_7d} />
          <StatCard icon={BarChart3} label="累計" value={data.total_all_time} />
        </div>
        <p style={styles.rankGroupTitle}>直近30日間の推移（日別・日本時間）</p>
        <PageViewChart daily={data.daily ?? []} />
      </Section>

      <Section icon={TrendingUp} title="よく見られているページ（直近7日間）">
        {(data.top_paths_7d ?? []).length === 0 && <p style={styles.emptyText}>まだデータがありません</p>}
        {(data.top_paths_7d ?? []).map((p, i) => (
          <RankRow key={p.path} rank={i + 1} label={p.path} value={`${formatNumber(p.cnt)}回`} />
        ))}
      </Section>
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

function MembersPanel({ password }) {
  const { members, loading, error, deleteMember } = useAdminMembers(password);

  if (loading) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (members.length === 0) return <p style={styles.emptyText}>登録会員はまだいません。</p>;

  function handleDelete(m) {
    const ok = window.confirm(`会員番号 #${m.member_number}（${m.email}）の会員登録を取り消しますか？\n（コメントの番号バッジが消えます。アカウント自体は削除されません）`);
    if (ok) deleteMember(m.id);
  }

  return (
    <div style={styles.list}>
      {members.map((m) => (
        <div key={m.id} style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.categoryBadge}>#{m.member_number}</span>
            <span style={styles.cardTime}>{formatDateTime(m.registered_at)}</span>
          </div>
          <p style={styles.cardBody}>{m.email}</p>
          <button
            onClick={() => handleDelete(m)}
            style={{ ...styles.actionBtn, color: "#F0997B", borderColor: "#F0997B55" }}
          >
            <Trash2 size={12} />
            会員登録を削除
          </button>
        </div>
      ))}
    </div>
  );
}

function ClipTagsPanel({ password }) {
  const { clipTags, loading, error, setHidden } = useAdminClipTags(password);

  if (loading) return <p style={styles.loadingText}>読み込み中…</p>;
  if (error) return <p style={styles.errorText}>{error}</p>;
  if (clipTags.length === 0) return <p style={styles.emptyText}>付けられたタグはまだありません。</p>;

  return (
    <div style={styles.list}>
      {clipTags.map((t) => (
        <div key={t.id} style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.categoryBadge}>{t.tag}</span>
            <span style={styles.cardTime}>{formatDateTime(t.created_at)}</span>
          </div>
          {t.clip_id && (
            <Link to={`/clips/${t.clip_id}`} style={styles.cardMetaLink}>
              「{t.clip_title ?? "元のクリップ（削除済み）"}」を見る
            </Link>
          )}
          <button
            onClick={() => setHidden(t.id, !t.is_hidden)}
            style={{ ...styles.actionBtn, color: t.is_hidden ? "#5DCAA5" : "#F0997B", borderColor: t.is_hidden ? "#5DCAA555" : "#F0997B55" }}
          >
            {t.is_hidden ? <Eye size={12} /> : <EyeOff size={12} />}
            {t.is_hidden ? "表示に戻す" : "非表示にする"}
          </button>
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { key: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { key: "pageViews", label: "サイト閲覧", icon: BarChart3 },
  { key: "contact", label: "お問い合わせ", icon: Mail },
  { key: "reports", label: "コメント通報", icon: Flag },
  { key: "requests", label: "配信者リクエスト", icon: UserPlus },
  { key: "members", label: "会員一覧", icon: Award },
  { key: "clipTags", label: "クリップタグ", icon: Tag },
];

export default function AdminPage() {
  const { password, isAuthed, login, logout, verifying, error } = useAdminAuth();
  const [activeTab, setActiveTab] = useState("dashboard");

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

      {activeTab === "dashboard" && <DashboardPanel password={password} />}
      {activeTab === "pageViews" && <PageViewsPanel password={password} />}
      {activeTab === "contact" && <ContactMessagesPanel password={password} />}
      {activeTab === "reports" && <CommentReportsPanel password={password} />}
      {activeTab === "requests" && <BroadcasterRequestsPanel password={password} />}
      {activeTab === "members" && <MembersPanel password={password} />}
      {activeTab === "clipTags" && <ClipTagsPanel password={password} />}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 32px 60px",
    maxWidth: 1040,
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
  refreshBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    color: "#C4C4D0",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    marginBottom: 16,
  },
  section: {
    background: "#1A1A23",
    border: "1px solid #24242F",
    borderRadius: 12,
    padding: "16px 18px",
    marginBottom: 14,
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 13.5,
    fontWeight: 600,
    color: "#EDEDF2",
    marginBottom: 12,
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 10,
  },
  statCard: {
    background: "#1C1C26",
    border: "1px solid #24242F",
    borderRadius: 8,
    padding: "10px 12px",
  },
  statHead: { display: "flex", alignItems: "center", gap: 5, marginBottom: 6 },
  statLabel: { fontSize: 11, color: "#8A8A99" },
  statValue: { fontSize: 19, fontWeight: 700, color: "#EDEDF2" },
  statSub: { fontSize: 10.5, color: "#5A5A66", marginTop: 2 },
  metaLine: { fontSize: 12, color: "#8A8A99", margin: "10px 0 0" },
  rankGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
  },
  rankGroupTitle: { fontSize: 11.5, color: "#8A8A99", margin: "12px 0 6px", fontWeight: 600 },
  rankRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0",
    fontSize: 12.5,
    borderBottom: "1px solid #20202A",
  },
  rankRowLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0",
    fontSize: 12.5,
    borderBottom: "1px solid #20202A",
    color: "#DADAE2",
    textDecoration: "none",
  },
  rankNum: { color: "#5A5A66", fontSize: 11, width: 14, flexShrink: 0 },
  rankLabel: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rankValue: { color: "#8A8A99", fontSize: 11.5, flexShrink: 0 },
  tagChips: { display: "flex", flexWrap: "wrap", gap: 6 },
  tagChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11.5,
    color: "#AFA9EC",
    background: "#241F3A",
    borderRadius: 12,
    padding: "3px 10px",
  },
  tagChipCount: { color: "#7A76A8", fontSize: 10.5 },
  cronStatus: { fontSize: 11, fontWeight: 600, width: 32, flexShrink: 0 },
  chartBars: { display: "flex", alignItems: "flex-end", gap: 3, height: 120, marginBottom: 6 },
  chartBarCol: { flex: 1, display: "flex", alignItems: "flex-end", height: "100%" },
  chartBar: { width: "100%", background: "#AFA9EC", borderRadius: "2px 2px 0 0", minHeight: 2 },
  chartAxisRow: { display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#5A5A66" },
};
