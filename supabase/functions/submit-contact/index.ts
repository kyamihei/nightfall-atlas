// supabase/functions/submit-contact/index.ts
//
// お問い合わせフォームの投稿API。contact_messagesに書き込むのみで、閲覧用のAPIは提供しない
// （運営がservice roleで直接DBを確認する運用。post-comment同様レート制限のみサーバー側で強制する）。
//
// デプロイ: supabase functions deploy submit-contact
// 呼び出し: POST /functions/v1/submit-contact
//   body: { category: string, email?: string, body: string }
//   header: Authorization: Bearer <anon session の access_token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RATE_LIMIT_WINDOW_MS = 60_000; // 同一ユーザーの連続投稿を防ぐ間隔
const IP_RATE_LIMIT_WINDOW_MS = 3_600_000; // 同一IPからの短時間大量投稿を防ぐ間隔（1時間）
const IP_RATE_LIMIT_MAX = 5;
const MAX_BODY_LENGTH = 2000;
const MAX_EMAIL_LENGTH = 200;
const VALID_CATEGORIES = ["bug", "request", "report", "other"];

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

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  let payload: { category?: string; email?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストの形式が不正です" }, 400);
  }

  const category = VALID_CATEGORIES.includes(payload.category ?? "") ? (payload.category as string) : "other";
  const email = (payload.email ?? "").trim().slice(0, MAX_EMAIL_LENGTH) || null;
  const rawBody = (payload.body ?? "").trim();

  if (!rawBody) {
    return jsonResponse({ error: "お問い合わせ内容を入力してください" }, 400);
  }
  if (rawBody.length > MAX_BODY_LENGTH) {
    return jsonResponse({ error: `お問い合わせ内容は${MAX_BODY_LENGTH}文字以内で入力してください` }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "メールアドレスの形式が正しくありません" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (userError || !user) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }
  const anonId = user.id;

  // 同一ユーザーの連続投稿チェック
  const { data: recentOwn } = await supabase
    .from("contact_messages")
    .select("created_at")
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

  // IPベースのレート制限
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  const ipHash = await hashIp(ip);

  const windowStart = new Date(Date.now() - IP_RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: ipCount } = await supabase
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);
  if ((ipCount ?? 0) >= IP_RATE_LIMIT_MAX) {
    return jsonResponse({ error: "投稿が集中しています。しばらく時間をおいてください" }, 429);
  }

  const { error: insertError } = await supabase.from("contact_messages").insert({
    anon_id: anonId,
    category,
    email,
    body: rawBody,
    ip_hash: ipHash,
  });

  if (insertError) {
    return jsonResponse({ error: "送信に失敗しました" }, 500);
  }

  return jsonResponse({ ok: true });
});
