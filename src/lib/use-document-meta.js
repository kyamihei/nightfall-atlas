// lib/use-document-meta.js
//
// SEOのため、クリップ/配信者/クリップ職人の個別ページでdocument.titleとmeta descriptionを
// 動的に書き換える。SPAなのでindex.htmlのmetaは固定値のままだが、Googlebotはクライアント側の
// JS実行後のDOMも見に来るため、ここを直すだけでも検索結果のタイトル・説明文が個別ページの
// 内容を反映するようになる（動的OGP自体はSNSボット向けにapi/og/*が別途処理する、
// vercel.json参照）。

import { useEffect } from "react";

const DEFAULTS = {
  title: document.title,
  description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
  ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
  ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "",
  ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "",
  ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "",
  twitterTitle: document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ?? "",
  twitterDescription: document.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ?? "",
};

function setMeta(selector, content) {
  const el = document.querySelector(selector);
  if (!el) return;
  const attr = el.tagName === "LINK" ? "href" : "content";
  el.setAttribute(attr, content ?? "");
}

/** title未指定（データ未取得中など）の間は何もしない。取得できたら都度呼び直せばよい */
export function useDocumentMeta({ title, description, image, path }) {
  useEffect(() => {
    if (!title) return undefined;
    const url = path ? `https://kurisure.jp${path}` : DEFAULTS.ogUrl;
    document.title = title;
    setMeta('meta[name="description"]', description || DEFAULTS.description);
    setMeta('link[rel="canonical"]', url);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description || DEFAULTS.description);
    setMeta('meta[property="og:image"]', image || DEFAULTS.ogImage);
    setMeta('meta[property="og:url"]', url);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description || DEFAULTS.description);

    return () => {
      document.title = DEFAULTS.title;
      setMeta('meta[name="description"]', DEFAULTS.description);
      setMeta('link[rel="canonical"]', "https://kurisure.jp/");
      setMeta('meta[property="og:title"]', DEFAULTS.ogTitle);
      setMeta('meta[property="og:description"]', DEFAULTS.ogDescription);
      setMeta('meta[property="og:image"]', DEFAULTS.ogImage);
      setMeta('meta[property="og:url"]', DEFAULTS.ogUrl);
      setMeta('meta[name="twitter:title"]', DEFAULTS.twitterTitle);
      setMeta('meta[name="twitter:description"]', DEFAULTS.twitterDescription);
    };
  }, [title, description, image, path]);
}
