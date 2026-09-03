// post-daily-ranking.ts
//
// 毎朝JST 9:00にXへ自動投稿する日次バッチ（2026-09-03追加、「訪問者数を増やしたい」という
// 相談への対応）。「日本唯一の掲示板機能があるTwitchクリップサイト」「クリップ職人の紹介」
// 「お気に入りで自分だけのクリップコレクションが作れる」の3点を宣伝したいという要望を受け、
// JSTの曜日でテーマをローテーションする（同じ形式の投稿ばかりだと飽きられるのを避ける狙い）。
//   月〜金: 前日（JST 0:00〜24:00）に一番視聴されたクリップを「問いかけ型」で紹介
//   土: 直近7日間のクリップ職人ランキング1位を紹介
//   日: お気に入り（マイクリップコレクション）機能の紹介
// クリップ/クリップ職人の個別ページには動的OGP（api/og/*.js）が効くため、リンクを貼るだけで
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

// Xの投稿は280文字（日本語は1字2カウント）が上限。クリップタイトル・配信者名・クリップ職人名は
// いずれもユーザー/Twitch側の値（Twitchのログイン名は最大25文字、クリップタイトルは
// 100文字程度あり得る）で、3つとも長い最悪ケースを想定して安全な上限を設けている
// （配信者名15文字＋クリップ職人名15文字＋タイトル15文字の組み合わせで試算し、重み274/280に収まる
// ことを確認済み。1つの上限だけ緩めると簡単に超過するため、3つセットで管理すること）。
const MAX_TITLE_CHARS = 15;
const MAX_NAME_CHARS = 15;
function truncateTo(str: string, maxChars: number): string {
  return str.length > maxChars ? `${str.slice(0, maxChars)}…` : str;
}
function truncateTitle(title: string): string {
  return truncateTo(title, MAX_TITLE_CHARS);
}

/** nowをJSTの壁時計時刻としてUTCフィールドに詰め直したDate（年月日・曜日の算出専用、実時刻としては使わない） */
function asJstFields(now: Date): Date {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

/** JSTでの「前日 0:00〜24:00」をUTCのISO文字列範囲に変換する */
function yesterdayJstRangeUtc(now: Date): { start: string; end: string; dateStr: string } {
  const jstNow = asJstFields(now);
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

/** JSTでの「今日」の日付文字列（yyyy-mm-dd）。二重投稿防止の記録キーに使う */
function todayJstDateString(now: Date): string {
  return asJstFields(now).toISOString().slice(0, 10);
}

/** JSTでの曜日（0=日,1=月,...,6=土） */
function jstWeekday(now: Date): number {
  return asJstFields(now).getUTCDay();
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

type PostType = "ranking" | "clipper_spotlight" | "feature_intro";

const BOARD_PITCH = "コメントもできるTwitchクリップの掲示板「クリスレ」";

async function buildRankingPost(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ text: string; clipId: string | null } | null> {
  const { start, end, dateStr } = yesterdayJstRangeUtc(new Date());
  const { data: topClips, error } = await supabase
    .from("clips")
    .select("id, title, streamer, view_count, creator_id, creator_name")
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
    return null;
  }

  // クリップ職人の機能も毎日の投稿で目に触れるよう、クリップの作者（判明している場合）を
  // クレジット行として添える。Twitch側で作者が特定できなかった古いクリップはcreator_idが
  // '__unknown__'になっている（詳細はCLAUDE.md「クリップ職人ランキング」節）ため、その場合は省略する。
  const hasCreator = top.creator_id && top.creator_id !== "__unknown__" && top.creator_name;
  const creatorLine = hasCreator ? [`✂️ ${truncateTo(top.creator_name, MAX_NAME_CHARS)}さんが作成`] : [];

  const text = [
    `昨日のTwitchクリップ、一番見られたのは誰のクリップだったと思う？`,
    ``,
    `正解は…${truncateTo(top.streamer, MAX_NAME_CHARS)}さん「${truncateTitle(top.title)}」（${formatViews(top.view_count)}回視聴）`,
    ...creatorLine,
    ``,
    `${BOARD_PITCH}で続きをチェック👇`,
    `${SITE_ORIGIN}/clips/${top.id}`,
  ].join("\n");
  return { text, clipId: top.id };
}

async function buildClipperSpotlightPost(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ text: string; clipId: null } | null> {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = now.toISOString();

  const { data, error } = await supabase.rpc("get_top_clippers_by_period", {
    period_start: periodStart,
    period_end: periodEnd,
    clipper_limit: 1,
    clipper_offset: 0,
  });
  if (error) {
    console.error("週間クリップ職人ランキングの取得に失敗しました:", error.message);
    Deno.exit(1);
  }
  const top = data?.[0];
  if (!top) {
    console.log("直近7日間のクリップ職人ランキングが空だったため、投稿をスキップします。");
    return null;
  }

  const text = [
    `今週のクリップ職人ランキング1位は「${top.creator_name}」さん🎬`,
    `直近7日間で合計${formatViews(top.total_views)}回視聴のクリップを生み出しています`,
    ``,
    `${BOARD_PITCH}でクリップ職人ランキングをチェック👇`,
    `${SITE_ORIGIN}/clippers/${top.creator_id}`,
  ].join("\n");
  return { text, clipId: null };
}

function buildFeatureIntroPost(): { text: string; clipId: null } {
  const text = [
    `お気に入りのクリップ、ちゃんと保存できてますか？`,
    ``,
    `${BOARD_PITCH}なら、気になったクリップに⭐を付けるだけで自分だけのクリップコレクションが作れます`,
    ``,
    `${SITE_ORIGIN}/favorites`,
  ].join("\n");
  return { text, clipId: null };
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const dateStr = todayJstDateString(now);
  const weekday = jstWeekday(now); // 0=日 1=月 ... 6=土
  const postType: PostType = weekday === 6 ? "clipper_spotlight" : weekday === 0 ? "feature_intro" : "ranking";

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

  const built =
    postType === "ranking"
      ? await buildRankingPost(supabase)
      : postType === "clipper_spotlight"
        ? await buildClipperSpotlightPost(supabase)
        : buildFeatureIntroPost();
  if (!built) return;

  console.log(`投稿タイプ: ${postType}\n投稿内容:\n${built.text}`);

  const tweetId = await postTweet(built.text);
  console.log(`投稿しました（tweet id: ${tweetId}）`);

  const { error: insertErr } = await supabase
    .from("daily_ranking_posts")
    .insert({ posted_date: dateStr, clip_id: built.clipId, tweet_id: tweetId, post_type: postType });
  if (insertErr) console.error("daily_ranking_postsへの記録に失敗:", insertErr.message);
}

main().catch((err) => {
  console.error("日次ランキング投稿の実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
