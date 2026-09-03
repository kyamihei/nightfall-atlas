// api/_lib/render-og.js
//
// SNSクローラー（Twitterbot/facebookexternalhit/LINE/Discordbot等）向けの、metaタグだけを
// 持つ最小限のHTMLを組み立てる。これらのボットはJSを実行しないため、SPAのindex.html
// （固定meta）をそのまま返しても個別クリップ等のOGP画像・タイトルが反映されない。
// vercel.jsonのUser-Agentベースのrewriteで、ボットからのアクセスだけこちらへ振り分ける
// （通常ユーザー・Googlebotは従来通りSPA本体へ、詳細はCLAUDE.md参照）。

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

export function renderOgHtml({ title, description, image, url, siteName = "クリスレ" }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const img = escapeHtml(image || "https://kurisure.jp/favicon.ico");
  const u = escapeHtml(url);
  const s = escapeHtml(siteName);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<link rel="canonical" href="${u}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${s}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:image" content="${img}" />
<meta property="og:url" content="${u}" />
<meta property="og:locale" content="ja_JP" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${img}" />
</head>
<body></body>
</html>
`;
}
