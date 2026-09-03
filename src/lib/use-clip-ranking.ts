// lib/use-clip-ranking.ts
//
// プロトタイプの window.storage 呼び出しを、実際のSupabaseテーブル/Edge Functionに
// 置き換えるためのデータ層フック集。UIコンポーネント側の構造（clip-ranking-prototype.jsx）は
// ほぼそのまま流用し、この層だけ差し替えるイメージ。

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, ensureAnonymousSession, getAccessToken } from "./supabase-client";

export interface Clip {
  id: string;
  title: string;
  streamer: string;
  game: string;
  view_count: number;
  thumbnail_url: string | null;
  twitch_created_at: string | null;
  creator_id?: string | null;
  creator_name?: string | null;
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
          rows.map(({ id, title, streamer, game, view_count, thumbnail_url, twitch_created_at, creator_id, creator_name }) => ({
            id,
            title,
            streamer,
            game,
            view_count,
            thumbnail_url,
            twitch_created_at,
            creator_id,
            creator_name,
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
        .select("id, title, streamer, game, view_count, thumbnail_url, twitch_created_at, creator_id, creator_name")
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

/**
 * クリップIDの配列から、それぞれの合計お気に入り数（全ユーザー分）をまとめて取得する。
 * useFavoritesは自分自身の「お気に入りしているか」だけを扱うので、一覧表示用の件数はこちらで別途取得する
 * （get_reaction_counts/useReactionsと同じ構成）。
 */
export function useFavoriteCounts(clipIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (clipIds.length === 0) {
      setCounts({});
      return;
    }
    const { data, error } = await supabase.rpc("get_favorite_counts", { clip_ids: clipIds });
    if (error) return;
    const next: Record<string, number> = {};
    for (const row of (data ?? []) as { clip_id: string; favorite_count: number }[]) {
      next[row.clip_id] = Number(row.favorite_count);
    }
    setCounts(next);
  }, [clipIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { counts, refresh };
}

export const REACTION_STAMPS = ["すっご", "うおｗ", "えっど", "こっわ", "うっま", "へった", "ひっど"] as const;
export type ReactionStamp = (typeof REACTION_STAMPS)[number];

/**
 * リアクションスタンプ（いいね/よくないねの代替）。クリップIDの配列から、
 * スタンプ種別ごとの合計件数（全員分）と、自分が押した種別の集合をまとめて取得する。
 * toggle(clipId, stamp)で該当スタンプを付け外しする（Slackの絵文字リアクションのように、
 * 1人が同じクリップに複数種類のスタンプを付けられる）。
 */
export function useClipStamps(clipIds: string[]) {
  const [counts, setCounts] = useState<Record<string, Partial<Record<ReactionStamp, number>>>>({});
  const [myStamps, setMyStamps] = useState<Record<string, Set<ReactionStamp>>>({});

  const refresh = useCallback(async () => {
    if (clipIds.length === 0) {
      setCounts({});
      setMyStamps({});
      return;
    }
    const user = await ensureAnonymousSession();
    const [countsRes, ownRes] = await Promise.all([
      supabase.rpc("get_stamp_counts", { clip_ids: clipIds }),
      supabase.from("clip_reaction_stamps").select("clip_id, stamp").eq("anon_id", user.id).in("clip_id", clipIds),
    ]);

    const nextCounts: Record<string, Partial<Record<ReactionStamp, number>>> = {};
    for (const row of (countsRes.data ?? []) as { clip_id: string; stamp: ReactionStamp; stamp_count: number }[]) {
      (nextCounts[row.clip_id] ??= {})[row.stamp] = Number(row.stamp_count);
    }
    setCounts(nextCounts);

    const nextOwn: Record<string, Set<ReactionStamp>> = {};
    for (const row of (ownRes.data ?? []) as { clip_id: string; stamp: ReactionStamp }[]) {
      (nextOwn[row.clip_id] ??= new Set()).add(row.stamp);
    }
    setMyStamps(nextOwn);
  }, [clipIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (clipId: string, stamp: ReactionStamp) => {
      const user = await ensureAnonymousSession();
      const alreadySelected = myStamps[clipId]?.has(stamp) ?? false;
      if (alreadySelected) {
        await supabase
          .from("clip_reaction_stamps")
          .delete()
          .eq("clip_id", clipId)
          .eq("anon_id", user.id)
          .eq("stamp", stamp);
      } else {
        await supabase
          .from("clip_reaction_stamps")
          .upsert({ clip_id: clipId, anon_id: user.id, stamp }, { onConflict: "clip_id,anon_id,stamp" });
      }
      await refresh();
    },
    [myStamps, refresh],
  );

  return { counts, myStamps, toggle };
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

export interface StampedClip extends Clip {
  stampedAt: string;
}

/**
 * 自分がリアクションスタンプを押したクリップ一覧を、スタンプ種別ごとにグループ化して取得する。
 * clip_reaction_stampsをclipsとJOIN（Supabaseの外部キーに基づく自動リレーション）して、
 * クリップ情報ごと一度に取得する。1つのクリップに複数種類のスタンプを押していれば、
 * それぞれのスタンプのグループに重複して現れる。
 */
export function useMyStamps() {
  const [clipsByStamp, setClipsByStamp] = useState<Record<ReactionStamp, StampedClip[]>>(
    () => Object.fromEntries(REACTION_STAMPS.map((s) => [s, []])) as Record<ReactionStamp, StampedClip[]>,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const user = await ensureAnonymousSession();
    const { data, error } = await supabase
      .from("clip_reaction_stamps")
      .select(
        "stamp, created_at, clips(id, title, streamer, game, view_count, thumbnail_url, twitch_created_at)",
      )
      .eq("anon_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const grouped = Object.fromEntries(REACTION_STAMPS.map((s) => [s, [] as StampedClip[]])) as Record<
        ReactionStamp,
        StampedClip[]
      >;
      for (const row of data as unknown as { stamp: ReactionStamp; created_at: string; clips: Clip | null }[]) {
        if (!row.clips) continue; // クリップが削除されている場合はスキップ
        grouped[row.stamp]?.push({ ...row.clips, stampedAt: row.created_at });
      }
      setClipsByStamp(grouped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { clipsByStamp, loading, refresh };
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

export type ContactCategory = "bug" | "request" | "report" | "other";

/** お問い合わせフォーム送信。contact_messagesは公開閲覧ポリシーがないため、送信専用（submit-contact Edge Function経由） */
export function useContactForm() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = useCallback(async (category: ContactCategory, email: string, body: string) => {
    setSubmitting(true);
    setResult(null);
    try {
      await ensureAnonymousSession();
      const token = await getAccessToken();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ category, email, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "送信に失敗しました" });
      } else {
        setResult({ ok: true, message: "お問い合わせを受け付けました。ありがとうございます" });
      }
    } catch {
      setResult({ ok: false, message: "通信に失敗しました。ネットワークを確認してください" });
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, result };
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

/**
 * 人気配信者一覧（合計視聴回数順、ページネーションつき）。所属グループタグは手動設定時のみ入る。
 * searchQueryを渡すとDB側（get_top_broadcastersのsearch_query引数）で配信者名のあいまい検索を行う
 * （以前は「読み込み済みの1ページ分だけ」をクライアント側でフィルタしていたため、合計視聴回数が
 * 現在のページより低い配信者を検索しても「見つからない」と誤表示される不具合があった）。
 */
export function useTopBroadcasters(limit = 20, offset = 0, searchQuery = "") {
  const [broadcasters, setBroadcasters] = useState<TopBroadcaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      async () => {
        const trimmed = searchQuery.trim();
        const { data, error } = await supabase.rpc("get_top_broadcasters", {
          broadcaster_limit: limit,
          broadcaster_offset: offset,
          search_query: trimmed || null,
        });
        if (cancelled) return;
        if (!error) setBroadcasters(data ?? []);
        setLoading(false);
      },
      searchQuery.trim() ? 300 : 0, // 入力のたびに叩かないよう検索語がある時だけデバウンス
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [limit, offset, searchQuery]);

  return { broadcasters, loading };
}

export interface TopClipper {
  creator_id: string;
  creator_name: string;
  total_views: number;
  clip_count: number;
  profile_image_url: string | null;
  rank?: number;
}

/**
 * 人気クリップ職人一覧（クリップを作った視聴者のランキング、合計視聴回数順）。
 * 配信者ランキングと同じくget_top_broadcasters/get_top_clippersは事前集計済みの
 * マテリアライズドビューを読むだけなので軽量（sync-twitch-clips.ts実行のたびに更新される）。
 */
export type ClipperRankingPeriod = "all" | "year" | "month";

const CLIPPER_RANKING_RPC: Record<ClipperRankingPeriod, string> = {
  all: "get_top_clippers",
  year: "get_top_clippers_this_year",
  month: "get_top_clippers_this_month",
};

/**
 * 人気クリップ職人一覧（合計視聴回数順、ページネーションつき）。
 * 総合(all)/年間(year)/月間(month)いずれも事前集計済みのマテリアライズドビューを読むだけのRPCを
 * 呼ぶ（clips全件・年間規模の毎回集計は匿名ロールのタイムアウトを超えるため。詳細はDB側のコメント参照）。
 */
export function useTopClippers(limit = 20, offset = 0, period: ClipperRankingPeriod = "all") {
  const [clippers, setClippers] = useState<TopClipper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc(CLIPPER_RANKING_RPC[period], {
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
  }, [limit, offset, period]);

  return { clippers, loading };
}

/**
 * 表示中のクリップの作者id一覧から、それぞれの総合ランキング順位（100位以内のみ）をまとめて取得する。
 * ランキング外（101位以降・creator_id無し）のクリップは結果に含まれないので、呼び出し側で
 * ranks[creatorId] が無ければ「ランキング外」として扱う。
 */
export function useClipperRanks(creatorIds: (string | null | undefined)[]) {
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const key = [...new Set(creatorIds.filter(Boolean))].sort().join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setRanks({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_clipper_ranks", { target_creator_ids: ids });
      if (cancelled || error) return;
      const next: Record<string, number> = {};
      for (const row of (data ?? []) as { creator_id: string; rank: number }[]) {
        next[row.creator_id] = row.rank;
      }
      setRanks(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ranks;
}

/** 週間クリップ職人ランキング（トップページ表示用）。指定した期間内に作られたクリップの合計視聴回数順 */
export function useTopClippersByPeriod(periodStart: string, periodEnd: string, limit = 5) {
  const [clippers, setClippers] = useState<TopClipper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_top_clippers_by_period", {
        period_start: periodStart,
        period_end: periodEnd,
        clipper_limit: limit,
      });
      if (cancelled) return;
      if (!error) setClippers(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodStart, periodEnd, limit]);

  return { clippers, loading };
}

export interface TrendingClip extends Clip {
  views_per_hour: number;
}

/**
 * いまトレンドのクリップ（直近lookbackHours時間以内に作られ、作成からの経過時間あたりの
 * 視聴回数が多いクリップ）。view_countの時系列履歴は持っていないため、この「経過時間あたりの
 * 視聴回数」を伸び方の代理指標として使っている（get_trending_clips RPC側の注記も参照）。
 */
export function useTrendingClips(limit = 5, lookbackHours = 72) {
  const [clips, setClips] = useState<TrendingClip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_trending_clips", {
        clip_limit: limit,
        lookback_hours: lookbackHours,
      });
      if (cancelled) return;
      if (!error) setClips(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, lookbackHours]);

  return { clips, loading };
}

export interface ActivityFeedItem {
  id: string;
  type: "comment" | "stamp" | "new_clip";
  clipId: string;
  clipTitle: string;
  displayName?: string;
  stamp?: string;
  streamer?: string;
  createdAt: string;
}

const ACTIVITY_FEED_EXCLUDED_CLIP_ID = "__general_thread__"; // 総合スレの番兵行は対象外にする
const NEW_CLIP_REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 新着クリップ枠の再取得間隔

/**
 * トップページに表示するライブ活動フィード（新着コメント・リアクションスタンプをリアルタイムで
 * 流すティッカー用）。「何かが常に動いている」サイトにしたいという要望で追加
 * （2026-09-03）。マウント時に直近の投稿を初期表示分として取得し、以降はSupabase Realtimeの
 * postgres_changes（INSERT）を購読してその場で先頭に追加する。
 * クリップタイトルはcomments/clip_reaction_stamps側に持っていないため、clip_id→titleの
 * 小さなキャッシュ（Ref）を使い、同じクリップへの連続投稿で毎回問い合わせないようにしている。
 *
 * コメント/スタンプはPVが少ないとほとんど発生せず、フィードが寂しくなってしまう
 * （2026-09-03、ユーザー指摘）ため、clipsテーブルへの新規追加（日次の全体同期・15分おきの
 * ライブ同期で常に流れ込んでくる本物のデータ）も「clip_id→タイトルが確定済み」という
 * 空でも困らない予備枠として混ぜている。3分おきに再取得して、時間が経ってもフィードが
 * 枯れないようにする（新規クリップはRealtime購読ではなく定期取得: バルクupsertのたびに
 * 大量のINSERTイベントが一気に届くのを避けるため）。
 */
export function useActivityFeed(limit = 15) {
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const titleCacheRef = useRef(new Map<string, string>());

  const resolveClipTitle = useCallback(async (clipId: string): Promise<string | null> => {
    const cached = titleCacheRef.current.get(clipId);
    if (cached) return cached;
    const { data } = await supabase.from("clips").select("title").eq("id", clipId).maybeSingle();
    if (!data) return null;
    titleCacheRef.current.set(clipId, data.title);
    return data.title;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: recentComments }, { data: recentStamps }] = await Promise.all([
        supabase
          .from("comments")
          .select("id, clip_id, display_name, created_at")
          .neq("clip_id", ACTIVITY_FEED_EXCLUDED_CLIP_ID)
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase
          .from("clip_reaction_stamps")
          .select("clip_id, stamp, created_at")
          .order("created_at", { ascending: false })
          .limit(limit),
      ]);
      if (cancelled) return;

      const clipIds = [
        ...new Set([
          ...(recentComments ?? []).map((c) => c.clip_id as string),
          ...(recentStamps ?? []).map((s) => s.clip_id as string),
        ]),
      ];
      if (clipIds.length === 0) return;

      const { data: clips } = await supabase.from("clips").select("id, title").in("id", clipIds);
      if (cancelled) return;
      const titleMap = new Map((clips ?? []).map((c) => [c.id as string, c.title as string]));
      titleMap.forEach((title, id) => titleCacheRef.current.set(id, title));

      const commentItems: ActivityFeedItem[] = (recentComments ?? [])
        .filter((c) => titleMap.has(c.clip_id as string))
        .map((c) => ({
          id: `comment-${c.id}`,
          type: "comment" as const,
          clipId: c.clip_id as string,
          clipTitle: titleMap.get(c.clip_id as string)!,
          displayName: c.display_name as string,
          createdAt: c.created_at as string,
        }));
      const stampItems: ActivityFeedItem[] = (recentStamps ?? [])
        .filter((s) => titleMap.has(s.clip_id as string))
        .map((s) => ({
          id: `stamp-${s.clip_id}-${s.stamp}-${s.created_at}`,
          type: "stamp" as const,
          clipId: s.clip_id as string,
          clipTitle: titleMap.get(s.clip_id as string)!,
          stamp: s.stamp as string,
          createdAt: s.created_at as string,
        }));

      const newItems = [...commentItems, ...stampItems];
      // 関数更新にする（直接setItems(newItems)すると、新着クリップ枠のfetchEffectが
      // 先に追加した分を上書きして消してしまうため）
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const merged = [...prev, ...newItems.filter((i) => !existingIds.has(i.id))];
        return merged
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  useEffect(() => {
    let cancelled = false;

    async function fetchRecentClips() {
      const { data } = await supabase
        .from("clips")
        .select("id, title, streamer, created_at")
        .neq("id", ACTIVITY_FEED_EXCLUDED_CLIP_ID)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (cancelled || !data) return;

      const newClipItems: ActivityFeedItem[] = data.map((c) => ({
        id: `new_clip-${c.id}`,
        type: "new_clip",
        clipId: c.id as string,
        clipTitle: c.title as string,
        streamer: c.streamer as string,
        createdAt: c.created_at as string,
      }));

      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const merged = [...prev, ...newClipItems.filter((i) => !existingIds.has(i.id))];
        return merged
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
      });
    }

    fetchRecentClips();
    const timer = setInterval(fetchRecentClips, NEW_CLIP_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit]);

  useEffect(() => {
    const channel = supabase
      .channel("activity-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments" },
        async (payload) => {
          const row = payload.new as { id: string; clip_id: string; display_name: string; created_at: string };
          if (row.clip_id === ACTIVITY_FEED_EXCLUDED_CLIP_ID) return;
          const title = await resolveClipTitle(row.clip_id);
          if (!title) return;
          setItems((prev) => [
            {
              id: `comment-${row.id}`,
              type: "comment",
              clipId: row.clip_id,
              clipTitle: title,
              displayName: row.display_name,
              createdAt: row.created_at,
            },
            ...prev,
          ].slice(0, limit));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "clip_reaction_stamps" },
        async (payload) => {
          const row = payload.new as { clip_id: string; stamp: string; created_at: string };
          const title = await resolveClipTitle(row.clip_id);
          if (!title) return;
          setItems((prev) => [
            {
              id: `stamp-${row.clip_id}-${row.stamp}-${row.created_at}`,
              type: "stamp",
              clipId: row.clip_id,
              clipTitle: title,
              stamp: row.stamp,
              createdAt: row.created_at,
            },
            ...prev,
          ].slice(0, limit));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit, resolveClipTitle]);

  return { items };
}

/**
 * 入力文字列がTwitchクリップのURL（https://clips.twitch.tv/<Slug> または
 * https://www.twitch.tv/<channel>/clip/<Slug>）であれば、そのクリップIDを取り出す。
 * URLでなければnullを返す（＝通常の検索語として扱う）。
 */
export function extractClipIdFromUrl(input: string): string | null {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.hostname === "clips.twitch.tv") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    return id || null;
  }
  if (url.hostname === "www.twitch.tv" || url.hostname === "twitch.tv") {
    const match = url.pathname.match(/\/clip\/([^/?]+)/);
    return match ? match[1] : null;
  }
  return null;
}

export const SEARCH_MIN_LENGTH = 2;

/** クリップタイトルのあいまい検索。SEARCH_MIN_LENGTH未満の検索語は実行しない（呼び出し側の責務） */
export function useClipSearch(query: string) {
  const [results, setResults] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await supabase.rpc("search_clips", { query: trimmed, result_limit: 30 });
      if (cancelled) return;
      if (error) {
        setError("検索に失敗しました。もう少し具体的なキーワードでお試しください");
        setResults([]);
      } else {
        setResults(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return { results, loading, error };
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
  rank: number | null;
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
    rank: null,
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
          | { total_views: number; clip_count: number; profile_image_url: string | null; rank: number | null }
          | undefined;
        setProfile({
          clips,
          creatorName: clips[0]?.creator_name ?? null,
          avatarUrl: stats?.profile_image_url ?? null,
          totalViews: stats?.total_views ?? 0,
          clipCount: stats?.clip_count ?? 0,
          rank: stats?.rank ?? null,
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
