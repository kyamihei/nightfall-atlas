// lib/use-clip-ranking.ts
//
// プロトタイプの window.storage 呼び出しを、実際のSupabaseテーブル/Edge Functionに
// 置き換えるためのデータ層フック集。UIコンポーネント側の構造（clip-ranking-prototype.jsx）は
// ほぼそのまま流用し、この層だけ差し替えるイメージ。

import { useCallback, useEffect, useState } from "react";
import { supabase, ensureAnonymousSession, getAccessToken } from "./supabase-client";

export interface Clip {
  id: string;
  title: string;
  streamer: string;
  game: string;
  view_count: number;
  thumbnail_url: string | null;
}

export interface ReactionCounts {
  likes: number;
  dislikes: number;
}

export interface CommentRow {
  id: string;
  display_name: string;
  body: string;
  created_at: string;
}

/** 日次ランキングのクリップ一覧を取得（view_count降順） */
export function useClips(limit = 20) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, title, streamer, game, view_count, thumbnail_url")
        .order("view_count", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (error) {
        setError("クリップの取得に失敗しました");
      } else {
        setClips(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { clips, loading, error };
}

/**
 * 自分のいいね/よくないね状態と、クリップごとの合計カウントを扱うフック。
 * カウントはRPC（下記SQL関数）でまとめて取得し、投票はreactionsテーブルへの
 * upsert/deleteで行う。
 *
 * 対応するSupabase RPC（あらかじめ作成しておく）:
 *
 *   create or replace function get_reaction_counts(clip_ids text[])
 *   returns table(clip_id text, likes bigint, dislikes bigint) as $$
 *     select clip_id,
 *       count(*) filter (where type = 'like') as likes,
 *       count(*) filter (where type = 'dislike') as dislikes
 *     from reactions
 *     where clip_id = any(clip_ids)
 *     group by clip_id;
 *   $$ language sql stable;
 */
export function useReactions(clipIds: string[]) {
  const [counts, setCounts] = useState<Record<string, ReactionCounts>>({});
  const [myVotes, setMyVotes] = useState<Record<string, "like" | "dislike">>({});

  const refresh = useCallback(async () => {
    if (clipIds.length === 0) return;
    const user = await ensureAnonymousSession();

    const { data: countRows } = await supabase.rpc("get_reaction_counts", { clip_ids: clipIds });
    const nextCounts: Record<string, ReactionCounts> = {};
    for (const row of countRows ?? []) {
      nextCounts[row.clip_id] = { likes: Number(row.likes), dislikes: Number(row.dislikes) };
    }
    setCounts(nextCounts);

    const { data: ownRows } = await supabase
      .from("reactions")
      .select("clip_id, type")
      .eq("anon_id", user.id)
      .in("clip_id", clipIds);
    const nextVotes: Record<string, "like" | "dislike"> = {};
    for (const row of ownRows ?? []) {
      nextVotes[row.clip_id] = row.type as "like" | "dislike";
    }
    setMyVotes(nextVotes);
  }, [clipIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const vote = useCallback(
    async (clipId: string, type: "like" | "dislike") => {
      const user = await ensureAnonymousSession();
      const current = myVotes[clipId];

      if (current === type) {
        // 取り消し
        await supabase.from("reactions").delete().eq("clip_id", clipId).eq("anon_id", user.id);
      } else {
        // upsert（unique制約 clip_id+anon_id により、既存の票があれば置き換わる）
        await supabase
          .from("reactions")
          .upsert({ clip_id: clipId, anon_id: user.id, type }, { onConflict: "clip_id,anon_id" });
      }
      await refresh();
    },
    [myVotes, refresh],
  );

  return { counts, myVotes, vote };
}

/** お気に入りの取得とトグル */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const user = await ensureAnonymousSession();
    const { data } = await supabase.from("favorites").select("clip_id").eq("anon_id", user.id);
    setFavorites(new Set((data ?? []).map((r) => r.clip_id)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (clipId: string) => {
      const user = await ensureAnonymousSession();
      if (favorites.has(clipId)) {
        await supabase.from("favorites").delete().eq("clip_id", clipId).eq("anon_id", user.id);
      } else {
        await supabase.from("favorites").insert({ clip_id: clipId, anon_id: user.id });
      }
      await refresh();
    },
    [favorites, refresh],
  );

  return { favorites, toggle };
}

/**
 * 特定クリップのコメントを取得し、Realtimeで新規投稿を購読する。
 * 投稿自体はEdge Function（post-comment）を経由させ、
 * NGワード検査・レート制限をサーバー側で強制する。
 */
export function useComments(clipId: string) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("comments")
        .select("id, display_name, body, created_at")
        .eq("clip_id", clipId)
        .eq("is_hidden", false)
        .order("created_at", { ascending: true });
      if (!cancelled) setComments(data ?? []);
    })();

    const channel = supabase
      .channel(`comments:${clipId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `clip_id=eq.${clipId}` },
        (payload) => {
          setComments((prev) => [...prev, payload.new as CommentRow]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [clipId]);

  const submit = useCallback(
    async (body: string, displayName: string) => {
      setSubmitting(true);
      setError(null);
      try {
        await ensureAnonymousSession();
        const token = await getAccessToken();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/post-comment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ clip_id: clipId, body, display_name: displayName }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error ?? "投稿に失敗しました");
        }
      } catch {
        setError("通信に失敗しました。ネットワークを確認してください");
      } finally {
        setSubmitting(false);
      }
    },
    [clipId],
  );

  return { comments, submit, submitting, error };
}

export interface BroadcasterSearchResult {
  broadcaster_id: string;
  broadcaster_name: string;
}

/** 配信者名のあいまい検索。入力が空なら検索しない */
export function useBroadcasterSearch(query: string) {
  const [results, setResults] = useState<BroadcasterSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("tracked_broadcasters")
        .select("broadcaster_id, broadcaster_name")
        .ilike("broadcaster_name", `%${trimmed}%`)
        .limit(10);
      if (!cancelled) {
        setResults(data ?? []);
        setSearching(false);
      }
    }, 300); // 入力のたびに叩かないようデバウンス

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, searching };
}

/** 検索して見つからなかった配信者の登録リクエストを送信する */
export function useBroadcasterRequest() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const request = useCallback(async (twitchLogin: string) => {
    setSubmitting(true);
    setResult(null);
    try {
      await ensureAnonymousSession();
      const token = await getAccessToken();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-broadcaster`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ twitch_login: twitchLogin }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "登録リクエストに失敗しました" });
      } else {
        setResult({ ok: true, message: data.message ?? "登録リクエストを受け付けました" });
      }
    } catch {
      setResult({ ok: false, message: "通信に失敗しました。ネットワークを確認してください" });
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { request, submitting, result };
}

/** コメント通報。RLSの comment_reports_insert_own ポリシーに従い、自分のanon_idで1件だけ挿入する */
export function useCommentReport() {
  const [reporting, setReporting] = useState(false);

  const report = useCallback(async (commentId: string) => {
    setReporting(true);
    try {
      const user = await ensureAnonymousSession();
      const { error } = await supabase
        .from("comment_reports")
        .insert({ comment_id: commentId, anon_id: user.id });
      // unique制約(comment_id, anon_id)違反 = 既に通報済み。エラーとして扱わない
      if (error && error.code !== "23505") {
        throw error;
      }
      return true;
    } catch {
      return false;
    } finally {
      setReporting(false);
    }
  }, []);

  return { report, reporting };
}
