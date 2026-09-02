// backfill-clip-creators.ts
//
// 既存クリップ（creator_id未取得のもの）に対し、Twitch Helix Get Clips API を
// id指定（最大100件/回）で呼び出し、creator_id/creator_name（クリップを作った視聴者）を
// 遡及取得する一回限りのバックフィルスクリプト。クリッパーランキング機能の導入時に、
// 導入前から存在する既存クリップ分を埋めるために使う。
//
// Twitch側で既に見つからない（削除済み・API取得不能）クリップは creator_id/creator_name に
// UNKNOWN_SENTINEL を入れて、次回以降の再取得対象（creator_id is null）から除外する。
//
// 実行例: deno run --allow-net --allow-env backfill-clip-creators.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_SIZE = 100; // Get Clips (id指定) / upsertとも1回あたり最大100件
const UNKNOWN_SENTINEL = "__unknown__"; // Twitch側で取得できなかったクリップの目印
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

interface TwitchClipCreator {
  id: string;
  creator_id: string;
  creator_name: string;
}

async function fetchClipsByIds(token: string, ids: string[]): Promise<TwitchClipCreator[]> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  ids.forEach((id) => url.searchParams.append("id", id));

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
      console.log(`レート制限、待機してリトライします（${attempt + 1}回目）`);
      await waitForRateLimitReset(res);
    }
  }
  if (!res || !res.ok) {
    console.error(`クリップ取得に失敗: ${res?.status}`);
    return [];
  }
  const data = await res.json();
  return data.data as TwitchClipCreator[];
}

async function main() {
  const token = await getAppAccessToken();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let totalProcessed = 0;
  let totalFound = 0;
  let batchNum = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from("clips")
      .select("id")
      .is("creator_id", null)
      .limit(BATCH_SIZE);

    if (error) {
      console.error("対象クリップの取得に失敗しました:", error.message);
      break;
    }
    if (!batch || batch.length === 0) break;

    const ids = batch.map((c) => c.id as string);
    const results = await fetchClipsByIds(token, ids);
    const found = new Map(results.map((c) => [c.id, c]));

    // creator_id/creator_nameだけを更新する（upsertはtitle等のNOT NULL列を要求してしまい使えないため、
    // bulk_update_clip_creators RPC経由でUPDATE ... FROM jsonb_to_recordsetする）
    const updateRows = ids.map((id) => {
      const clip = found.get(id);
      return {
        id,
        creator_id: clip?.creator_id || UNKNOWN_SENTINEL,
        creator_name: clip?.creator_name || UNKNOWN_SENTINEL,
      };
    });
    const { error: upsertErr } = await supabase.rpc("bulk_update_clip_creators", { updates: updateRows });
    if (upsertErr) {
      console.error("clipsの更新に失敗しました:", upsertErr.message);
      break;
    }

    totalProcessed += ids.length;
    totalFound += found.size;
    batchNum++;
    if (batchNum % 20 === 0) {
      console.log(`処理済み: ${totalProcessed}件（うちTwitch側で発見: ${totalFound}件）`);
    }
  }

  console.log(`バックフィルが完了しました。処理済み合計: ${totalProcessed}件（うち発見: ${totalFound}件）`);

  // クリッパーのプロフィール（アイコン等）はtracked_clippersに別途蓄積する
  const { data: clipperIdsData, error: clipperIdsErr } = await supabase
    .from("clips")
    .select("creator_id, creator_name")
    .not("creator_id", "is", null)
    .neq("creator_id", UNKNOWN_SENTINEL);

  if (clipperIdsErr) {
    console.error("クリッパー一覧の取得に失敗しました:", clipperIdsErr.message);
  } else if (clipperIdsData) {
    const clippers = new Map<string, string>();
    for (const row of clipperIdsData as { creator_id: string; creator_name: string }[]) {
      clippers.set(row.creator_id, row.creator_name);
    }
    console.log(`ユニークなクリッパー数: ${clippers.size}`);

    const clipperRows = [...clippers.entries()].map(([creator_id, creator_name]) => ({
      creator_id,
      creator_name,
      last_seen_at: new Date().toISOString(),
    }));
    for (let i = 0; i < clipperRows.length; i += BATCH_SIZE) {
      const chunk = clipperRows.slice(i, i + BATCH_SIZE);
      const { error: tcErr } = await supabase.from("tracked_clippers").upsert(chunk, { onConflict: "creator_id" });
      if (tcErr) console.error("tracked_clippersのupsertに失敗:", tcErr.message);
    }
    console.log("tracked_clippersへの登録が完了しました。");
  }

  const { error: refreshErr } = await supabase.rpc("refresh_ranking_views");
  if (refreshErr) console.error("ランキング集計ビューの更新に失敗:", refreshErr.message);
  else console.log("ランキング集計ビューを更新しました。");
}

main().catch((err) => {
  console.error("バックフィル実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
