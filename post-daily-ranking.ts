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
import { Image } from "jsr:@matmen/imagescript@1.3.1";

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

const TWEET_MAX_WEIGHT = 280;

/**
 * Xの重み付き文字数の簡易近似（半角=1、それ以外（日本語・絵文字等）=2）。実際のtwitter-text
 * アルゴリズムの完全な再現ではないが、URL等を実際より重く見積もる方向にしかズレないため、
 * この関数で予算内に収まっていれば実際に超過することはない（安全側）。
 * クリップ職人ランキング2〜5位のように「何人分載るか」が動的に変わる文面で、都度手計算で
 * 最悪ケースを試算する代わりに実測して安全に切り詰めるために追加した（2026-09-04）。
 */
function tweetWeight(text: string): number {
  let weight = 0;
  for (const ch of text) {
    weight += (ch.codePointAt(0) ?? 0) < 128 ? 1 : 2;
  }
  return weight;
}

const RUNNER_UP_NAME_MAX_CHARS = 10;

/**
 * クリップ職人ランキング2〜5位を「2位 name／3位 name…」の形で並べた1行を作る。
 * budgetWeight（残り使える重み）に収まる人数分だけ左から採用し、収まらない下位の順位は
 * 黙って省略する（0人分になることもある。何位まで載るかがブレるより、桁溢れで投稿自体が
 * 失敗する方が問題なので、あえて可変にしている）。
 */
function buildRunnersUpLine(
  runnersUp: { creator_name: string }[],
  budgetWeight: number,
): string {
  let line = "";
  for (let i = 0; i < runnersUp.length; i++) {
    const entry = `${i + 2}位 ${truncateTo(runnersUp[i].creator_name, RUNNER_UP_NAME_MAX_CHARS)}`;
    const candidate = line ? `${line}／${entry}` : entry;
    if (tweetWeight(candidate) > budgetWeight) break;
    line = candidate;
  }
  return line;
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

/**
 * OAuth 1.0aのAuthorizationヘッダーを組み立てる。
 * JSON body・multipart bodyはOAuth1.0a仕様上署名対象に含めない（フォームエンコードのbody・
 * クエリパラメータのみが対象）ため、このプロジェクトの各POST呼び出しは基本JSON bodyにしている。
 * GETのクエリパラメータ（メディアアップロードのSTATUS確認で使用）のように署名に含める必要が
 * ある場合だけextraParamsに渡す（2026-09-04、クリップ職人ランキング画像添付機能の追加で拡張）。
 */
async function buildOAuthHeader(
  method: string,
  url: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const sortedParams = Object.entries({ ...oauthParams, ...extraParams })
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

async function postTweet(text: string, mediaId?: string): Promise<string> {
  const url = "https://api.twitter.com/2/tweets";
  const authHeader = await buildOAuthHeader("POST", url);

  const body: Record<string, unknown> = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`X APIへの投稿に失敗しました（${res.status}）: ${JSON.stringify(data)}`);
  }
  return data.data.id as string;
}

// ============================================================
// Xメディアアップロード（v2チャンクドアップロード）
// ============================================================
//
// クリップ職人ランキングの投稿にサイトの雰囲気が伝わる画像を添付したいという要望への対応
// （2026-09-04）。X API v1.1の単純アップロード（POST media/upload.json）は現在の公式ドキュメント
// から姿を消しており、代わりにv2のchunked upload（initialize→append→finalize、必要なら
// STATUSポーリング）が案内されている（2026-09-04調査時点、docs.x.com）。OAuth 1.0aは
// これらのエンドポイントでも動作する（devcommunity.x.comで確認）。
// appendステップはmultipart/form-dataとJSON+base64のどちらもサポートされているが、
// OAuth1.0a×multipartの署名まわりは実装依存の不具合報告が散見される（"could not authenticate
// you"等）ため、あえてJSON+base64を使う。JSON bodyを署名対象に含めない、というこのファイルの
// 他のPOST呼び出し（/2/tweets等）と全く同じ仕組みで安全に扱えるため。
// 画像はサイズが小さい（数百KB程度、X側の上限5MBに対して十分小さい）ため、チャンクは
// 1回（segment_index=0）のみで足りる設計にしている。

/** 大きめのUint8Arrayをbtoaに直接spreadすると引数展開でスタック上限に達しうるため、小分けにする */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function initializeMediaUpload(totalBytes: number): Promise<string> {
  const url = "https://api.x.com/2/media/upload/initialize";
  const authHeader = await buildOAuthHeader("POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "image/png", media_category: "tweet_image", total_bytes: totalBytes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`メディアアップロード初期化に失敗しました（${res.status}）: ${JSON.stringify(data)}`);
  return data.data.id as string;
}

async function appendMediaChunk(mediaId: string, bytes: Uint8Array): Promise<void> {
  const url = `https://api.x.com/2/media/upload/${mediaId}/append`;
  const authHeader = await buildOAuthHeader("POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ media: bytesToBase64(bytes), segment_index: 0 }),
  });
  if (!res.ok) {
    const data = await res.text();
    throw new Error(`メディアアップロード（append）に失敗しました（${res.status}）: ${data}`);
  }
}

