// supabase/functions/request-broadcaster/index.ts
//
// ユーザーが「この配信者を追加してほしい」とTwitchのログイン名（チャンネル名）を送ると、
// Twitch Helix APIで実在確認したうえで tracked_broadcasters に自動追加する。
// 次回の sync-twitch-clips 実行時からその配信者のクリップが収集対象になる。
//
// デプロイ: supabase functions deploy request-broadcaster
// 呼び出し: POST /functions/v1/request-broadcaster
//   body: { twitch_login: string }
//   header: Authorization: Bearer <anon session の access_token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID")!;
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET")!;

const REQUEST_LIMIT_PER_DAY = 5; // 1人あたりの1日の登録リクエスト上限（乱用防止）

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getTwitchAppToken(): Promise<string> {
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", TWITCH_CLIENT_ID);
  url.searchParams.set("client_secret", TWITCH_CLIENT_SECRET);
  url.searchParams.set("grant_type", "client_credentials");
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error("Twitchトークン取得に失敗しました");
  const data = await res.json();
  return data.access_token as string;
}

async function findTwitchUser(login: string, token: string) {
  const url = new URL("https://api.twitch.tv/helix/users");
  url.searchParams.set("login", login);
  const res = await fetch(url, {
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.data?.[0] as { id: string; display_name: string } | undefined) ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "POSTのみ対応しています" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "認証情報がありません" }, 401);
  }

  let payload: { twitch_login?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストの形式が不正です" }, 400);
  }

  // 「@名前」や「https://twitch.tv/名前」で入力されても解釈できるように正規化
  const rawLogin = (payload.twitch_login ?? "").trim();
  const login = rawLogin
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
    .replace(/^@/, "")
    .toLowerCase();

  if (!login || !/^[a-z0-9_]{3,25}$/.test(login)) {
    return jsonResponse({ error: "Twitchのチャンネル名を正しく入力してください" }, 400);
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

  // 1日あたりのリクエスト数を制限（乱用防止）
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("broadcaster_requests")
    .select("id", { count: "exact", head: true })
    .eq("anon_id", anonId)
    .gte("created_at", since);
  if ((count ?? 0) >= REQUEST_LIMIT_PER_DAY) {
    return jsonResponse({ error: "本日のリクエスト上限に達しました。また明日お試しください" }, 429);
  }

  // 既に登録済みかどうか確認
  const { data: existing } = await supabase
    .from("tracked_broadcasters")
    .select("broadcaster_id, broadcaster_name")
    .ilike("broadcaster_name", login)
    .maybeSingle();
  if (existing) {
    return jsonResponse({
      status: "already_tracked",
      message: `${existing.broadcaster_name}さんは既に登録されています`,
    });
  }

  // Twitch APIで実在確認
  const token = await getTwitchAppToken();
  const twitchUser = await findTwitchUser(login, token);

  if (!twitchUser) {
    await supabase.from("broadcaster_requests").insert({
      twitch_login: login,
      anon_id: anonId,
      status: "rejected",
    });
    return jsonResponse(
      { error: "指定されたTwitchチャンネルが見つかりませんでした。名前を確認してください" },
      404,
    );
  }

  // 実在確認できたので自動反映
  await supabase.from("tracked_broadcasters").upsert(
    {
      broadcaster_id: twitchUser.id,
      broadcaster_name: twitchUser.display_name,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "broadcaster_id" },
  );
  await supabase.from("broadcaster_requests").insert({
    twitch_login: login,
    anon_id: anonId,
    status: "approved",
  });

  return jsonResponse({
    status: "approved",
    message: `${twitchUser.display_name}さんを登録しました。次回の同期からクリップが表示されます`,
  });
});
