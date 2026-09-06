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

// サイト閲覧の可視化用（2026-09-06追加）。GA4も別途導入済みだが、あちらを見るには
// Google Analyticsに毎回ログインする必要があるため、日々の運用でパッと見るぶんには
// 管理画面内で完結する簡易版として用意した。
export function useAdminPageViews(password) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_page_view_stats", { p_password: password });
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

export function useAdminMembers(password) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_members", { p_password: password });
    if (error) setError(error.message);
    else {
      setMembers(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteMember = useCallback(
    async (id) => {
      await supabase.rpc("admin_delete_member", { p_password: password, p_id: id });
      await refresh();
    },
    [password, refresh],
  );

  return { members, loading, error, refresh, deleteMember };
}

// クリップタグの一覧・非表示切り替え（2026-09-05追加）。useAdminMembersと同じ構成だが、
// 取り消せない削除ではなく可逆な非表示トグル（comment_reportsパネルと同じ考え方）にしている。
export function useAdminClipTags(password) {
  const [clipTags, setClipTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_recent_clip_tags", { p_password: password });
    if (error) setError(error.message);
    else {
      setClipTags(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setHidden = useCallback(
    async (id, hidden) => {
      await supabase.rpc("admin_set_clip_tag_hidden", { p_password: password, p_id: id, p_hidden: hidden });
      await refresh();
    },
    [password, refresh],
  );

  return { clipTags, loading, error, refresh, setHidden };
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
