import { supabaseGet } from "../../_lib/supabase.js";
import { renderOgHtml } from "../../_lib/render-og.js";

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n ?? 0);
}

export default async function handler(req, res) {
  const { id } = req.query;
  const rows = await supabaseGet(
    `clips?id=eq.${encodeURIComponent(id)}&select=title,streamer,view_count,thumbnail_url,creator_name`,
  );
  const clip = rows?.[0];

  if (!clip) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOgHtml({
      title: "クリップが見つかりませんでした | クリスレ",
      description: "指定されたクリップは見つかりませんでした。",
      url: `https://kurisure.jp/clips/${id}`,
    }));
    return;
  }

  const title = `${clip.title} - ${clip.streamer} | クリスレ`;
  const description = `${clip.streamer}のクリップ「${clip.title}」・${formatViews(clip.view_count)}回視聴${
    clip.creator_name ? `・クリップ職人: ${clip.creator_name}` : ""
  }`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(
    renderOgHtml({
      title,
      description,
      image: clip.thumbnail_url,
      url: `https://kurisure.jp/clips/${id}`,
    }),
  );
}
