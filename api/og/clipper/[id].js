import { supabaseGet } from "../../_lib/supabase.js";
import { renderOgHtml } from "../../_lib/render-og.js";

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n ?? 0);
}

export default async function handler(req, res) {
  const { id } = req.query;
  const rows = await supabaseGet(
    `top_clippers_mv?creator_id=eq.${encodeURIComponent(id)}&select=creator_id,creator_name,total_views,clip_count,profile_image_url,rank`,
  );
  const clipper = rows?.[0];

  if (!clipper) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOgHtml({
      title: "クリップ職人が見つかりませんでした | クリスレ",
      description: "指定されたクリップ職人は見つかりませんでした。",
      url: `https://kurisure.jp/clippers/${encodeURIComponent(id)}`,
    }));
    return;
  }

  const title = `${clipper.creator_name}のクリップ一覧 | クリスレ`;
  const description = `クリップ職人${clipper.creator_name}${clipper.rank ? `（総合${clipper.rank}位）` : ""}が作ったクリップ一覧。合計${formatViews(clipper.total_views)}回視聴・クリップ${formatViews(clipper.clip_count)}件。`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(
    renderOgHtml({
      title,
      description,
      image: clipper.profile_image_url,
      url: `https://kurisure.jp/clippers/${encodeURIComponent(id)}`,
    }),
  );
}
