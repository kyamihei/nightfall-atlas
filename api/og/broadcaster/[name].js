import { supabaseGet } from "../../_lib/supabase.js";
import { renderOgHtml } from "../../_lib/render-og.js";

function formatViews(n) {
  return new Intl.NumberFormat("ja-JP").format(n ?? 0);
}

export default async function handler(req, res) {
  const { name } = req.query;
  const streamer = decodeURIComponent(name);
  const rows = await supabaseGet(
    `top_broadcasters_mv?streamer=eq.${encodeURIComponent(streamer)}&select=streamer,total_views,clip_count,profile_image_url`,
  );
  const broadcaster = rows?.[0];

  if (!broadcaster) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOgHtml({
      title: "配信者が見つかりませんでした | クリスレ",
      description: "指定された配信者は見つかりませんでした。",
      url: `https://kurisure.jp/broadcasters/${encodeURIComponent(streamer)}`,
    }));
    return;
  }

  const title = `${broadcaster.streamer}のクリップ一覧 | クリスレ`;
  const description = `${broadcaster.streamer}のTwitchクリップをランキングでチェック。合計${formatViews(broadcaster.total_views)}回視聴・クリップ${formatViews(broadcaster.clip_count)}件。`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(
    renderOgHtml({
      title,
      description,
      image: broadcaster.profile_image_url,
      url: `https://kurisure.jp/broadcasters/${encodeURIComponent(streamer)}`,
    }),
  );
}
