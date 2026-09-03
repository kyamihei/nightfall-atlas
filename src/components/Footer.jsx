import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";

const LINKS = [
  { to: "/", label: "ホーム" },
  { to: "/about", label: "サイトについて" },
  { to: "/terms", label: "利用規約" },
  { to: "/privacy", label: "プライバシーポリシー" },
  { to: "/contact", label: "お問い合わせ" },
];

// 各定期更新の次回実行時刻を計算する（cronはすべてUTC基準なのでUTCで計算し、
// 訪問者のブラウザのタイムゾーンに関わらず正しい残り時間になるようにしている）。
function nextQuarterHourUTC(now) {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), Math.floor(now.getUTCMinutes() / 15) * 15, 0, 0),
  );
  while (next <= now) next.setUTCMinutes(next.getUTCMinutes() + 15);
  return next;
}
function nextHourAt20UTC(now) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 20, 0, 0));
  while (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next;
}
function nextDailyAt2105UTC(now) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 21, 5, 0, 0));
  while (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** サイトの自動更新（ライブ配信者のクリップ同期・視聴回数同期・全体同期）の次回実行までのカウントダウン */
function SyncTimer() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const liveSyncRemaining = nextQuarterHourUTC(now) - now;
  const viewRefreshRemaining = nextHourAt20UTC(now) - now;
  const dailySyncRemaining = nextDailyAt2105UTC(now) - now;

  return (
    <p
      style={styles.syncTimer}
      title={`新着クリップ同期: 15分おき（次回まで${formatCountdown(liveSyncRemaining)}） / 視聴回数同期: 毎時20分（次回まで${formatCountdown(viewRefreshRemaining)}） / 全体同期: 毎日朝6:05（次回まで${formatCountdown(dailySyncRemaining)}）`}
    >
      <RefreshCw size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
      新着クリップ更新まで {formatCountdown(liveSyncRemaining)} ・ 視聴回数更新まで {formatCountdown(viewRefreshRemaining)}
    </p>
  );
}

export default function Footer({ note }) {
  return (
    <footer style={styles.footer}>
      {note && <p style={styles.note}>{note}</p>}
      <SyncTimer />
      <nav style={styles.links}>
        {LINKS.map((link, i) => (
          <span key={link.to} style={styles.linkGroup}>
            <Link to={link.to} style={styles.link}>
              {link.label}
            </Link>
            {i < LINKS.length - 1 && <span style={styles.divider}>・</span>}
          </span>
        ))}
      </nav>
      <p style={styles.copyright}>© {new Date().getFullYear()} クリスレ</p>
    </footer>
  );
}

const styles = {
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTop: "1px solid #24242F",
    textAlign: "center",
  },
  note: {
    fontSize: 11.5,
    color: "#4E4E58",
    margin: "0 0 12px",
  },
  syncTimer: {
    fontSize: 11,
    color: "#5A5A66",
    margin: "0 0 12px",
    fontVariantNumeric: "tabular-nums",
  },
  links: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  linkGroup: { display: "inline-flex", alignItems: "center" },
  link: {
    fontSize: 12,
    color: "#8A8A99",
    textDecoration: "none",
    padding: "2px 4px",
  },
  divider: { fontSize: 12, color: "#3A3A44", margin: "0 2px" },
  copyright: {
    fontSize: 11,
    color: "#4E4E58",
    margin: 0,
  },
};
