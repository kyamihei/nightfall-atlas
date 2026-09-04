import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Award, Loader2, Radio, Scissors, Check } from "lucide-react";
import { supabase } from "../lib/supabase-client";
import { useMembership } from "../lib/use-clip-ranking";
import { useAuthConfirmationCallback, linkTwitchIdentity } from "../lib/use-auth-callback";
import { useSmartBack } from "../lib/use-smart-back";
import Footer from "./Footer";
import BackgroundGlow from "./BackgroundGlow";

const MYPAGE_PATH = "/mypage";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

function twitchErrorMessage(error) {
  const msg = error?.message || "";
  if (/already linked/i.test(msg)) {
    return "このTwitchアカウントは既に別の会員に連携されています。";
  }
  return msg || "Twitchログインに失敗しました。";
}

/**
 * マイページ（2026-09-04追加）。会員番号・Twitch連携状況・クリップ職人ランキングの成績・
 * ニックネーム・クリップ職人バッジの着脱をまとめて確認・変更できる場所。
 */
export default function MyPage() {
  const goBack = useSmartBack("/");
  const {
    memberNumber,
    twitchUserId,
    twitchLogin,
    twitchDisplayName,
    nickname,
    clipperBadgeEnabled,
    registeredAt,
    loading: membershipLoading,
    refresh: refreshMembership,
    setNickname,
    setClipperBadgeEnabled,
  } = useMembership();

  const [twitchSubmitting, setTwitchSubmitting] = useState(false);
  const [twitchError, setTwitchError] = useState("");

  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameSubmitting, setNicknameSubmitting] = useState(false);
  const [nicknameError, setNicknameError] = useState("");
  const [nicknameSaved, setNicknameSaved] = useState(false);

  const [badgeSubmitting, setBadgeSubmitting] = useState(false);
  const [badgeError, setBadgeError] = useState("");

  const [clipperStats, setClipperStats] = useState(null); // { totalViews, clipCount, rank } | null
  const [clipperStatsLoading, setClipperStatsLoading] = useState(false);

  useEffect(() => {
    setNicknameDraft(nickname ?? "");
  }, [nickname]);

  useAuthConfirmationCallback(async (user, { error: confirmError }) => {
    if (confirmError) {
      setTwitchError(`確認に失敗しました: ${confirmError}`);
      return;
    }
    if (!user) return;
    const { error: rpcError } = await supabase.rpc("register_member");
    if (rpcError) {
      setTwitchError(rpcError.message || "Twitch連携の確定に失敗しました。時間をおいて再度お試しください。");
      return;
    }
    await refreshMembership();
  });

  useEffect(() => {
    if (!twitchUserId) {
      setClipperStats(null);
      return;
    }
    let cancelled = false;
    setClipperStatsLoading(true);
    (async () => {
      const { data } = await supabase.rpc("get_clipper_stats", { target_creator_id: twitchUserId });
      if (cancelled) return;
      const stats = data?.[0];
      setClipperStats(
        stats && stats.clip_count > 0
          ? { totalViews: stats.total_views, clipCount: stats.clip_count, rank: stats.rank }
          : null,
      );
      setClipperStatsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [twitchUserId]);

  async function handleTwitchLogin() {
    setTwitchError("");
    setTwitchSubmitting(true);
    const { error } = await linkTwitchIdentity(`${window.location.origin}${MYPAGE_PATH}`);
    setTwitchSubmitting(false);
    if (error) setTwitchError(twitchErrorMessage(error));
  }

  async function handleSaveNickname(e) {
    e.preventDefault();
    setNicknameError("");
    setNicknameSaved(false);
    setNicknameSubmitting(true);
    try {
      await setNickname(nicknameDraft);
      setNicknameSaved(true);
    } catch (err) {
      setNicknameError(err.message || "ニックネームの保存に失敗しました。");
    } finally {
      setNicknameSubmitting(false);
    }
  }

  async function handleToggleClipperBadge() {
    setBadgeError("");
    setBadgeSubmitting(true);
    try {
      await setClipperBadgeEnabled(!clipperBadgeEnabled);
    } catch (err) {
      setBadgeError(err.message || "設定の変更に失敗しました。");
    } finally {
      setBadgeSubmitting(false);
    }
  }

  const isEligibleForClipperBadge = !!twitchUserId && !!clipperStats;

  return (
    <div style={styles.page}>
      <BackgroundGlow />
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        input:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <button onClick={goBack} style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </button>

      <h1 className="clip-title-font" style={styles.h1}>
        マイページ
      </h1>

      {membershipLoading ? (
        <div style={styles.loadingRow}>
          <Loader2 size={16} style={{ animation: "cv-spin 1s linear infinite" }} />
          確認中…
        </div>
      ) : memberNumber === null ? (
        <div style={styles.notMemberBox}>
          <p style={styles.notMemberText}>
            まだ会員登録が完了していません。登録すると会員番号が発行され、ニックネームの設定や
            クリップ職人バッジの利用ができるようになります。
          </p>
          <Link to="/register" style={styles.registerLink}>
            会員登録ページへ
          </Link>
        </div>
      ) : (
        <>
          <section style={styles.card}>
            <div style={styles.memberRow}>
              <Award size={20} style={{ color: "#FF4D6D" }} />
              <div>
                <p style={styles.memberNumber}>会員 #{memberNumber}</p>
                {registeredAt && <p style={styles.memberSub}>{formatDate(registeredAt)} 登録</p>}
              </div>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Twitch連携</h2>
            {twitchUserId ? (
              <div style={styles.twitchLinkedRow}>
                <Check size={16} style={{ color: "#5DCAA5", flexShrink: 0 }} />
                <div>
                  <p style={styles.twitchLinkedText}>
                    {twitchDisplayName || twitchLogin || "Twitchアカウント"} と連携済みです
                  </p>
                  <Link to={`/clippers/${encodeURIComponent(twitchUserId)}`} style={styles.clipperPageLink}>
                    <Scissors size={12} />
                    クリップ職人ページを見る
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <p style={styles.cardBody}>
                  Twitchアカウントを連携すると、クリップ職人ランキングに載っている場合は職人バッジが
                  使えるようになります。
                </p>
                <button onClick={handleTwitchLogin} style={styles.twitchBtn} disabled={twitchSubmitting}>
                  <Radio size={16} />
                  {twitchSubmitting ? "接続中…" : "Twitchでログイン"}
                </button>
                {twitchError && <p style={styles.errorText}>{twitchError}</p>}
              </>
            )}
          </section>

          {twitchUserId && (
            <section style={styles.card}>
              <h2 style={styles.cardTitle}>クリップ職人ランキング</h2>
              {clipperStatsLoading ? (
                <div style={styles.loadingRow}>
                  <Loader2 size={14} style={{ animation: "cv-spin 1s linear infinite" }} />
                  確認中…
                </div>
              ) : clipperStats ? (
                <div style={styles.statsGrid}>
                  <div style={styles.statItem}>
                    <p style={styles.statValue}>{clipperStats.rank ?? "-"}</p>
                    <p style={styles.statLabel}>総合順位</p>
                  </div>
                  <div style={styles.statItem}>
                    <p style={styles.statValue}>{clipperStats.clipCount}</p>
                    <p style={styles.statLabel}>クリップ数</p>
                  </div>
                  <div style={styles.statItem}>
                    <p style={styles.statValue}>{new Intl.NumberFormat("ja-JP").format(clipperStats.totalViews)}</p>
                    <p style={styles.statLabel}>合計視聴回数</p>
                  </div>
                </div>
              ) : (
                <p style={styles.cardBody}>
                  まだクリップ職人ランキングに登録がありません。クリップが作られた後、反映まで時間が
                  かかる場合があります。
                </p>
              )}

              <div style={styles.badgeToggleRow}>
                <div>
                  <p style={styles.badgeToggleTitle}>コメントにクリップ職人バッジを表示する</p>
                  <p style={styles.badgeToggleNote}>
                    {isEligibleForClipperBadge
                      ? "オンにすると、投稿するコメントの名前の横に職人バッジが表示されます。"
                      : "ランキングに載ると利用できます。"}
                  </p>
                </div>
                <button
                  onClick={handleToggleClipperBadge}
                  disabled={!isEligibleForClipperBadge || badgeSubmitting}
                  style={{
                    ...styles.toggleBtn,
                    ...(clipperBadgeEnabled ? styles.toggleBtnOn : {}),
                    opacity: !isEligibleForClipperBadge ? 0.4 : 1,
                  }}
                  aria-pressed={clipperBadgeEnabled}
                >
                  <span style={{ ...styles.toggleKnob, ...(clipperBadgeEnabled ? styles.toggleKnobOn : {}) }} />
                </button>
              </div>
              {badgeError && <p style={styles.errorText}>{badgeError}</p>}
            </section>
          )}

          <section style={styles.card}>
            <h2 style={styles.cardTitle}>ニックネーム</h2>
            <p style={styles.cardBody}>
              設定すると、コメント投稿時に匿名の代わりにこのニックネームを選んで投稿できるようになります。
            </p>
            <form onSubmit={handleSaveNickname} style={styles.nicknameForm}>
              <input
                value={nicknameDraft}
                onChange={(e) => {
                  setNicknameDraft(e.target.value);
                  setNicknameSaved(false);
                }}
                placeholder="ニックネーム（20文字以内）"
                style={styles.input}
                maxLength={20}
              />
              <button type="submit" style={styles.saveBtn} disabled={nicknameSubmitting}>
                {nicknameSubmitting ? "保存中…" : "保存"}
              </button>
            </form>
            {nicknameError && <p style={styles.errorText}>{nicknameError}</p>}
            {nicknameSaved && !nicknameError && <p style={styles.savedText}>保存しました。</p>}
          </section>
        </>
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
    padding: "28px 32px 60px",
    maxWidth: 640,
    margin: "0 auto",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#8A8A99",
    fontSize: 12.5,
    fontFamily: "inherit",
    textDecoration: "none",
    background: "none",
    border: "none",
    padding: 0,
    marginBottom: 18,
  },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 20px" },
  loadingRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#8A8A99" },
  notMemberBox: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: "18px 16px",
  },
  notMemberText: { fontSize: 13.5, color: "#C4C4D0", lineHeight: 1.7, margin: "0 0 14px" },
  registerLink: {
    display: "inline-flex",
    alignItems: "center",
    background: "#FF4D6D",
    color: "#1C1417",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13.5,
    fontWeight: 600,
    textDecoration: "none",
  },
  card: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 10,
    padding: "18px 16px",
    marginBottom: 14,
  },
  cardTitle: { fontSize: 14, fontWeight: 600, margin: "0 0 10px" },
  cardBody: { fontSize: 13, color: "#8A8A99", lineHeight: 1.7, margin: "0 0 14px" },
  memberRow: { display: "flex", alignItems: "center", gap: 12 },
  memberNumber: { fontSize: 17, fontWeight: 700, margin: 0 },
  memberSub: { fontSize: 12, color: "#6B6B78", margin: "2px 0 0" },
  twitchLinkedRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  twitchLinkedText: { fontSize: 13.5, margin: "0 0 6px" },
  clipperPageLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12.5,
    color: "#8A8A99",
    textDecoration: "none",
  },
  twitchBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    background: "#7E14FF",
    border: "none",
    borderRadius: 8,
    color: "#EDEDF2",
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 700,
  },
  errorText: { fontSize: 12.5, color: "#F0997B", margin: "8px 0 0" },
  savedText: { fontSize: 12.5, color: "#5DCAA5", margin: "8px 0 0" },
  statsGrid: { display: "flex", gap: 10, marginBottom: 16 },
  statItem: {
    flex: 1,
    background: "#20202B",
    borderRadius: 8,
    padding: "10px 8px",
    textAlign: "center",
  },
  statValue: { fontSize: 17, fontWeight: 700, margin: "0 0 2px" },
  statLabel: { fontSize: 11, color: "#6B6B78", margin: 0 },
  badgeToggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTop: "1px solid #24242F",
    paddingTop: 14,
  },
  badgeToggleTitle: { fontSize: 13, fontWeight: 500, margin: "0 0 3px" },
  badgeToggleNote: { fontSize: 11.5, color: "#6B6B78", margin: 0, lineHeight: 1.5 },
  toggleBtn: {
    flexShrink: 0,
    width: 44,
    height: 24,
    borderRadius: 12,
    background: "#2E2E3A",
    border: "none",
    padding: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  toggleBtnOn: { background: "#7E14FF" },
  toggleKnob: { width: 20, height: 20, borderRadius: "50%", background: "#EDEDF2", transition: "transform 0.15s" },
  toggleKnobOn: { transform: "translateX(20px)" },
  nicknameForm: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    background: "#20202B",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
    color: "#EDEDF2",
  },
  saveBtn: {
    background: "#FF4D6D",
    border: "none",
    borderRadius: 8,
    color: "#1C1417",
    padding: "9px 16px",
    fontSize: 13.5,
    fontWeight: 600,
  },
};
