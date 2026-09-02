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
  parent_id: string | null;
}

export type Period = "all" | "year" | "month" | "day";
export type SortBy = "views" | "newest" | "likes" | "comments";

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

/**
 * ランキングのクリップ一覧を取得する（期間指定・並び替え・ページネーションつき）。
 * 並び替え（視聴回数順以外）は集計を伴うため、get_ranked_clips RPCに期間・並び替え・
 * ページネーションをまとめて渡し、DB側で一度に処理する（件数取得もRPCのtotal_countで完結する）。
 */
export function useClips(
  limit = 20,
  period: Period = "all",
  referenceDate?: Date,
  page = 1,
  sortBy: SortBy = "views",
) {
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

      // start/endがnull（全期間）の場合はキーごと省略し、RPC側のデフォルト値
      // （-infinity/infinity）に委ねる。nullを明示的に渡すとPostgREST側のプリペアード
      // ステートメントが汎用実行計画になり、索引が使われずタイムアウトする恐れがあるため。
      const rpcArgs: Record<string, unknown> = {
        sort_by: sortBy,
        page_limit: limit,
        page_offset: from,
      };
      if (start) rpcArgs.period_start = start;
      if (end) rpcArgs.period_end = end;

      const { data, error } = await supabase.rpc("get_ranked_clips", rpcArgs);
      if (cancelled) return;
      if (error) {
        setError("クリップの取得に失敗しました");
      } else {
        const rows = (data ?? []) as (Clip & { total_count: number | string })[];
        setClips(
          rows.map(({ id, title, streamer, game, view_count, thumbnail_url, twitch_created_at }) => ({
            id,
            title,
            streamer,
            game,
            view_count,
            thumbnail_url,
            twitch_created_at,
          })),
        );
        setTotalCount(rows.length > 0 ? Number(rows[0].total_count) : 0);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, period, referenceDate?.getTime(), page, sortBy]);

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

/**
 * クリップ一覧に対する「自分のお気に入り」状態を取得・トグルする。
 * favoritesテーブルはRLSで自分の行のみ閲覧・書き込み可能なため、reactionsと違い
 * 他人の集計値を返すRPCは不要（お気に入り数は仕様上、誰にも公開しない）。
 */
export function useFavorites(clipIds: string[]) {
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (clipIds.length === 0) return;
    const user = await ensureAnonymousSession();
    const { data } = await supabase
      .from("favorites")
      .select("clip_id")
      .eq("anon_id", user.id)
      .in("clip_id", clipIds);
    setFavoritedIds(new Set((data ?? []).map((row) => row.clip_id as string)));
  }, [clipIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (clipId: string) => {
      const user = await ensureAnonymousSession();
      if (favoritedIds.has(clipId)) {
        await supabase.from("favorites").delete().eq("clip_id", clipId).eq("anon_id", user.id);
      } else {
        await supabase
          .from("favorites")
          .upsert({ clip_id: clipId, anon_id: user.id }, { onConflict: "clip_id,anon_id" });
      }
      await refresh();
    },
    [favoritedIds, refresh],
  );

  return { favoritedIds, toggle };
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

export interface FavoritedClip extends Clip {
  favoritedAt: string;
}

/**
 * 自分がお気に入り登録したクリップの一覧を取得する。
 * favoritesテーブルをclipsとJOIN（Supabaseの外部キーに基づく自動リレーション）して、
 * クリップ情報ごと一度に取得する。
 */
