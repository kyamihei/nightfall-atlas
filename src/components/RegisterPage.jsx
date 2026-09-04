import { useEffect, useState } from "react";
import { ArrowLeft, Award, Loader2, LogIn, Mail, UserPlus } from "lucide-react";
import { supabase, ensureAnonymousSession } from "../lib/supabase-client";
import { useMembership } from "../lib/use-clip-ranking";
import { useSmartBack } from "../lib/use-smart-back";
import Footer from "./Footer";

const REGISTER_PATH = "/register";

/**
 * 会員登録ページ（2026-09-04追加）。「早めに登録した人ほど若い会員番号が付き、後々自慢できる」
 * という要望への対応。匿名セッション（anon_id）をそのまま維持しつつメール+パスワードを
 * 後付けする「匿名→本登録」方式（Supabase Auth）を採用しているため、既存のお気に入り・
 * 配信者タグ・リアクション履歴もこの登録によって失われない。
 *
 * 流れ: ①メールアドレス入力→確認メール送信 ②メール内リンクをクリックして/registerへ戻る
 * （emailRedirectToで同じページに戻す設計、リンクを開いた時点でこのページの再マウント時に
 * セッションの状態から確認済みかどうかを判定する） ③パスワード設定 ④register_member() RPCで
 * 会員番号を発行。既に別の端末で登録済みの場合は「ログイン」タブからメール+パスワードで
 * サインインすれば同じ番号を引き継げる。
 */
