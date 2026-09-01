// supabase/functions/post-comment/index.ts
//
// 匿名コメント投稿API。
// クライアント側の制限（15秒クールダウン・NGワードマスク）はUX用の即時フィードバックに過ぎず、
// 実際の強制はこのEdge Function側で行う。
//
// デプロイ: supabase functions deploy post-comment
// 呼び出し: POST /functions/v1/post-comment
//   body: { clip_id: string, body: string, display_name?: string }
//   header: Authorization: Bearer <anon session の access_token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RATE_LIMIT_WINDOW_MS = 15_000; // 同一クリップへの連続投稿を防ぐ間隔
const IP_RATE_LIMIT_WINDOW_MS = 60_000; // 同一IPからの短時間大量投稿を防ぐ間隔
const IP_RATE_LIMIT_MAX = 5; // 上記ウィンドウ内での上限件数
const MAX_BODY_LENGTH = 280;
const MAX_NAME_LENGTH = 20;

// 実運用ではDBテーブルや外部サービス（例: Perspective API）に差し替える想定の簡易辞書
const NG_WORDS = ["死ね", "殺す", "きえろ", "しね"];

function maskNgWords(text: string): { masked: string; hit: boolean } {
  let hit = false;
  let masked = text;
  for (const word of NG_WORDS) {
    const re = new RegExp(word, "gi");
    if (re.test(masked)) hit = true;
    masked = masked.replace(re, "○".repeat(word.length));
  }
  return { masked, hit };
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ブラウザから直接fetchするEdge FunctionはCORS対応が必須。
// 許可オリジンは環境変数で絞れるようにし、未設定時のみ開発用に "*" を許可する。
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // ブラウザが本リクエスト前に送るプリフライトリクエストに応答する
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

  let payload: { clip_id?: string; body?: string; display_name?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストの形式が不正です" }, 400);
  }

  const clipId = (payload.clip_id ?? "").trim();
  const rawBody = (payload.body ?? "").trim();
  const displayName = (payload.display_name ?? "").trim().slice(0, MAX_NAME_LENGTH) || "名無しの視聴者";

  if (!clipId) {
    return jsonResponse({ error: "clip_idを指定してください" }, 400);
  }
  if (!rawBody) {
    return jsonResponse({ error: "コメントを入力してください" }, 400);
  }
  if (rawBody.length > MAX_BODY_LENGTH) {
    return jsonResponse({ error: `コメントは${MAX_BODY_LENGTH}文字以内で入力してください` }, 400);
  }

  // service role clientで検証・書き込み（RLSをEdge Function内で明示的にハンドリングする）
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // トークンからanon_idを取得
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

  if (userError || !user) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }
  const anonId = user.id;

  // クリップの存在確認
  const { data: clip, error: clipError } = await supabase
    .from("clips")
    .select("id")
    .eq("id", clipId)
    .maybeSingle();
  if (clipError || !clip) {
    return jsonResponse({ error: "対象のクリップが見つかりません" }, 404);
  }

  // 同一クリップへの連続投稿チェック（同一anon_id）
  const { data: recentOwn } = await supabase
    .from("comments")
    .select("created_at")
    .eq("clip_id", clipId)
    .eq("anon_id", anonId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentOwn) {
    const elapsed = Date.now() - new Date(recentOwn.created_at).getTime();
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const remain = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
      return jsonResponse({ error: `連続投稿はできません。あと${remain}秒お待ちください` }, 429);
    }
  }

  // IPベースのレート制限（Cookie削除等の回避策への対策）
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  const ipHash = await hashIp(ip);

  const windowStart = new Date(Date.now() - IP_RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: ipCount } = await supabase
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);

  if ((ipCount ?? 0) >= IP_RATE_LIMIT_MAX) {
    return jsonResponse({ error: "投稿が集中しています。しばらく時間をおいてください" }, 429);
  }

  const { masked } = maskNgWords(rawBody);

  const { data: inserted, error: insertError } = await supabase
    .from("comments")
    .insert({
      clip_id: clipId,
      anon_id: anonId,
      ip_hash: ipHash,
      display_name: displayName,
      body: masked,
    })
    .select("id, display_name, body, created_at")
    .single();

  if (insertError) {
    return jsonResponse({ error: "投稿に失敗しました" }, 500);
  }

  return jsonResponse({ comment: inserted });
});
