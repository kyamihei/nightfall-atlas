// sync-live-clips.ts
//
// sync-twitch-clips.ts（1日1回、追跡中の全配信者を対象）とは別に、「今まさにライブ配信中の
// 追跡配信者」だけを高頻度（例: 15分おき）でチェックし、新しいクリップを素早く反映するための
// 軽量スクリプト。クリップはライブ配信中にしか作られないため、ライブ中の配信者だけに絞ることで
// 対象数を大きく減らし、日次フル同期より遥かに高い頻度で回してもTwitch APIコール数・
// 実行時間を抑えられる（2026-09-03、「最新クリップの反映が遅い」という要望への対応で追加）。
//
// 配信者の新規発見・過去分バックフィル・配信者/クリッパーランキング集計ビューの更新は
// 引き続きsync-twitch-clips.ts（日次）の役割のまま。このスクリプトはclipsテーブルへの
// 新規クリップ反映だけを担当する（get_ranked_clips/get_trending_clipsはclipsテーブルを
// 直接ライブ集計するRPCのため、ここでupsertした時点から即座にランキング/トレンドへ反映される。
// 集計ビュー経由の配信者/クリッパーランキングだけは引き続き日次更新のまま多少遅れる）。
//
// 実行例: deno run --allow-net --allow-env sync-live-clips.ts
//
// 必要な環境変数:
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BROADCASTER_STALE_DAYS = 30; // sync-twitch-clips.tsと同じ「追跡対象」の定義に揃える
const HELIX_STREAMS_ID_BATCH = 100; // Get Streamsはuser_idを1リクエスト最大100個まで指定できる
const HELIX_CLIPS_PAGE_SIZE = 20; // 15分程度の短い窓で1配信者が20件を超えてクリップを作ることは想定しない
// 実行間隔（15分想定）より広めに取ることで、実行の遅延・失敗が1回あっても
// 次回実行で取りこぼしなくカバーできるようにする安全マージン
const CLIP_LOOKBACK_MINUTES = 30;
const RATE_LIMIT_RETRY_MAX = 3;
const RATE_LIMIT_DEFAULT_WAIT_MS = 10_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimitReset(res: Response) {
  const resetHeader = res.headers.get("Ratelimit-Reset");
  if (resetHeader) {
    const resetAtMs = Number(resetHeader) * 1000;
    const waitMs = Math.max(0, resetAtMs - Date.now()) + 500;
    await sleep(waitMs);
  } else {
    await sleep(RATE_LIMIT_DEFAULT_WAIT_MS);
  }
}

/** fetchのラッパー。429（レート制限）時はRatelimit-Resetまで待ってリトライする。 */
async function fetchWithRetry(url: URL, token: string): Promise<Response | null> {
  let res: Response | null = null;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_MAX; attempt++) {
    res = await fetch(url, {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status !== 429) break;
    if (attempt < RATE_LIMIT_RETRY_MAX) {
      console.log(`レート制限、待機してリトライします（${attempt + 1}回目）: ${url.pathname}`);
      await waitForRateLimitReset(res);
    }
  }
  return res;
}

/**
 * PostgRESTの既定の行数上限（Supabase側の設定で1000件）を超えるSELECTは、
 * range()等で明示的にページングしない限りサイレントに切り詰められる
 * （tracked_broadcastersが1000件を超えて以降、sync-twitch-clips.ts側で実際に踏んでいた罠と同じ）。
 */
async function fetchAllRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  table: string,
  // deno-lint-ignore no-explicit-any
  buildQuery: (query: any) => any,
  // deno-lint-ignore no-explicit-any
): Promise<any[] | null> {
  const PAGE_SIZE = 1000;
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery(supabase.from(table)).range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`${table}の取得に失敗しました:`, error.message);
      return null;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function getAppAccessToken(): Promise<string> {
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", TWITCH_CLIENT_ID);
  url.searchParams.set("client_secret", TWITCH_CLIENT_SECRET);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Twitchトークン取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

interface TwitchClip {
  id: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  title: string;
  view_count: number;
  thumbnail_url: string;
  game_id: string;
  created_at: string;
}

/** 追跡中の配信者idのうち、いま実際にライブ配信中の人だけを返す（Get Streamsは指定id中の"ライブ中"のものだけ返す）。 */
async function fetchLiveBroadcasterIds(token: string, broadcasterIds: string[]): Promise<string[]> {
  const liveIds: string[] = [];

  for (let i = 0; i < broadcasterIds.length; i += HELIX_STREAMS_ID_BATCH) {
    const chunk = broadcasterIds.slice(i, i + HELIX_STREAMS_ID_BATCH);
    const url = new URL("https://api.twitch.tv/helix/streams");
    chunk.forEach((id) => url.searchParams.append("user_id", id));
    url.searchParams.set("first", String(HELIX_STREAMS_ID_BATCH));

    const res = await fetchWithRetry(url, token);
    if (!res || !res.ok) {
      console.error(`ライブ状況の確認に失敗しました（${chunk.length}件分）: ${res?.status}`);
      continue;
    }
    const data = await res.json();
    for (const s of data.data as { user_id: string }[]) {
      liveIds.push(s.user_id);
    }
  }

  return liveIds;
}

async function fetchRecentClipsForBroadcaster(
  token: string,
  broadcasterId: string,
  startedAt: string,
  endedAt: string,
): Promise<TwitchClip[]> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("broadcaster_id", broadcasterId);
  url.searchParams.set("started_at", startedAt);
  url.searchParams.set("ended_at", endedAt);
  url.searchParams.set("first", String(HELIX_CLIPS_PAGE_SIZE));

  const res = await fetchWithRetry(url, token);
  if (!res || !res.ok) {
    console.error(`broadcaster_id=${broadcasterId} の直近クリップ取得に失敗: ${res?.status}`);
    return [];
  }
  const data = await res.json();
  return data.data as TwitchClip[];
}

