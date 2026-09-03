import { useEffect, useState } from "react";

const STORAGE_KEY = "cv-activity-feed-prefs";

export const ACTIVITY_FEED_TYPES = [
  { value: "comment", label: "新着コメント" },
  { value: "stamp", label: "リアクションスタンプ" },
  { value: "new_clip", label: "新着クリップ" },
  { value: "hot_thread", label: "盛り上がっているスレ" },
  { value: "rising_clipper", label: "急上昇中のクリップ職人" },
];

const DEFAULT_PREFS = {
  types: Object.fromEntries(ACTIVITY_FEED_TYPES.map((t) => [t.value, true])),
  newClipTag: "",
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      types: { ...DEFAULT_PREFS.types, ...(parsed.types ?? {}) },
      newClipTag: typeof parsed.newClipTag === "string" ? parsed.newClipTag : "",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * トップページのお知らせフィード（ライブ活動フィード）の表示設定。
 * アカウント機能が無いサイトのため、お気に入り/配信者タグのようにanon_id経由でDBへ保存する
 * のではなく、端末ごとの表示上の好みとしてlocalStorageだけで完結させている（デバイス間で
 * 同期する必要性が薄いため）。
 * - types: 種類ごとの表示ON/OFF
 * - newClipTag: 「新着クリップ」を自分の配信者タグ（broadcaster_tags、useMyBroadcasterTags）で
 *   絞り込む。空文字は絞り込みなし
 */
export function useActivityFeedPrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // プライベートブラウジング等でlocalStorageが使えない場合は保存を諦める（表示は継続する）
    }
  }, [prefs]);

  function toggleType(type) {
    setPrefs((prev) => ({ ...prev, types: { ...prev.types, [type]: !prev.types[type] } }));
  }

  function setNewClipTag(tag) {
    setPrefs((prev) => ({ ...prev, newClipTag: tag }));
  }

  return { prefs, toggleType, setNewClipTag };
}