export function useMyFavorites() {
  const [favoritedClips, setFavoritedClips] = useState<FavoritedClip[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const user = await ensureAnonymousSession();
    const { data, error } = await supabase
      .from("favorites")
      .select(
        "created_at, clips(id, title, streamer, game, view_count, thumbnail_url, twitch_created_at)",
      )
      .eq("anon_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const favorited: FavoritedClip[] = [];
      for (const row of data as unknown as { created_at: string; clips: Clip | null }[]) {
        if (!row.clips) continue; // クリップが削除されている場合はスキップ
        favorited.push({ ...row.clips, favoritedAt: row.created_at });
      }
      setFavoritedClips(favorited);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { favoritedClips, loading, refresh };
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
        .select("id, display_name, body, created_at, parent_id")
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
    async (body: string, displayName: string, parentId?: string | null) => {
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
          body: JSON.stringify({ clip_id: clipId, body, display_name: displayName, parent_id: parentId ?? null }),
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
  profile_image_url: string | null;
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

export interface TopClipper {
  creator_id: string;
  creator_name: string;
  total_views: number;
  clip_count: number;
  profile_image_url: string | null;
}

/**
 * 人気クリップ職人一覧（クリップを作った視聴者のランキング、合計視聴回数順）。
 * 配信者ランキングと同じくget_top_broadcasters/get_top_clippersは事前集計済みの
 * マテリアライズドビューを読むだけなので軽量（sync-twitch-clips.ts実行のたびに更新される）。
 */
export function useTopClippers(limit = 20, offset = 0) {
  const [clippers, setClippers] = useState<TopClipper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_top_clippers", {
        clipper_limit: limit,
        clipper_offset: offset,
      });
      if (cancelled) return;
      if (!error) setClippers(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, offset]);

  return { clippers, loading };
}

export interface BroadcasterProfile {
  clips: Clip[];
  tag: string | null;
  avatarUrl: string | null;
  totalViews: number;
  clipCount: number;
}

/** 配信者詳細ページ用に、名前でその配信者のクリップ一覧とタグをまとめて取得する（期間指定つき） */
export function useBroadcasterProfile(
  streamer: string,
  limit = 50,
  period: Period = "all",
  referenceDate?: Date,
) {
  const [profile, setProfile] = useState<BroadcasterProfile>({
    clips: [],
    tag: null,
    avatarUrl: null,
    totalViews: 0,
    clipCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { start, end } = getPeriodRange(period, referenceDate);
      let clipsQuery = supabase
        .from("clips")
        .select("id, title, streamer, game, view_count, thumbnail_url, twitch_created_at")
        .eq("streamer", streamer)
        .order("view_count", { ascending: false })
        .limit(limit);
      if (start) clipsQuery = clipsQuery.gte("twitch_created_at", start);
      if (end) clipsQuery = clipsQuery.lt("twitch_created_at", end);

      const [clipsRes, tagRes] = await Promise.all([
        clipsQuery,
        supabase
          .from("tracked_broadcasters")
          .select("tag, profile_image_url")
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
          avatarUrl: tagRes.data?.profile_image_url ?? null,
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
  }, [streamer, limit, period, referenceDate?.getTime()]);

  return { ...profile, loading, error };
}

export interface ClipperProfile {
  clips: Clip[];
  creatorName: string | null;
  avatarUrl: string | null;
  totalViews: number;
  clipCount: number;
}

/**
 * クリップ職人詳細ページ用に、creator_idでそのクリップ職人が作ったクリップ一覧を取得する（期間指定つき）。
 * ヘッダーに出す合計視聴回数・クリップ数は、期間フィルタつきの一覧（limit件まで）からではなく
 * get_clipper_stats RPC（全期間・全件が対象の事前集計値）から取得する。一覧側のlimitに引きずられて
 * 多作なクリップ職人ほど数値が過小表示される、というuseBroadcasterProfileと同種の問題を避けるため。
 */
export function useClipperProfile(
  creatorId: string,
  limit = 50,
  period: Period = "all",
  referenceDate?: Date,
) {
  const [profile, setProfile] = useState<ClipperProfile>({
    clips: [],
    creatorName: null,
    avatarUrl: null,
    totalViews: 0,
    clipCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { start, end } = getPeriodRange(period, referenceDate);
      let clipsQuery = supabase
        .from("clips")
        .select("id, title, streamer, game, view_count, thumbnail_url, twitch_created_at, creator_name")
        .eq("creator_id", creatorId)
        .order("view_count", { ascending: false })
        .limit(limit);
      if (start) clipsQuery = clipsQuery.gte("twitch_created_at", start);
      if (end) clipsQuery = clipsQuery.lt("twitch_created_at", end);

      const [clipsRes, statsRes] = await Promise.all([
        clipsQuery,
        supabase.rpc("get_clipper_stats", { target_creator_id: creatorId }),
      ]);
      if (cancelled) return;
      if (clipsRes.error) {
        setError("クリップ職人情報の取得に失敗しました");
      } else {
        const clips = (clipsRes.data ?? []) as (Clip & { creator_name: string | null })[];
        const stats = statsRes.data?.[0] as
          | { total_views: number; clip_count: number; profile_image_url: string | null }
          | undefined;
        setProfile({
          clips,
          creatorName: clips[0]?.creator_name ?? null,
          avatarUrl: stats?.profile_image_url ?? null,
          totalViews: stats?.total_views ?? 0,
          clipCount: stats?.clip_count ?? 0,
        });
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [creatorId, limit, period, referenceDate?.getTime()]);

  return { ...profile, loading, error };
}

/**
 * 配信者名の配列から、アイコン画像URLをまとめて取得する（クリップ一覧・詳細ページ用）。
 * clips.streamerはtracked_broadcasters.broadcaster_nameへの外部キーではないテキスト列なので、
 * Supabaseの自動JOINは使えず、名前の配列でtracked_broadcastersを直接検索する。
 */
export function useBroadcasterAvatars(streamerNames: string[]) {
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const key = streamerNames.join("|");

  useEffect(() => {
    if (streamerNames.length === 0) {
      setAvatars({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tracked_broadcasters")
        .select("broadcaster_name, profile_image_url")
        .in("broadcaster_name", streamerNames)
        .not("profile_image_url", "is", null);
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.profile_image_url) map[row.broadcaster_name] = row.profile_image_url;
      }
      setAvatars(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return avatars;
}