export default function RegisterPage() {
  const goBack = useSmartBack("/");
  const { memberNumber, loading: membershipLoading, refresh: refreshMembership } = useMembership();
  const [mode, setMode] = useState("register"); // register | login

  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  // マウント時・認証状態の変化のたびに「メール確認済みか」を見る。確認メールのリンクは
  // このページ（/register）へ戻ってくるように送るため、リンクを踏んだ直後の再訪問もここで拾える。
  useEffect(() => {
    let cancelled = false;

    // メール確認リンクを踏んで戻ってきた直後のURLを処理する。PKCEフロー（?code=...）の場合、
    // supabase-jsのdetectSessionInUrl（既定true）が自動で交換してくれるはずだが、
    // そのタイミングとこのuseEffectの実行タイミングが競合する可能性を排除するため、
    // 明示的にexchangeCodeForSessionを呼んでおく（二重に呼んでも実害はない）。
    // また、リンクが期限切れ/既に使用済み等で失敗した場合はSupabaseが
    // ?error=...&error_description=...を付けて返してくるため、ここで検知してユーザーに
    // 表示する（検知しないと「何も起きず入力画面に戻る」という分かりにくい状態になる）。
    async function handleUrlParams() {
      const url = new URL(window.location.href);
      const errorDescription = url.searchParams.get("error_description");
      const code = url.searchParams.get("code");
      let handled = false;

      if (errorDescription) {
        setError(`メール内リンクの確認に失敗しました: ${decodeURIComponent(errorDescription)}`);
        handled = true;
      } else if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(`メール内リンクの確認に失敗しました: ${exchangeError.message}`);
        }
        handled = true;
      }

      if (handled) {
        url.search = "";
        window.history.replaceState({}, "", url.toString());
      }
    }

    async function checkConfirmed() {
      await handleUrlParams();
      if (cancelled) return;
      await ensureAnonymousSession();
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;
      if (data.user.email && data.user.is_anonymous === false) {
        setEmailConfirmed(true);
        setEmail(data.user.email);
      }
    }
    checkConfirmed();
    // is_anonymousの判定はauth.usersの実データを見るregister_member() RPC側で行うため、
    // ここでrefreshSession()を呼んでトークンを強制更新する必要はない（2026-09-04に一度
    // 「保険」として追加したが、これ自体がTOKEN_REFRESHEDイベントを発生させ、そのイベントで
    // またcheckConfirmed→refreshSessionが呼ばれる無限ループを引き起こす実害の方が大きい
    // バグだったため削除した。実際に本番で秒間何十回もトークン更新が走り続ける状態を
    // 直接確認して特定・修正した）。
    // SIGNED_INとUSER_UPDATEDだけ拾えば十分（メール確認直後の同一タブでの反映、
    // ログインタブからのサインイン、いずれもこのどちらかで拾える）。TOKEN_REFRESHEDや
    // INITIAL_SESSION等の無関係なイベントでは再チェックしない。
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") checkConfirmed();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSendEmail(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("メールアドレスを入力してください。");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser(
      { email: trimmed },
      { emailRedirectTo: `${window.location.origin}${REGISTER_PATH}` },
    );
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message || "メールの送信に失敗しました。");
      return;
    }
    setEmailSent(true);
  }

  async function handleRecheck() {
    setSubmitting(true);
    setError("");
    const { data } = await supabase.auth.getUser();
    setSubmitting(false);
    if (data.user?.email && data.user.is_anonymous === false) {
      setEmailConfirmed(true);
    } else {
      setError("まだ確認が完了していないようです。メール内のリンクを開いてからもう一度お試しください。");
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    if (password.length < 8) {
      setError("パスワードは8文字以上で入力してください。");
      return;
    }
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: pwError } = await supabase.auth.updateUser({ password });
    if (pwError) {
      setSubmitting(false);
      setError(pwError.message || "パスワードの設定に失敗しました。");
      return;
    }
    const { error: rpcError } = await supabase.rpc("register_member");
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || "会員登録の確定に失敗しました。時間をおいて再度お試しください。");
      return;
    }
    await refreshMembership();
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("メールアドレスとパスワードを入力してください。");
      return;
    }
    setLoginSubmitting(true);
    setLoginError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    if (signInError) {
      setLoginSubmitting(false);
      setLoginError("メールアドレスまたはパスワードが違います。");
      return;
    }
    // 念のための保険（通常は既に発行済みのはずだが、何らかの理由で未発行だった場合に備える。冪等なので安全）
    await supabase.rpc("register_member");
    setLoginSubmitting(false);
    await refreshMembership();
  }

  return (
    <div style={styles.page}>
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
        会員登録
      </h1>
      <p style={styles.tagline}>
        登録すると会員番号が発行され、コメントに番号バッジが表示されます。早く登録するほど若い番号になります。
      </p>

      {membershipLoading ? (
        <div style={styles.loadingRow}>
          <Loader2 size={16} style={{ animation: "cv-spin 1s linear infinite" }} />
          確認中…
        </div>
      ) : memberNumber !== null ? (
        <div style={styles.successBox}>
          <Award size={20} />
          <div>
            <p style={styles.successTitle}>あなたの会員番号は #{memberNumber} です</p>
            <p style={styles.successBody}>コメントを投稿すると、名前の横にこの番号のバッジが表示されます。</p>
          </div>
        </div>
      ) : (
        <>
          <div style={styles.modeTabs}>
            <button
              onClick={() => setMode("register")}
              style={mode === "register" ? styles.modeTabActive : styles.modeTab}
            >
              <UserPlus size={14} />
              新規登録
            </button>
            <button onClick={() => setMode("login")} style={mode === "login" ? styles.modeTabActive : styles.modeTab}>
              <LogIn size={14} />
              ログイン
            </button>
          </div>

          {mode === "register" && (
            <>
              {!emailConfirmed ? (
                !emailSent ? (
                  <form onSubmit={handleSendEmail} style={styles.form}>
                    <label style={styles.label}>
                      メールアドレス
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="example@example.com"
                        style={styles.input}
                        maxLength={200}
                      />
                    </label>
                    {error && <p style={styles.errorText}>{error}</p>}
                    <button type="submit" style={styles.submitBtn} disabled={submitting}>
                      <Mail size={14} />
                      {submitting ? "送信中…" : "確認メールを送る"}
                    </button>
                  </form>
                ) : (
                  <div style={styles.waitBox}>
                    <p style={styles.waitText}>
                      <strong>{email}</strong> に確認メールを送信しました。メール内のリンクを開いてください。
                      同じブラウザで開けば、このページに戻ってきたときに自動で次の画面になります。
                    </p>
                    {error && <p style={styles.errorText}>{error}</p>}
                    <button onClick={handleRecheck} style={styles.submitBtn} disabled={submitting}>
                      {submitting ? "確認中…" : "確認できたら次へ"}
                    </button>
                  </div>
                )
              ) : (
                <form onSubmit={handleSetPassword} style={styles.form}>
                  <p style={styles.waitText}>メールを確認しました。ログイン用のパスワードを設定してください。</p>
                  <label style={styles.label}>
                    パスワード（8文字以上）
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={styles.input}
                      minLength={8}
                    />
                  </label>
                  <label style={styles.label}>
                    パスワード（確認）
                    <input
                      type="password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      style={styles.input}
                      minLength={8}
                    />
                  </label>
                  {error && <p style={styles.errorText}>{error}</p>}
                  <button type="submit" style={styles.submitBtn} disabled={submitting}>
                    {submitting ? "登録中…" : "登録を完了する"}
                  </button>
                </form>
              )}
            </>
          )}

          {mode === "login" && (
            <form onSubmit={handleLogin} style={styles.form}>
              <p style={styles.waitText}>別の端末で登録済みの場合、ログインすると同じ会員番号を引き継げます。</p>
              <label style={styles.label}>
                メールアドレス
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  style={styles.input}
                  maxLength={200}
                />
              </label>
              <label style={styles.label}>
                パスワード
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  style={styles.input}
                />
              </label>
              {loginError && <p style={styles.errorText}>{loginError}</p>}
              <button type="submit" style={styles.submitBtn} disabled={loginSubmitting}>
                <LogIn size={14} />
                {loginSubmitting ? "ログイン中…" : "ログイン"}
              </button>
            </form>
          )}
        </>
      )}

      <Footer />
    </div>
  );
}

const styles = {
  page: {
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
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 6px" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: "0 0 24px", lineHeight: 1.6 },
  loadingRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#8A8A99" },
  modeTabs: { display: "flex", gap: 8, marginBottom: 20 },
  modeTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#8A8A99",
    borderRadius: 20,
    padding: "7px 14px",
    fontSize: 13,
  },
  modeTabActive: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#24242F",
    border: "1px solid #3A3A48",
    color: "#EDEDF2",
    borderRadius: 20,
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 500,
  },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#9797A6" },
  input: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
    color: "#EDEDF2",
  },
  errorText: { fontSize: 12.5, color: "#F0997B", margin: 0 },
  submitBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "#FF4D6D",
    border: "none",
    borderRadius: 8,
    color: "#1C1417",
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 600,
  },
  waitBox: { display: "flex", flexDirection: "column", gap: 14 },
  waitText: { fontSize: 13.5, color: "#C4C4D0", lineHeight: 1.7, margin: 0 },
  successBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    background: "#1C2A20",
    border: "1px solid #2E4A38",
    color: "#8FDDA8",
    borderRadius: 10,
    padding: "18px 16px",
  },
  successTitle: { fontSize: 15, fontWeight: 700, margin: "0 0 6px" },
  successBody: { fontSize: 13, margin: 0, lineHeight: 1.6, color: "#8FDDA8CC" },
};
