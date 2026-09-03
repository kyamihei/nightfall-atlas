import { supabaseGet } from "./_lib/supabase.js";

// 静的ページ + 配信者全件 + 人気クリップ職人上位 + 人気クリップ上位をまとめたsitemap。
// clips全件（54万件超）は含めない（Googleのsitemap上限50,000件に対して非現実的な規模な上、
// 視聴回数がごく少ないクリップは検索価値がほとんど無いため、上位のみに絞るほうが
// クロール予算の使い方として合理的）。vercel.jsonのrewriteで/sitemap.xmlをこの関数へ
// マッピングしている（public/sitemap.xmlの静的ファイルは廃止した）。

const STATIC_PATHS = [
  "/", "/broadcasters", "/clippers", "/search", "/general", "/threads",
  "/about", "/terms", "/privacy", "/contact",
];

function escapeXml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[c]);
}

function urlEntry(loc, lastmod) {
  return `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
}

export default async function handler(req, res) {
  // 3件同時にPromise.allで並列fetchすると本番で2件がnullで返る現象を確認したため
  // （原因未特定、Vercel Functions環境からの複数同時fetchに関する何らかの制約の可能性）、
  // 順次実行にして確実性を優先する（sitemapは長時間キャッシュするため数百ms〜数秒の
  // 差は問題にならない）。
  const broadcasters = await supabaseGet(`tracked_broadcasters?select=broadcaster_name&order=last_seen_at.desc&limit=5000`);
  const clippers = await supabaseGet(`top_clippers_mv?select=creator_id&order=total_views.desc&limit=3000`);
  const clips = await supabaseGet(`clips?id=neq.__general_thread__&select=id,twitch_created_at&order=view_count.desc&limit=5000`);

  const entries = [
    ...STATIC_PATHS.map((p) => urlEntry(`https://kurisure.jp${p}`)),
    ...(broadcasters ?? []).map((b) =>
      urlEntry(`https://kurisure.jp/broadcasters/${encodeURIComponent(b.broadcaster_name)}`),
    ),
    ...(clippers ?? []).map((c) =>
      urlEntry(`https://kurisure.jp/clippers/${encodeURIComponent(c.creator_id)}`),
    ),
    ...(clips ?? []).map((c) =>
      urlEntry(
        `https://kurisure.jp/clips/${encodeURIComponent(c.id)}`,
        c.twitch_created_at ? c.twitch_created_at.slice(0, 10) : undefined,
      ),
    ),
  ];

  const debug = `<!-- debug: broadcasters=${broadcasters === null ? "null" : broadcasters.length} clippers=${clippers === null ? "null" : clippers.length} clips=${clips === null ? "null" : clips.length} -->`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
${debug}
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400");
  res.status(200).send(xml);
}
