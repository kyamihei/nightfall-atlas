// refresh-clip-views.ts
//
// 既存クリップのview_countを定期的に再取得し、実際のTwitch上の視聴回数との乖離を解消するスクリプト。
// sync-twitch-clips.tsの通常収集は「作成から24時間以内のクリップ」しか見ないため、
// それより古いクリップのview_countは初回取得時の値のまま更新されず、時間が経つほど
// 実際の値とズレていく。このスクリプトはclips.view_count_synced_at（最後にview_countを
// 同期した時刻）が最も古い＝一番ズレていそうなクリップから順に、1回の実行につき
// 最大 VIEW_SYNC_MAX_CLIPS 件までTwitch Get Clips（id指定、最大100件/回）で再取得する。
//
// 更新後は次のクリップ群が「最も古い」側に繰り上がるため、offsetを使わず同じクエリを
// 繰り返すだけで自然に全クリップを一巡できる（ラウンドロビン）。頻繁（例: 1時間おき）に
// 実行するワークフローを想定しており、1回あたりの件数は環境変数で調整できる。
//
// 実行例: deno run --allow-net --allow-env refresh-clip-views.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_CLIPS_PER_RUN = Number(Deno.env.get("VIEW_SYNC_MAX_CLIPS") ?? "5000");

const BATCH_SIZE = 100; // Get Clips (id指定) / bulk_update_clip_viewsとも1回あたり最大100件
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

interface TwitchClipView {
  id: string;
  view_count: number;
}

async function fetchClipViewsByIds(token: string, ids: string[]): Promise<TwitchClipView[]> {
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
  return data.data as TwitchClipView[];
}

async function main() {
  const token = await getAppAccessToken();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let totalProcessed = 0;
  let totalUpdated = 0;
  let viewDelta = 0; // 更新前後のview_count差分の合計（実際にどれくらいズレていたかの目安）

  while (totalProcessed < MAX_CLIPS_PER_RUN) {
    const take = Math.min(BATCH_SIZE, MAX_CLIPS_PER_RUN - totalProcessed);

    const { data: batch, error } = await supabase
      .from("clips")
      .select("id, view_count")
      .order("view_count_synced_at", { ascending: true, nullsFirst: true })
      .limit(take);

    if (error) {
      console.error("対象クリップの取得に失敗しました:", error.message);
      break;
    }
    if (!batch || batch.length === 0) break;

    const ids = batch.map((c) => c.id as string);
    const prevViews = new Map(batch.map((c) => [c.id as string, c.view_count as number]));
    const results = await fetchClipViewsByIds(token, ids);
    const found = new Map(results.map((c) => [c.id, c.view_count]));

    const updateRows = ids.map((id) => ({
      id,
      view_count: found.has(id) ? found.get(id) : null, // 見つからなければnull（既存値を維持）
    }));
    const { error: updateErr } = await supabase.rpc("bulk_update_clip_views", { updates: updateRows });
    if (updateErr) {
      console.error("view_countの更新に失敗しました:", updateErr.message);
      break;
    }

    for (const id of ids) {
      if (found.has(id)) {
        viewDelta += Math.abs((found.get(id) ?? 0) - (prevViews.get(id) ?? 0));
      }
    }

    totalProcessed += ids.length;
    totalUpdated += found.size;

    // 同じクエリを繰り返すと（バッチ数が要求件数に満たない＝クリップ総数がMAX_CLIPS_PER_RUNより
    // 少ない場合）無限ループになるため、要求件数に満たなければそこで打ち切る
    if (ids.length < take) break;
  }

  console.log(
    `view_countの同期が完了しました。処理済み: ${totalProcessed}件（うちTwitch側で発見: ${totalUpdated}件、視聴回数の差分合計: ${viewDelta}）`,
  );

  const { error: refreshErr } = await supabase.rpc("refresh_ranking_views");
  if (refreshErr) console.error("ランキング集計ビューの更新に失敗:", refreshErr.message);
}

main().catch((err) => {
  console.error("view_count同期の実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
