// supabase/functions/refresh-clip-view-count/index.ts
//
// クリップ詳細ページを開いた瞬間に、そのクリップだけをTwitchへ単発で問い合わせてview_countを
// 最新化するための遅延同期API（2026-09-05追加）。refresh-clip-views.ts（毎時バッチ、
// view_count_synced_atが古い順に最大5000件ずつ処理）は、全クリップ（45万件超）を一巡するのに
// 数十時間かかることがあり、その間は「実際に人が見ているクリップ」の視聴回数が表示上ズレたまま
// になりうる（本番で実際に報告された不具合）。このAPIは詳細ページを開いた瞬間だけ個別に
// 最新化することで、バッチの順番待ちとは無関係に「人が見ている数字」を常に正確にする。
//
// 直近STALE_THRESHOLD_MS以内に同期済みなら何もせず現在のview_countをそのまま返す
// （詳細ページを開くたびに毎回Twitchを叩かないための自然なレート制限を兼ねる）。
//
// デプロイ: supabase functions deploy refresh-clip-view-count
// 呼び出し: POST /functions/v1/refresh-clip-view-count
//   body: { clip_id: string }
//   header: Authorization: Bearer <anon session の access_token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1時間以内に同期済みならTwitchへ問い合わせない

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Twitchのアプリアクセストークンはコールドスタート間で使い回す（有効期限まで毎回の
// トークン取得を省略し、レイテンシとTwitch側の負荷を減らす）。
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", TWITCH_CLIENT_ID);
  url.searchParams.set("client_secret", TWITCH_CLIENT_SECRET);
  url.searchParams.set("grant_type", "client_credentials");
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Twitchトークン取得に失敗しました: ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POSTのみ対応しています" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "認証情報がありません" }, 401);
  }

  let payload: { clip_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストの形式が不正です" }, 400);
  }
  const clipId = (payload.clip_id ?? "").trim();
  if (!clipId) {
    return jsonResponse({ error: "clip_idを指定してください" }, 400);
  }

  // 他のEdge Function同様、Authorizationヘッダーで上書きせず正真正銘のservice roleクライアントとして
  // 使う（「本番でハマった重要なRLSの罠」節参照。auth.getUser(jwt)はトークンを明示的に渡す呼び出しの
  // ためこの上書きが無くても正しく検証できる）。
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (userError || !user) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }

  const { data: clip, error: fetchError } = await supabase
    .from("clips")
    .select("view_count, view_count_synced_at")
    .eq("id", clipId)
    .maybeSingle();
  if (fetchError || !clip) {
    return jsonResponse({ error: "クリップが見つかりませんでした" }, 404);
  }

  if (clip.view_count_synced_at) {
    const age = Date.now() - new Date(clip.view_count_synced_at).getTime();
    if (age < STALE_THRESHOLD_MS) {
      return jsonResponse({ view_count: clip.view_count, refreshed: false });
    }
  }

  let token: string;
  try {
    token = await getAppAccessToken();
  } catch {
    // Twitch側の一時的な不調等で更新できなくても、詳細ページの表示自体は現在値で継続させる
    return jsonResponse({ view_count: clip.view_count, refreshed: false });
  }

  const clipUrl = new URL("https://api.twitch.tv/helix/clips");
  clipUrl.searchParams.set("id", clipId);
  const twitchRes = await fetch(clipUrl, {
    headers: { "Client-Id": TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  if (!twitchRes.ok) {
    return jsonResponse({ view_count: clip.view_count, refreshed: false });
  }
  const twitchData = await twitchRes.json();
  const found = twitchData.data?.[0] as { view_count: number } | undefined;

  // 既存のバッチ同期（refresh-clip-views.ts）と同じRPCを使い、更新ロジックを二重管理しない。
  // Twitch側で見つからなかった（削除済み等）場合もview_count_synced_atだけ更新して再取得対象から外す。
  const { error: updateError } = await supabase.rpc("bulk_update_clip_views", {
    updates: [{ id: clipId, view_count: found ? found.view_count : null }],
  });
  if (updateError) {
    return jsonResponse({ view_count: clip.view_count, refreshed: false });
  }

  return jsonResponse({ view_count: found ? found.view_count : clip.view_count, refreshed: true });
});
