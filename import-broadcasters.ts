// import-broadcasters.ts
//
// 手動で用意した配信者リスト（Twitchのログイン名を1行に1人ずつ書いたテキストファイル）を
// 一括でtracked_broadcastersに登録するための一回限りのスクリプト。
// 各ログイン名はTwitch Helix APIで実在確認してから登録する（存在しないものはスキップして報告する）。
// 登録後は次回の sync-twitch-clips.ts 実行時に、通常のクリップ収集・バックフィル対象に自動的に含まれる。
//
// 実行例: deno run --allow-net --allow-env --allow-read import-broadcasters.ts broadcasters-manual.txt
//
// リストファイルの書式:
//   - 1行に1つ、Twitchのログイン名（channel URLの twitch.tv/<ここ> の部分）
//   - 空行、および # から始まる行は無視する

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const HELIX_USERS_BATCH_SIZE = 100; // Helix /users の login パラメータは1リクエストにつき最大100件

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
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

function readLoginList(path: string): string[] {
  const text = Deno.readTextFileSync(path);
  return [...new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      // 「1 fps_shaka」のような連番付き行にも対応し、末尾のトークンだけをログイン名として使う
      .map((line) => line.split(/\s+/).pop()!)
      .filter(Boolean)
      .map((login) => login.toLowerCase()),
  )];
}

async function fetchUsersByLogin(token: string, logins: string[]): Promise<TwitchUser[]> {
  const found: TwitchUser[] = [];
  for (let i = 0; i < logins.length; i += HELIX_USERS_BATCH_SIZE) {
    const chunk = logins.slice(i, i + HELIX_USERS_BATCH_SIZE);
    const url = new URL("https://api.twitch.tv/helix/users");
    chunk.forEach((login) => url.searchParams.append("login", login));

    const res = await fetch(url, {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      console.error(`ユーザー確認に失敗しました（${chunk.length}件分）: ${res.status}`);
      continue;
    }
    const data = await res.json();
    found.push(...(data.data as TwitchUser[]));
  }
  return found;
}

async function main() {
  const listPath = Deno.args[0];
  if (!listPath) {
    console.error("使い方: deno run --allow-net --allow-env --allow-read import-broadcasters.ts <リストファイルパス>");
    Deno.exit(1);
  }

  const logins = readLoginList(listPath);
  console.log(`リストから${logins.length}件のログイン名を読み込みました`);
  if (logins.length === 0) {
    console.log("登録対象がありません。終了します。");
    return;
  }

  const token = await getAppAccessToken();
  const users = await fetchUsersByLogin(token, logins);

  const foundLogins = new Set(users.map((u) => u.login));
  const notFound = logins.filter((login) => !foundLogins.has(login));

  console.log(`Twitch上で実在確認できた配信者: ${users.length}人`);
  if (notFound.length > 0) {
    console.log(`見つからなかったログイン名（誤字の可能性、${notFound.length}件）:`);
    for (const login of notFound) console.log(`  - ${login}`);
  }

  if (users.length === 0) {
    console.log("登録できる配信者がいませんでした。");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rows = users.map((u) => ({
    broadcaster_id: u.id,
    broadcaster_name: u.display_name,
    last_seen_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from("tracked_broadcasters").upsert(chunk, { onConflict: "broadcaster_id" });
    if (error) console.error("tracked_broadcastersのupsertに失敗:", error.message);
  }

  console.log(`${users.length}人をtracked_broadcastersに登録しました。次回のsync-twitch-clips.ts実行時にクリップ収集・バックフィル対象に含まれます。`);
}

main().catch((err) => {
  console.error("実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