interface MediaProcessingInfo {
  state: string;
  check_after_secs?: number;
}

/** GET /2/media/upload?command=STATUS&media_id=...（クエリパラメータを署名に含める必要がある唯一の呼び出し） */
async function getMediaUploadStatus(mediaId: string): Promise<MediaProcessingInfo | undefined> {
  const baseUrl = "https://api.x.com/2/media/upload";
  const queryParams = { command: "STATUS", media_id: mediaId };
  const authHeader = await buildOAuthHeader("GET", baseUrl, queryParams);
  const res = await fetch(`${baseUrl}?${new URLSearchParams(queryParams).toString()}`, {
    headers: { Authorization: authHeader },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`メディア処理状況の確認に失敗しました（${res.status}）: ${JSON.stringify(data)}`);
  return data.data?.processing_info as MediaProcessingInfo | undefined;
}

async function finalizeMediaUpload(mediaId: string): Promise<void> {
  const url = `https://api.x.com/2/media/upload/${mediaId}/finalize`;
  const authHeader = await buildOAuthHeader("POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`メディアアップロード確定に失敗しました（${res.status}）: ${JSON.stringify(data)}`);

  // 画像は基本的に同期処理で完了するはずだが、仕様上processing_infoが返ることがあるため
  // 念のため数回だけSTATUSをポーリングする（最大5回、check_after_secsに従って待つ）
  let processingInfo = data.data?.processing_info as MediaProcessingInfo | undefined;
  for (let attempt = 0; processingInfo && processingInfo.state !== "succeeded" && attempt < 5; attempt++) {
    if (processingInfo.state === "failed") {
      throw new Error(`メディアの処理に失敗しました: ${JSON.stringify(processingInfo)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, (processingInfo!.check_after_secs ?? 1) * 1000));
    processingInfo = await getMediaUploadStatus(mediaId);
  }
}

/** 画像バイト列をXにアップロードし、ツイート添付用のmedia_idを返す */
async function uploadImageMedia(bytes: Uint8Array): Promise<string> {
  const mediaId = await initializeMediaUpload(bytes.length);
  await appendMediaChunk(mediaId, bytes);
  await finalizeMediaUpload(mediaId);
  return mediaId;
}

// ============================================================
// クリップ職人ランキング画像の生成
// ============================================================
//
// 「名前だけの文字情報より、サイトの雰囲気を知ってほしい」という要望を受け、ClipRanking.jsxの
// WeeklyClipperBoard（トップページの週間クリップ職人ランキング表示）を模したカード画像を
// imagescript（jsr:@matmen/imagescript、Deno上で動く純粋なJS/WASM実装の画像処理ライブラリ、
// ネイティブ依存なし）で毎回その場で生成する。フォントは日本語カバレッジのある静的
// （非variable）フォントが要る。Noto Sans JPはGoogle Fontsの配布がvariable font
// （`[wght].ttf`）のみで、imagescriptの文字シェイパーとの相性が未検証だったため避け、
// 静的ウェイトが配布されているM PLUS 1p Bold（google/fontsリポジトリから直接fetch、
// 約1.7MB）を採用した（実際にJapanese文字列のレンダリングを確認済み）。
const CARD_FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/mplus1p/MPLUS1p-Bold.ttf";
const CARD_WIDTH = 1200;
const CARD_ROW_TOP = 190;
const CARD_ROW_HEIGHT = 92;
// ClipRanking.jsxのWEEKLY_RANK_ACCENTSと合わせた金・銀・銅
const CARD_RANK_COLORS: Record<number, [number, number, number]> = {
  1: [255, 200, 87], // #FFC857
  2: [201, 206, 218], // #C9CEDA
  3: [217, 142, 93], // #D98E5D
};

type CardImage = InstanceType<typeof Image>;

function cardColor(r: number, g: number, b: number, a = 255): number {
  return Image.rgbaToColor(r, g, b, a);
}

async function cardText(
  fontBytes: Uint8Array,
  str: string,
  size: number,
  r: number,
  g: number,
  b: number,
): Promise<CardImage> {
  return await Image.renderText(fontBytes, size, str, cardColor(r, g, b));
}

/** 背景の柔らかい発光ブロブ（サイトのbgGlow演出を模した装飾）。中心から外側へアルファを落として合成する */
function drawGlowBlob(
  canvas: CardImage,
  cx: number,
  cy: number,
  radius: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  const size = radius * 2;
  const blob = new Image(size, size);
  blob.fill((x: number, y: number) => {
    const dx = x - radius;
    const dy = y - radius;
    const dist = Math.sqrt(dx * dx + dy * dy) / radius;
    const a = dist > 1 ? 0 : Math.round(alpha * (1 - dist));
    return cardColor(r, g, b, a);
  });
  // 中心から外側へアルファを線形に落とすグラデーション自体で十分柔らかく見えるため、
  // 実際にぼかす処理（blur）はかけていない（imagescriptの型定義に無く、型チェックが通らないため）
  canvas.composite(blob, Math.round(cx - radius), Math.round(cy - radius));
}

interface ClipperCardEntry {
  creator_name: string;
  total_views: number;
  profile_image_url: string | null;
}

/**
 * 週間クリップ職人ランキング（1〜5人）をサイトのWeeklyClipperBoardを模したカード画像にする。
 * フォント取得・アバター取得はそれぞれtry/catchし、1人分のアバター取得に失敗しても
 * （Twitch側の画像が削除済み等）他の行やテキストは表示を続ける。呼び出し側
 * （buildClipperSpotlightPost）でさらに全体をtry/catchしており、この関数自体が失敗しても
 * 投稿はテキストのみで続行される。
 */
async function buildClipperRankingCard(clippers: ClipperCardEntry[]): Promise<Uint8Array> {
  const fontRes = await fetch(CARD_FONT_URL);
  if (!fontRes.ok) throw new Error(`カード用フォントの取得に失敗しました（${fontRes.status}）`);
  const fontBytes = new Uint8Array(await fontRes.arrayBuffer());

  // 人数分だけの高さにし、5人に満たない週でも下に無駄な余白ができないようにする
  const height = CARD_ROW_TOP + clippers.length * CARD_ROW_HEIGHT + 70;
  const canvas = new Image(CARD_WIDTH, height);
  canvas.fill((x: number, y: number) => {
    const t = (x / CARD_WIDTH + y / height) / 2;
    return cardColor(Math.round(16 + t * 10), Math.round(14 + t * 6), Math.round(24 + t * 20));
  });
  // サイトのブランドカラー（コーラルレッド・紫・水色）のブロブをうっすら配置
  drawGlowBlob(canvas, 80, 60, 260, 255, 77, 109, 65);
  drawGlowBlob(canvas, CARD_WIDTH - 50, 100, 300, 126, 20, 255, 50);
  drawGlowBlob(canvas, CARD_WIDTH - 170, height - 60, 260, 71, 191, 255, 40);

  const brand = await cardText(fontBytes, "クリスレ", 32, 255, 77, 109);
  canvas.composite(brand, 44, 38);
  const title = await cardText(fontBytes, "週間クリップ職人ランキング", 50, 237, 237, 242);
  canvas.composite(title, 44, 80);

  const panelX = 40;
  const panelW = CARD_WIDTH - 80;
  const panelH = 80;

  for (let i = 0; i < clippers.length; i++) {
    const c = clippers[i];
    const rank = i + 1;
    const rowY = CARD_ROW_TOP + i * CARD_ROW_HEIGHT;

    const panel = new Image(panelW, panelH);
    panel.fill(cardColor(28, 28, 38, 235));
    panel.roundCorners(16);
    canvas.composite(panel, panelX, rowY - 6);

    const [rr, rg, rb] = CARD_RANK_COLORS[rank] ?? [138, 138, 153];
    const rankImg = await cardText(fontBytes, String(rank), 42, rr, rg, rb);
    canvas.composite(rankImg, panelX + 24, rowY + 10);

    if (c.profile_image_url) {
      try {
        const avatarRes = await fetch(c.profile_image_url);
        if (avatarRes.ok) {
          const avatar = await Image.decode(new Uint8Array(await avatarRes.arrayBuffer()));
          avatar.resize(60, 60);
          avatar.cropCircle();
          canvas.composite(avatar, panelX + 100, rowY + 10);
        }
      } catch (e) {
        console.warn(`${c.creator_name}のアバター取得に失敗したため省略します:`, e);
      }
    }

    const nameImg = await cardText(fontBytes, c.creator_name, 30, 237, 237, 242);
    canvas.composite(nameImg, panelX + 180, rowY + 2);
    const viewsImg = await cardText(fontBytes, `${formatViews(c.total_views)}回視聴`, 19, 151, 151, 166);
    canvas.composite(viewsImg, panelX + 180, rowY + 46);
  }

  const footerY = CARD_ROW_TOP + clippers.length * CARD_ROW_HEIGHT + 20;
  canvas.drawBox(panelX, footerY, panelW, 3, cardColor(255, 77, 109, 200));
  const urlImg = await cardText(fontBytes, "kurisure.jp", 22, 151, 151, 166);
  canvas.composite(urlImg, panelX, footerY + 16);

  return await canvas.encode();
}

type PostType = "ranking" | "clipper_spotlight" | "feature_intro";

const BOARD_PITCH = "コメントもできるTwitchクリップの掲示板「クリスレ」";

interface BuiltPost {
  text: string;
  clipId: string | null;
  imageBytes: Uint8Array | null;
}

async function buildRankingPost(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<BuiltPost | null> {
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
  return { text, clipId: top.id, imageBytes: null };
}

async function buildClipperSpotlightPost(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<BuiltPost | null> {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = now.toISOString();

  const { data, error } = await supabase.rpc("get_top_clippers_by_period", {
    period_start: periodStart,
    period_end: periodEnd,
    clipper_limit: 5,
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

  // 2〜5位も名前だけ紹介する（2026-09-04追加、ユーザー要望）。人数分の名前で毎回長さが
  // 変わるため、他の固定文面を組み立てた後に残り予算を計算し、収まる人数分だけ載せる
  // （tweetWeight/buildRunnersUpLine参照）。
  const lines = [
    `今週のクリップ職人ランキング1位は「${truncateTo(top.creator_name, MAX_NAME_CHARS)}」さん🎬`,
    `直近7日間で合計${formatViews(top.total_views)}回視聴のクリップを生み出しています`,
    ``,
    `${BOARD_PITCH}でクリップ職人ランキングをチェック👇`,
    `${SITE_ORIGIN}/clippers/${top.creator_id}`,
  ];
  const runnersUp = (data as { creator_name: string }[]).slice(1, 5);
  const remainingBudget = TWEET_MAX_WEIGHT - tweetWeight(lines.join("\n")) - tweetWeight("\n") - 5;
  const runnersUpLine = buildRunnersUpLine(runnersUp, remainingBudget);
  if (runnersUpLine) lines.splice(2, 0, runnersUpLine); // 1位の行の直後に挿入

  // サイトの雰囲気（ランキング表示の見た目）が伝わる画像を添付する（2026-09-04追加、
  // ユーザー要望）。画像生成に失敗しても投稿自体は諦めない設計にしている（フォント/アバター
  // 取得先の一時的な障害等を想定し、その場合はテキストのみで投稿を続行する。main()側でも
  // アップロード自体の失敗を別途テキストのみ投稿へフォールバックさせている、二重の保険）。
  let imageBytes: Uint8Array | null = null;
  try {
    imageBytes = await buildClipperRankingCard(
      (data as ClipperCardEntry[]).slice(0, 5),
    );
  } catch (e) {
    console.warn("クリップ職人ランキング画像の生成に失敗したため、テキストのみで投稿します:", e);
  }

  return { text: lines.join("\n"), clipId: null, imageBytes };
}

function buildFeatureIntroPost(): BuiltPost {
  const text = [
    `お気に入りのクリップ、ちゃんと保存できてますか？`,
    ``,
    `${BOARD_PITCH}なら、気になったクリップに⭐を付けるだけで自分だけのクリップコレクションが作れます`,
    ``,
    `${SITE_ORIGIN}/favorites`,
  ].join("\n");
  return { text, clipId: null, imageBytes: null };
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

  // 画像付き投稿は、アップロードそのものの失敗（X側の一時的な障害・仕様変更等）も
  // テキストのみの投稿へフォールバックさせる（画像機能の不具合で毎週の投稿自体が
  // 止まってしまうことを避けるため、buildClipperRankingCard内のtry/catchとは別に
  // ここでも保険をかけている）。
  let tweetId: string;
  if (built.imageBytes) {
    try {
      const mediaId = await uploadImageMedia(built.imageBytes);
      tweetId = await postTweet(built.text, mediaId);
      console.log(`投稿しました（画像付き、tweet id: ${tweetId}）`);
    } catch (e) {
      console.warn("画像付き投稿に失敗したため、テキストのみで投稿し直します:", e);
      tweetId = await postTweet(built.text);
      console.log(`投稿しました（tweet id: ${tweetId}）`);
    }
  } else {
    tweetId = await postTweet(built.text);
    console.log(`投稿しました（tweet id: ${tweetId}）`);
  }

  const { error: insertErr } = await supabase
    .from("daily_ranking_posts")
    .insert({ posted_date: dateStr, clip_id: built.clipId, tweet_id: tweetId, post_type: postType });
  if (insertErr) console.error("daily_ranking_postsへの記録に失敗:", insertErr.message);
}

main().catch((err) => {
  console.error("日次ランキング投稿の実行中にエラーが発生しました:", err);
  Deno.exit(1);
});
