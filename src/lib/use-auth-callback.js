// lib/use-auth-callback.js
//
// メール確認リンク・TwitchなどのOAuthリダイレクトから戻ってきた際の共通処理
// （2026-09-04、Twitchログイン機能追加に伴いRegisterPage.jsxから切り出し）。
//
// RegisterPage.jsxで一度実際に踏んだ重大なバグ（refreshSession()を「保険」として
// 呼んだところ、それ自体がTOKEN_REFRESHEDイベントを発生させ、そのイベントで再び
// このチェックが走ってrefreshSession()を呼ぶ…という無限ループになり、本番で秒間
// 何十回もトークン更新が走り続けた）の教訓をそのまま踏襲する: refreshSession()は
// 呼ばず、onAuthStateChangeはSIGNED_INとUSER_UPDATEDだけを拾う。
// この共通化を怠って2箇所（RegisterPage.jsxとマイページのTwitch連携ボタン）に
// 同種のロジックを手書きで複製すると、同じ種類のバグを再発させるリスクがあるため
// 1箇所にまとめている。

import { useEffect, useRef } from "react";
import { supabase, ensureAnonymousSession } from "./supabase-client";

/**
 * onConfirmed(user, { error }) を、本登録済み（is_anonymous === false）になったユーザーが
 * 検出された時、またはURL上のエラー（期限切れリンク等）が検出された時に呼ぶ。
 * userはエラー時はnull。
 */
export function useAuthConfirmationCallback(onConfirmed) {
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });

  useEffect(() => {
    let cancelled = false;

    // PKCEフロー（?code=...）はsupabase-jsのdetectSessionInUrl（既定true）が自動で
    // 交換してくれるはずだが、そのタイミングとこのuseEffectの実行タイミングが競合する
    // 可能性を排除するため、明示的にexchangeCodeForSessionを呼んでおく（二重に呼んでも実害はない）。
    // リンクが期限切れ/既に使用済み等で失敗した場合はSupabaseが
    // ?error=...&error_description=...を付けて返してくるため、ここで検知する
    // （検知しないと「何も起きず入力画面に戻る」という分かりにくい状態になる）。
    async function handleUrlParams() {
      const url = new URL(window.location.href);
      const errorDescription = url.searchParams.get("error_description");
      const code = url.searchParams.get("code");
      let handled = false;
      let error = null;

      if (errorDescription) {
        error = decodeURIComponent(errorDescription);
        handled = true;
      } else if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) error = exchangeError.message;
        handled = true;
      }

      if (handled) {
        url.search = "";
        window.history.replaceState({}, "", url.toString());
      }
      return error;
    }

    async function check() {
      const urlError = await handleUrlParams();
      if (cancelled) return;
      if (urlError) {
        onConfirmedRef.current(null, { error: urlError });
        return;
      }
      await ensureAnonymousSession();
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;
      if (data.user.is_anonymous === false) {
        onConfirmedRef.current(data.user, { error: null });
      }
    }
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") check();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
}

/**
 * Twitchアカウントを現在のセッション（匿名セッション含む）に連携する。linkIdentity
 * （signInWithOAuthではない）を使うことで、匿名セッションのauth.uid()を維持したまま
 * 昇格させ、既存のお気に入り・配信者タグ・スタンプ・コメントを引き継ぐ
 * （既存のメール登録がupdateUser({email})を使っているのと同じ考え方）。
 */
export async function linkTwitchIdentity(redirectTo) {
  return supabase.auth.linkIdentity({
    provider: "twitch",
    options: { redirectTo },
  });
}
