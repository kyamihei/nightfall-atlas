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

const PAGE_SIZE = 1000;

/**
 * PostgRESTのプロジェクト側デフォルト行数上限（1000件、クエリ文字列のlimit=Nでは超えられない、
 * 詳細はCLAUDE.md「最新クリップ反映の高速化」節）を超えて取得するためのRangeヘッダーによる
 * ページング。path例: "clips?select=id&order=view_count.desc"（limitは付けない）
 */
export async function supabaseGetPaged(path, totalLimit) {
  const all = [];
  let offset = 0;
  while (all.length < totalLimit) {
    const pageSize = Math.min(PAGE_SIZE, totalLimit - all.length);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) break;
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}
