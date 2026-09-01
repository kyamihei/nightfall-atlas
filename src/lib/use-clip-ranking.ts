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
  twitch_created_at: string | null;
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

export type Period = "all" | "year" | "month" | "day";

/**
 * 期間指定から開始・終了日時(ISO文字列)を計算する。
 * tw-clipの「全期間/年別/月別/日別」に相当するタブ切り替えに使う。
 * referenceDate はその期間の中の1日（例: 日別なら見たい日、月別ならその月の1日など）。
 */
export function getPeriodRange(period: Period, referenceDate: Date = new Date()) {
  if (period === "all") return { start: null, end: null };

  const start = new Date(referenceDate);
  const end = new Date(referenceDate);

  if (period === "year") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    end.setFullYear(start.getFullYear() + 1, 0, 1);
    end.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
  } else {
    // day: tw-clipに合わせて「その日の朝6時〜翌朝6時」を1日の区切りとする
    start.setHours(6, 0, 0, 0);
    if (referenceDate.getHours() < 6) start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 1);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

/** 日次ランキングのクリップ一覧を取得（view_count降順、期間指定・ページネーションつき） */
export function useClips(limit = 20, period: Period = "all", referenceDate?: Date, page = 1) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { start, end } = getPeriodRange(period, referenceDate);
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      let query = supabase
        .from("clips")
        .select("id, title, streamer, game, view_count, thumbnail_url, twitch_created_at", { count: "exact" })
        .order("view_count", { ascending: false })
        .range(from, to);

      if (start) query = query.gte("twitch_created_at", start);
      if (end) query = query.lt("twitch_created_at", end);

      const { data, error, count } = await query;
      if (cancelled) return;
      if (error) {
        setError("クリップの取得に失敗しました");
      } else {
        setClips(data ?? []);
        setTotalCount(count ?? 0);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, period, referenceDate?.getTime(), page]);

  return { clips, loading, error, totalCount };
}

/** クリップ詳細ページ用に、単一クリップをidで取得する */
export function useClip(clipId: string) {
  const [clip, setClip] = useState<Clip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, title, streamer, game, view_count, thumbnail_url, twitch_created_at")
        .eq("id", clipId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setError("クリップが見つかりませんでした");
      } else {
        setClip(data);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  return { clip, loading, error };
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

export interface ReactedClip extends Clip {
  reactedAt: string;
}

/**
 * 自分がいいね／よくないねしたクリップの一覧を取得する。
 * reactionsテーブルをclipsとJOIN（Supabaseの外部キーに基づく自動リレーション）して、
 * クリップ情報ごと一度に取得する。
 */
export function useMyReactions() {
  const [likedClips, setLikedClips] = useState<ReactedClip[]>([]);
  const [dislikedClips, setDislikedClips] = useState<ReactedClip[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const user = await ensureAnonymousSession();
    const { data, error } = await supabase
      .from("reactions")
      .select(
        "type, created_at, clips(id, title, streamer, game, view_count, thumbnail_url, twitch_created_at)",
      )
      .eq("anon_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const liked: ReactedClip[] = [];
      const disliked: ReactedClip[] = [];
      for (const row of data as unknown as { type: string; created_at: string; clips: Clip | null }[]) {
        if (!row.clips) continue; // クリップが削除されている場合はスキップ
        const entry: ReactedClip = { ...row.clips, reactedAt: row.created_at };
        (row.type === "like" ? liked : disliked).push(entry);
      }
      setLikedClips(liked);
      setDislikedClips(disliked);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { likedClips, dislikedClips, loading, refresh };
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

export interface TopBroadcaster {
  streamer: string;
  total_views: number;
  clip_count: number;
  tag: string | null;
}

/** 人気配信者一覧（合計視聴回数順、ページネーションつき）。所属グループタグは手動設定時のみ入る */
export function useTopBroadcasters(limit = 20, offset = 0) {
  const [broadcasters, setBroadcasters] = useState<TopBroadcaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_top_broadcasters", {
        broadcaster_limit: limit,
        broadcaster_offset: offset,
      });
      if (cancelled) return;
      if (!error) setBroadcasters(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, offset]);

  return { broadcasters, loading };
}

export interface BroadcasterProfile {
  clips: Clip[];
  tag: string | null;
  totalViews: number;
  clipCount: number;
}

/** 配信者詳細ページ用に、名前でその配信者のクリップ一覧とタグをまとめて取得する */
export function useBroadcasterProfile(streamer: string, limit = 50) {
  const [profile, setProfile] = useState<BroadcasterProfile>({
    clips: [],
    tag: null,
    totalViews: 0,
    clipCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [clipsRes, tagRes] = await Promise.all([
        supabase
          .from("clips")
          .select("id, title, streamer, game, view_count, thumbnail_url, twitch_created_at")
          .eq("streamer", streamer)
          .order("view_count", { ascending: false })
          .limit(limit),
        supabase
          .from("tracked_broadcasters")
          .select("tag")
          .eq("broadcaster_name", streamer)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (clipsRes.error) {
        setError("配信者情報の取得に失敗しました");
      } else {
        const clips = clipsRes.data ?? [];
        setProfile({
          clips,
          tag: tagRes.data?.tag ?? null,
          totalViews: clips.reduce((sum, c) => sum + c.view_count, 0),
          clipCount: clips.length,
        });
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [streamer, limit]);

  return { ...profile, loading, error };
}
