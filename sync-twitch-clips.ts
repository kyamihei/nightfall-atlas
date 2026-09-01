// scripts/sync-twitch-clips.ts
//
// Twitch Helix APIから人気クリップを収集し、Supabaseのclipsテーブルへupsertする
// 日次バッチ想定のスクリプト。cronやSupabase Scheduled Functionsから定期実行する。
//
// 配信者は手動リストで管理せず、「対象ゲームカテゴリ × 日本語配信」で
// 自動的に見つけて tracked_broadcasters に蓄積し、その配信者たちのクリップを集める方式。
// （tw-clipのような個人運営サイトが開設時点で多数の配信者を持てているのは、
//   1人ずつ手動登録ではなく、この種のカテゴリ横断の自動収集だと考えられるため）
//
// 実行例: deno run --allow-net --allow-env scripts/sync-twitch-clips.ts
//
// 必要な環境変数:
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   TARGET_GAME_IDS   カンマ区切りのTwitchゲームID一覧（収集対象のカテゴリ。例: Rust, VALORANT等）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TARGET_GAME_IDS = (Deno.env.get("TARGET_GAME_IDS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const STREAMS_PER_GAME = 100; // 1カテゴリあたり発見する配信の上限（Helixの最大値）
const TOP_JA_STREAMS_LIMIT = 400; // ゲームカテゴリを問わない「日本語配信 視聴者数上位」の発見件数上限（Helix1ページ最大100のためページネーションで積み上げる）
const HELIX_STREAMS_PAGE_SIZE = 100; // Helix /streams の1ページあたり最大件数
const BROADCASTER_STALE_DAYS = 30; // これより長く見つからない配信者は同期対象から外す

// バックフィル（新規配信者の過去分クリップの遡及取得）関連の設定。
// Helixの/clipsはstarted_at/ended_atを省略すると直近2週間分しか返さないため、
// 「全期間」の蓄積をするには明示的に広い期間を指定して取得する必要がある。
// 件数上限は設けず、配信者の投稿履歴を最後まで（カーソルが尽きるまで）取得する。
const BACKFILL_START_DATE = new Date("2016-01-01T00:00:00Z"); // Twitchのクリップ機能の開始時期に合わせた起点
const BACKFILL_BATCH_SIZE = 200; // 1回の実行でバックフィルする配信者数の上限（実行頻度は変えず、1回あたりの処理人数で調整する）
const HELIX_CLIPS_PAGE_SIZE = 100; // Helix /clips の1ページあたり最大件数
const HELIX_USERS_PAGE_SIZE = 100; // Helix /users の1リクエストあたり最大id数
const AVATAR_BACKFILL_BATCH_SIZE = 500; // アイコン未取得の既存配信者を1回の実行で更新する上限（Get Usersは軽いのでまとめて処理する）
const BACKFILL_MAX_PAGES = 500; // 暴走防止用の技術的な安全上限（50,000件相当。通常の配信者では到達しない想定）
const RATE_LIMIT_RETRY_MAX = 3; // 429応答時のリトライ回数
const RATE_LIMIT_DEFAULT_WAIT_MS = 10_000; // Ratelimit-Resetヘッダが無い場合のデフォルト待機時間

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429応答時にRatelimit-Resetヘッダを見て、リセットまで待つ（無ければデフォルト秒数待つ） */
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

interface TwitchClip {
  id: string;
  broadcaster_id: string;
  broadcaster_name: string;
  title: string;
  view_count: number;
  thumbnail_url: string;
  game_id: string;
  created_at: string; // クリップが実際に作成された日時（期間フィルタに使う）
}

interface TwitchStream {
  user_id: string;
  user_name: string;
  game_id: string;
  language: string;
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

/** 対象ゲームを日本語配信中の配信者を発見する（＝手動リストの代わり） */
async function discoverJapaneseBroadcasters(token: string, gameId: string): Promise<TwitchStream[]> {
  const url = new URL("https://api.twitch.tv/helix/streams");
  url.searchParams.set("game_id", gameId);
  url.searchParams.set("language", "ja");
  url.searchParams.set("first", String(STREAMS_PER_GAME));

  const res = await fetch(url, {
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    console.error(`game_id=${gameId} の配信者発見に失敗: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.data as TwitchStream[];
}

/**
 * ゲームカテゴリを問わず、日本語配信の視聴者数上位を発見する。
 * Helixの get streams はデフォルトで視聴者数降順に返るため、
 * game_id を指定せず language=ja だけで問い合わせると「今ライブ中の日本語配信 人気順」が取れる。
 * 釈迦・加藤純一のように特定ゲームに縛られない大手配信者は、カテゴリ別発見だけでは
 * 拾えないため、この全体人気順の発見を別途行い、カテゴリ別発見の結果とマージする。
 */
async function discoverTopJapaneseBroadcasters(token: string): Promise<TwitchStream[]> {
  const results: TwitchStream[] = [];
  let cursor: string | undefined;

  while (results.length < TOP_JA_STREAMS_LIMIT) {
    const url = new URL("https://api.twitch.tv/helix/streams");
    url.searchParams.set("language", "ja");
    url.searchParams.set("first", String(HELIX_STREAMS_PAGE_SIZE));
    if (cursor) url.searchParams.set("after", cursor);

    const res = await fetch(url, {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      console.error(`日本語配信 人気順の発見に失敗: ${res.status}`);
      break;
    }
    const data = await res.json();
    const page = data.data as TwitchStream[];
    results.push(...page);

    cursor = data.pagination?.cursor;
    if (!cursor || page.length === 0) break; // これ以上ページが無い（配信数が上限に満たない）
  }

  return results.slice(0, TOP_JA_STREAMS_LIMIT);
}

async function fetchClipsForBroadcaster(
  token: string,
  broadcasterId: string,
  startedAt: string,
  endedAt: string,
): Promise<TwitchClip[]> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("broadcaster_id", broadcasterId);
  url.searchParams.set("started_at", startedAt);
  url.searchParams.set("ended_at", endedAt);
  url.searchParams.set("first", "20");

  const res = await fetch(url, {
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    console.error(`broadcaster_id=${broadcasterId} のクリップ取得に失敗: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.data as TwitchClip[];
}

/**
 * 新規配信者の過去分クリップを、投稿履歴の最後まで遡及取得する（バックフィル、件数上限なし）。
 * started_at/ended_atを明示的に広く（2016年〜現在）指定し、カーソルが尽きるまでページネーションする。
 * 429（レート制限）が返ってきた場合はRatelimit-Resetまで待って同じページをリトライする。
 * 途中で回復不能なエラーが出た場合はcompleted=falseを返し、呼び出し側でbackfilled_atを
 * 記録しない（＝完了扱いにしない）ことで、次回実行時に続きから再試行できるようにする。
 */
async function fetchBackfillClipsForBroadcaster(
  token: string,
  broadcasterId: string,
): Promise<{ clips: TwitchClip[]; completed: boolean }> {
  const endedAt = new Date();
  const results: TwitchClip[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    const url = new URL("https://api.twitch.tv/helix/clips");
    url.searchParams.set("broadcaster_id", broadcasterId);
    url.searchParams.set("started_at", BACKFILL_START_DATE.toISOString());
    url.searchParams.set("ended_at", endedAt.toISOString());
    url.searchParams.set("first", String(HELIX_CLIPS_PAGE_SIZE));
    if (cursor) url.searchParams.set("after", cursor);

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
        console.log(`broadcaster_id=${broadcasterId} レート制限、待機してリトライします（${attempt + 1}回目）`);
        await waitForRateLimitReset(res);
      }
    }

    if (!res || !res.ok) {
      console.error(`broadcaster_id=${broadcasterId} のバックフィル取得に失敗: ${res?.status}`);
      return { clips: results, completed: false };
    }

    const data = await res.json();
    const pageClips = data.data as TwitchClip[];
    results.push(...pageClips);

    cursor = data.pagination?.cursor;
    if (!cursor || pageClips.length === 0) {
      return { clips: results, completed: true };
    }
  }

  console.error(`broadcaster_id=${broadcasterId} は安全上限(${BACKFILL_MAX_PAGES}ページ)に到達したため打ち切りました`);
  return { clips: results, completed: false };
}

/** Twitchのプロフィール画像URLをuser_idからまとめて取得する（Get Usersは1回最大100件） */
async function fetchProfileImages(token: string, userIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;

  for (let i = 0; i < uniqueIds.length; i += HELIX_USERS_PAGE_SIZE) {
    const chunk = uniqueIds.slice(i, i + HELIX_USERS_PAGE_SIZE);
    const url = new URL("https://api.twitch.tv/helix/users");
    chunk.forEach((id) => url.searchParams.append("id", id));

    const res = await fetch(url, {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      console.error(`プロフィール画像の取得に失敗しました（${chunk.length}件分）: ${res.status}`);
      continue;
    }
    const data = await res.json();
    for (const u of data.data as { id: string; profile_image_url: string }[]) {
      map.set(u.id, u.profile_image_url);
    }
  }
  return map;
}

async function fetchGameNames(token: string, gameIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(gameIds)].filter(Boolean);
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const url = new URL("https://api.twitch.tv/helix/games");
    chunk.forEach((id) => url.searchParams.append("id", id));

    const res = await fetch(url, {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const g of data.data as { id: string; name: string }[]) {
      map.set(g.id, g.name);
    }
  }
  return map;
}

async function main() {
  if (TARGET_GAME_IDS.length === 0) {
    console.error("TARGET_GAME_IDSが未設定です。収集対象のゲームカテゴリIDをカンマ区切りで指定してください。");
    Deno.exit(1);
  }

  const token = await getAppAccessToken();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. 配信者の発見。二種類の発見結果をマージしてtracked_broadcastersに蓄積する。
  //    a. 対象ゲームカテゴリ × 日本語配信（ニッチなゲームの配信者を拾う）
  //    b. ゲームカテゴリを問わない日本語配信の視聴者数上位（釈迦・加藤純一のような大手配信者を拾う）
  const discovered = new Map<string, string>(); // id -> name
  for (const gameId of TARGET_GAME_IDS) {
    const streams = await discoverJapaneseBroadcasters(token, gameId);
    for (const s of streams) {
      discovered.set(s.user_id, s.user_name);
    }
  }
  const topJaStreams = await discoverTopJapaneseBroadcasters(token);
  for (const s of topJaStreams) {
    discovered.set(s.user_id, s.user_name);
  }
  console.log(`新たに発見した配信者数: ${discovered.size}（うち人気順発見: ${topJaStreams.length}）`);

  if (discovered.size > 0) {
    const avatars = await fetchProfileImages(token, [...discovered.keys()]);
    const rows = [...discovered.entries()].map(([broadcaster_id, broadcaster_name]) => ({
      broadcaster_id,
      broadcaster_name,
      last_seen_at: new Date().toISOString(),
      profile_image_url: avatars.get(broadcaster_id) ?? null,
    }));
    const { error } = await supabase.from("tracked_broadcasters").upsert(rows, {
      onConflict: "broadcaster_id",
    });
    if (error) console.error("tracked_broadcastersのupsertに失敗:", error.message);
  }

  // 1b. 既存配信者のうち、まだアイコン画像URLを取得していない人をまとめて更新する
  const { data: missingAvatarBroadcasters, error: avatarFetchErr } = await supabase
    .from("tracked_broadcasters")
    .select("broadcaster_id")
    .is("profile_image_url", null)
    .limit(AVATAR_BACKFILL_BATCH_SIZE);

  if (avatarFetchErr) {
    console.error("アイコン未取得配信者の取得に失敗しました:", avatarFetchErr.message);
  } else if (missingAvatarBroadcasters && missingAvatarBroadcasters.length > 0) {
    const ids = missingAvatarBroadcasters.map((b) => b.broadcaster_id);
    const avatars = await fetchProfileImages(token, ids);
    let updated = 0;
    for (const [broadcaster_id, profile_image_url] of avatars) {
      const { error } = await supabase
        .from("tracked_broadcasters")
        .update({ profile_image_url })
        .eq("broadcaster_id", broadcaster_id);
      if (!error) updated++;
    }
    console.log(`アイコン画像URLを${updated}/${ids.length}人分更新しました`);
  }

  // 2. 直近で見つかっている配信者（今回発見分＋過去分のうち一定期間内）のクリップを収集
  const staleBefore = new Date(Date.now() - BROADCASTER_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeBroadcasters, error: fetchErr } = await supabase
    .from("tracked_broadcasters")
    .select("broadcaster_id")
    .gte("last_seen_at", staleBefore);

  if (fetchErr || !activeBroadcasters) {
    console.error("tracked_broadcastersの取得に失敗しました");
    Deno.exit(1);
  }

  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - 24 * 60 * 60 * 1000);

  const allClips: TwitchClip[] = [];
  for (const { broadcaster_id } of activeBroadcasters) {
    const clips = await fetchClipsForBroadcaster(
      token,
      broadcaster_id,
      startedAt.toISOString(),
      endedAt.toISOString(),
    );
    allClips.push(...clips);
  }
  console.log(`収集したクリップ数: ${allClips.length}（対象配信者: ${activeBroadcasters.length}人）`);

  // 3. まだバックフィルしていない配信者の過去分を遡及取得する（1回の実行につきBACKFILL_BATCH_SIZE人まで）
  const { data: backfillTargets, error: backfillFetchErr } = await supabase
    .from("tracked_broadcasters")
    .select("broadcaster_id")
    .gte("last_seen_at", staleBefore)
    .is("backfilled_at", null)
    .limit(BACKFILL_BATCH_SIZE);

  if (backfillFetchErr) {
    console.error("バックフィル対象の取得に失敗しました:", backfillFetchErr.message);
  } else if (backfillTargets && backfillTargets.length > 0) {
    let backfillClipCount = 0;
    let completedCount = 0;
    for (const { broadcaster_id } of backfillTargets) {
      const { clips, completed } = await fetchBackfillClipsForBroadcaster(token, broadcaster_id);
      allClips.push(...clips);
      backfillClipCount += clips.length;

      if (completed) {
        completedCount++;
        const { error: markErr } = await supabase
          .from("tracked_broadcasters")
          .update({ backfilled_at: new Date().toISOString() })
          .eq("broadcaster_id", broadcaster_id);
        if (markErr) console.error(`broadcaster_id=${broadcaster_id} のbackfilled_at更新に失敗:`, markErr.message);
      } else {
        console.log(`broadcaster_id=${broadcaster_id} は未完了のため次回実行時に再試行します`);
      }
    }
    console.log(
      `バックフィル対象: ${backfillTargets.length}人、完了: ${completedCount}人、取得クリップ数: ${backfillClipCount}`,
    );
  } else {
    console.log("バックフィル対象の配信者はいません（全員処理済み）");
  }

  // 通常取得とバックフィルの対象期間が重なる場合があるため、idで重複排除してからupsertする
  // （同一idが1回のバッチ内に複数回あると "ON CONFLICT DO UPDATE" がエラーになるため）
  const uniqueClips = [...new Map(allClips.map((c) => [c.id, c])).values()];

  const gameNames = await fetchGameNames(token, uniqueClips.map((c) => c.game_id));

  const rows = uniqueClips.map((clip) => ({
    id: clip.id,
    title: clip.title,
    streamer: clip.broadcaster_name,
    game: gameNames.get(clip.game_id) ?? "不明",
    view_count: clip.view_count,
    thumbnail_url: clip.thumbnail_url,
    twitch_created_at: clip.created_at,
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from("clips").upsert(chunk, { onConflict: "id" });
    if (error) console.error("clipsのupsertに失敗:", error.message);
  }

  console.log("クリップ同期が完了しました。");
}

main().catch((err) => {
  console.error("バッチ実行中にエラーが発生しました:", err);
  Deno.exit(1);
});

