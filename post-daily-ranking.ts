// post-daily-ranking.ts
//
// 前日（JST 0:00〜24:00）に一番視聴されたクリップを「問いかけ型」の文面でXへ自動投稿する
// 日次バッチ（2026-09-03追加、「訪問者数を増やしたい」という相談への対応）。
// クリップ個別ページには動的OGP（api/og/clip/[id].js）が効くため、リンクを貼るだけで
// サムネイル付きのカードがXのタイムライン上に表示される。
//
// 実行例: deno run --allow-net --allow-env post-daily-ranking.ts
//
// 必要な環境変数:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   X_API_KEY             X Developer PortalのApp設定「Keys and tokens」から取得
//   X_API_KEY_SECRET
//   X_ACCESS_TOKEN        Appの権限を「Read and Write」にしてから発行すること
//   X_ACCESS_TOKEN_SECRET
//
// X API v2のPOST /2/tweetsはOAuth 1.0a（ユーザーコンテキスト）認証が必要。
// 外部ライブラリに頼らず、Web Crypto API（HMAC-SHA1）で署名を自前計算する
// （このプロジェクトの「スクリプトは自己完結させる」方針を踏襲）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const X_API_KEY = Deno.env.get("X_API_KEY")!;
const X_API_KEY_SECRET = Deno.env.get("X_API_KEY_SECRET")!;
const X_ACCESS_TOKEN = Deno.env.get("X_ACCESS_TOKEN")!;
const X_ACCESS_TOKEN_SECRET = Deno.env.get("X_ACCESS_TOKEN_SECRET")!;

const SITE_ORIGIN = "https://kurisure.jp";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function formatViews(n: number): string {
  return new Intl.NumberFormat("ja-JP").format(n);
}

// Xの投稿は280文字（日本語は1字2カウント）が上限。クリップタイトルはユーザー投稿の
// Twitch側の値でTwitch上は最大100文字程度あり得るため、長いタイトルでも安全に収まるよう
// 保守的に切り詰める（他の固定文言込みで余裕を持たせるため50文字を上限にした）。
const MAX_TITLE_CHARS = 50;
function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS)}…` : title;
}

/** JSTでの「前日 0:00〜24:00」をUTCのISO文字列範囲に変換する */
function yesterdayJstRangeUtc(now: Date): { start: string; end: string; dateStr: string } {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const jstYesterdayStart = new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() - 1, 0, 0, 0),
  );
  const jstYesterdayEnd = new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), 0, 0, 0),
  );
  // jstYesterdayStart/Endは「JST時刻としての値」をDateのUTCフィールドにそのまま詰めているだけの
  // 仮の値なので、実際のUTC時刻に変換するにはJST_OFFSET_MS分を引く。dateStr（'yyyy-mm-dd'）は
  // このUTC変換前のjstYesterdayStartが持つUTCフィールド＝JSTの日付そのものから直接作る
  // （UTC変換後の値から逆算すると、ちょうど日付の境界＝JST 0:00と一致してしまい
  // 「前日」ではなく「当日」の日付を指してしまう、実際にテストで踏んだ off-by-one）。
  const startUtc = new Date(jstYesterdayStart.getTime() - JST_OFFSET_MS);
  const endUtc = new Date(jstYesterdayEnd.getTime() - JST_OFFSET_MS);
  const dateStr = jstYesterdayStart.toISOString().slice(0, 10);
  return { start: startUtc.toISOString(), end: endUtc.toISOString(), dateStr };
}

// ============================================================
// OAuth 1.0a（HMAC-SHA1）署名
// ============================================================

/** RFC 3986準拠のパーセントエンコード。encodeURIComponentは!*'()をエンコードしないため追加処理する */
function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** OAuth 1.0aのAuthorizationヘッダーを組み立てる（POST /2/tweetsのJSON bodyはこの署名対象に含めない、OAuth1仕様上フォームエンコードのbody/クエリのみが対象のため） */
async function buildOAuthHeader(method: string, url: string): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join("&");

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(sortedParams)].join("&");
  const signingKey = `${percentEncode(X_API_KEY_SECRET)}&${percentEncode(X_ACCESS_TOKEN_SECRET)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerStr = Object.entries(headerParams)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerStr}`;
}

async function postTweet(text: string): Promise<string> {
  const url = "https://api.twitter.com/2/tweets";
  const authHeader = await buildOAuthHeader("POST", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`X APIへの投稿に失敗しました（${res.status}）: ${JSON.stringify(data)}`);
  }
  return data.data.id as string;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { start, end, dateStr } = yesterdayJstRangeUtc(new Date());

  // 二重投稿防止（pg_cronのwebhookが何らかの理由で重複しても同じ日に2回投稿しない）
  const { data: existing } = await supabase
    .from("daily_ranking_posts")
    .select("posted_date")
    .eq("posted_date", dateStr)
    .maybeSingle();
  if (existing) {
    console.log(`${dateStr}分はすでに投稿済みのためスキップします。`);
    return;
  }

  const { data: topClips, error } = await supabase
    .from("clips")
    .select("id, title, streamer, view_count")
    .neq("id", "__general_thread__")
    .gte("twitch_created_at", start)
    .lt("twitch_created_at", end)
    .order("view_count", { ascending: false })
    .limit(1);

  if (error) {
    console.error("前日のランキング取得に失敗しました:", error.message);
    Deno.exit(1);
  }
  const top = topClips?.[0];
  if (!top) {
    console.log(`${dateStr}分のクリップが見つからなかったため、投稿をスキップします。`);
    return;
  }

  const text = [
    `昨日のTwitchクリップ、一番見られたのは誰のクリップだったと思う？`,
    ``,
    `正解は…${top.streamer}さん「${truncateTitle(top.title)}」（${formatViews(top.view_count)}回視聴）`,
    ``,
    `続きのランキングはこちら👇`,
    `${SITE_ORIGIN}/clips/${top.id}`,
  ].join("\n");

  console.log("投稿内容:\n" + text);

  const tweetId = await postTweet(text);
  console.log(`投稿しました（tweet id: ${tweetId}）`);

  const { error: insertErr } = await supabase
    .from("daily_ranking_posts")
    .insert({ posted_date: dateStr, clip_id: top.id, tweet_id: tweetId });
  if (insertErr) console.error("daily_ranking_postsへの記録に失敗:", insertErr.message);
}

main().catch((err) => {
  console.error("日次ランキング投稿の実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
