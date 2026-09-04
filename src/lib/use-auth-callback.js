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
 * SupabaseのGoTrueが返す「このOAuthアカウントは既に別のユーザーに連携済み」エラーかどうかを判定する。
 * linkIdentity()でこのエラーになるのは、ログアウト→新しい匿名セッションになった状態で、以前
 * 本登録済みだったのと同じTwitchアカウントを再度連携しようとした場合（＝実際には「連携」ではなく
 * 「その既存アカウントへログインし直したい」状況）に発生する。詳細はisIdentityAlreadyLinkedError
 * の呼び出し元（useAuthConfirmationCallbackのonIdentityConflict分岐）のコメント参照。
 */
export function isIdentityAlreadyLinkedError(message) {
  return /already linked/i.test(message || "");
}

/**
 * onConfirmed(user, { error }) を、本登録済み（is_anonymous === false）になったユーザーが
 * 検出された時、またはURL上のエラー（期限切れリンク等）が検出された時に呼ぶ。
 * userはエラー時はnull。
 *
 * onIdentityConflict（省略可）: URL上のエラーが「既に別ユーザーに連携済み」だった場合に、
 * onConfirmedへエラーを渡す代わりにこちらを呼ぶ。呼び出し元（RegisterPage.jsx）はここで
 * signInWithTwitch()を呼び直すことで、「ログアウト後に同じTwitchアカウントで再度ログイン」
 * という自然な操作を、匿名セッションへのlinkIdentity失敗として弾くのではなく、既存の
 * 本登録済みアカウントへの通常ログインとして成立させる（Supabase公式が案内している
 * anonymous upgrade時の定番フォールバックパターン）。省略時（例: マイページでの追加連携）は
 * 従来通りonConfirmedへエラーとして渡す（既に別アカウントとして本登録済みのセッションで
 * 別のTwitchアカウントを連携しようとしている状況を、勝手に他アカウントへスワップしてはいけないため）。
 */
export function useAuthConfirmationCallback(onConfirmed, onIdentityConflict) {
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });
  const onIdentityConflictRef = useRef(onIdentityConflict);
  useEffect(() => {
    onIdentityConflictRef.current = onIdentityConflict;
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
        if (isIdentityAlreadyLinkedError(urlError) && onIdentityConflictRef.current) {
          await onIdentityConflictRef.current();
          return;
        }
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

/**
 * 既に本登録済みのTwitchアカウントへ通常ログインする（linkIdentityではなくsignInWithOAuth）。
 * useAuthConfirmationCallbackのonIdentityConflictから、linkIdentityが「既に別ユーザーに
 * 連携済み」で失敗した直後のフォールバックとして呼ばれる想定（詳細は同関数のコメント参照）。
 */
export async function signInWithTwitch(redirectTo) {
  return supabase.auth.signInWithOAuth({
    provider: "twitch",
    options: { redirectTo },
  });
}
