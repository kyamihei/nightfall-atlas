// lib/supabase-client.ts
//
// Supabaseクライアントの初期化と、匿名ユーザーIDの発行・保持を行う。
// プロトタイプでは window.storage の anon 相当だった部分を、
// Supabase Anonymous Auth に置き換えたもの。

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true, // ブラウザにセッションを保持し、再訪問時も同じanon_idを維持
    autoRefreshToken: true,
  },
});

/**
 * 匿名ユーザーとしてサインインし、セッションを返す。
 * 既にセッションがあればそれを再利用する（＝同じanon_idを使い続ける）。
 */
export async function ensureAnonymousSession(): Promise<User> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user) {
    return existing.session.user;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`匿名認証に失敗しました: ${error?.message ?? "unknown error"}`);
  }
  return data.user;
}

export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw new Error("セッションがありません。ensureAnonymousSessionを先に呼んでください。");
  }
  return data.session.access_token;
}
