import { supabaseGet } from "./_lib/supabase.js";

export default async function handler(req, res) {
  const results = {};
  for (const [key, path] of Object.entries({
    broadcasters: `tracked_broadcasters?select=broadcaster_name&order=last_seen_at.desc&limit=5000`,
    clippers: `top_clippers_mv?select=creator_id&order=total_views.desc&limit=3000`,
    clips: `clips?id=neq.__general_thread__&select=id,twitch_created_at&order=view_count.desc&limit=5000`,
  })) {
    try {
      const url = `https://awnwspavalqksllbtkty.supabase.co/rest/v1/${path}`;
      const r = await fetch(url, {
        headers: {
          apikey:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3bndzcGF2YWxxa3NsbGJ0a3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNDQ0MjMsImV4cCI6MjEwMzgyMDQyM30.UlQwC9cUfZ5Y0_WTtRbUPZhMHkieBnPaX6yHayCFe7U",
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3bndzcGF2YWxxa3NsbGJ0a3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNDQ0MjMsImV4cCI6MjEwMzgyMDQyM30.UlQwC9cUfZ5Y0_WTtRbUPZhMHkieBnPaX6yHayCFe7U",
        },
      });
      const text = await r.text();
      results[key] = { status: r.status, ok: r.ok, len: text.length, sample: text.slice(0, 300) };
    } catch (e) {
      results[key] = { error: String(e && e.stack ? e.stack : e) };
    }
  }
  res.status(200).json(results);
}
