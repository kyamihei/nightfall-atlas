// api/_lib/supabase.js
//
// Vercel Serverless Functions（api/以下）から使う軽量なSupabase REST(PostgREST)クライアント。
// フロント（src/lib/supabase-client.ts）と同じ匿名キーを使う。匿名キーはビルド後のJSバンドルに
// そのまま含まれる公開情報のため、ここに直書きしても秘密情報の漏洩にはならない
// （実際のアクセス制御はSupabase側のRLSが担う）。

const SUPABASE_URL = "https://awnwspavalqksllbtkty.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3bndzcGF2YWxxa3NsbGJ0a3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNDQ0MjMsImV4cCI6MjEwMzgyMDQyM30.UlQwC9cUfZ5Y0_WTtRbUPZhMHkieBnPaX6yHayCFe7U";

/** path例: "clips?id=eq.xxx&select=title,streamer" */
export async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}