async function fetchGameNames(token: string, gameIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(gameIds)].filter(Boolean);
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const url = new URL("https://api.twitch.tv/helix/games");
    chunk.forEach((id) => url.searchParams.append("id", id));

    const res = await fetchWithRetry(url, token);
    if (!res || !res.ok) continue;
    const data = await res.json();
    for (const g of data.data as { id: string; name: string }[]) {
      map.set(g.id, g.name);
    }
  }
  return map;
}

async function main() {
  const token = await getAppAccessToken();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const staleBefore = new Date(Date.now() - BROADCASTER_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const activeBroadcasters = await fetchAllRows(supabase, "tracked_broadcasters", (q) =>
    q.select("broadcaster_id").gte("last_seen_at", staleBefore),
  );
  if (activeBroadcasters === null) {
    console.error("tracked_broadcastersの取得に失敗しました");
    Deno.exit(1);
  }
  if (activeBroadcasters.length === 0) {
    console.log("追跡中の配信者がいません。終了します。");
    return;
  }

  const broadcasterIds = activeBroadcasters.map((b) => b.broadcaster_id as string);
  const liveBroadcasterIds = await fetchLiveBroadcasterIds(token, broadcasterIds);
  console.log(`追跡中の配信者${broadcasterIds.length}人中、いまライブ中: ${liveBroadcasterIds.length}人`);

  if (liveBroadcasterIds.length === 0) {
    console.log("いまライブ中の追跡配信者がいないため、クリップ取得はスキップします。");
    return;
  }

  // ライブ中と確認できた配信者はlast_seen_atを更新しておく。カテゴリ横断の日次discoveryだけに
  // 頼ると、対象ゲームカテゴリにも日本語配信人気上位にも入らない配信者はいずれ
  // BROADCASTER_STALE_DAYSを超えて「追跡対象外」になってしまうため、ここでの実観測でも延命する。
  const { error: touchErr } = await supabase
    .from("tracked_broadcasters")
    .update({ last_seen_at: new Date().toISOString() })
    .in("broadcaster_id", liveBroadcasterIds);
  if (touchErr) console.error("tracked_broadcastersのlast_seen_at更新に失敗:", touchErr.message);

  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - CLIP_LOOKBACK_MINUTES * 60 * 1000);

  const allClips: TwitchClip[] = [];
  for (const broadcasterId of liveBroadcasterIds) {
    const clips = await fetchRecentClipsForBroadcaster(
      token,
      broadcasterId,
      startedAt.toISOString(),
      endedAt.toISOString(),
    );
    allClips.push(...clips);
  }

  const uniqueClips = [...new Map(allClips.map((c) => [c.id, c])).values()];
  console.log(`ライブ中配信者から見つかった直近クリップ数: ${uniqueClips.length}`);

  if (uniqueClips.length === 0) {
    console.log("新しいクリップはありませんでした。");
    return;
  }

  const gameNames = await fetchGameNames(token, uniqueClips.map((c) => c.game_id));

  const rows = uniqueClips.map((clip) => ({
    id: clip.id,
    title: clip.title,
    streamer: clip.broadcaster_name,
    game: gameNames.get(clip.game_id) ?? "不明",
    view_count: clip.view_count,
    thumbnail_url: clip.thumbnail_url,
    twitch_created_at: clip.created_at,
    creator_id: clip.creator_id || null,
    creator_name: clip.creator_name || null,
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from("clips").upsert(chunk, { onConflict: "id" });
    if (error) console.error("clipsのupsertに失敗:", error.message);
  }

  console.log(`クリップ${rows.length}件を反映しました。`);
}

main().catch((err) => {
  console.error("ライブクリップ同期の実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
