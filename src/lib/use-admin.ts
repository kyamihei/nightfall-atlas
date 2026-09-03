// lib/use-admin.ts
//
// 簡易管理画面（推測されにくいよう非公開のURLで運用。パスは src/App.jsx 参照）用のデータ層。
// ログイン機能が無いサイトのため、パスワードは
// sessionStorage（タブ/ブラウザを閉じたら消える程度の簡易セッション）に保持し、
// 各データ取得・更新のたびにRPCへ渡してDB側（security definer関数）で毎回照合する。
// 対象テーブルはRLSで「本人以外閲覧不可」になっており、通常のテーブルアクセスでは
// 読めない（詳細はsupabase/migrations/20260903150000_admin_panel.sql）。

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase-client";

const ADMIN_PASSWORD_KEY = "cv-admin-password";

export function useAdminAuth() {
  const [password, setPasswordState] = useState(() => sessionStorage.getItem(ADMIN_PASSWORD_KEY) ?? "");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);

  const login = useCallback(async (candidate) => {
    setVerifying(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("admin_verify_password", { p_password: candidate });
      if (error || !data) {
        setError("パスワードが違います");
        return false;
      }
      sessionStorage.setItem(ADMIN_PASSWORD_KEY, candidate);
      setPasswordState(candidate);
      return true;
    } catch {
      setError("通信に失敗しました。ネットワークを確認してください");
      return false;
    } finally {
      setVerifying(false);
    }
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
    setPasswordState("");
  }, []);

  return { password, isAuthed: !!password, login, logout, verifying, error };
}

export function useAdminContactMessages(password) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_contact_messages", { p_password: password });
    if (error) setError(error.message);
    else {
      setMessages(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setStatus = useCallback(
    async (id, status) => {
      await supabase.rpc("admin_set_contact_status", { p_password: password, p_id: id, p_status: status });
      await refresh();
    },
    [password, refresh],
  );

  return { messages, loading, error, refresh, setStatus };
}

export function useAdminCommentReports(password) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_comment_reports", { p_password: password });
    if (error) setError(error.message);
    else {
      setReports(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setHidden = useCallback(
    async (commentId, hidden) => {
      await supabase.rpc("admin_set_comment_hidden", { p_password: password, p_comment_id: commentId, p_hidden: hidden });
      await refresh();
    },
    [password, refresh],
  );

  return { reports, loading, error, refresh, setHidden };
}

export function useAdminDashboard(password) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_dashboard", { p_password: password });
    if (error) setError(error.message);
    else {
      setData(data);
      setError(null);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function useAdminBroadcasterRequests(password) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("admin_get_broadcaster_requests", { p_password: password });
      if (cancelled) return;
      if (error) setError(error.message);
      else {
        setRequests(data ?? []);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [password]);

  return { requests, loading, error };
}
