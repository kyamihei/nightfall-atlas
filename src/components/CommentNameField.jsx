// components/CommentNameField.jsx
//
// コメント投稿フォームの名前欄（2026-09-04追加）。「コメント時、ニックネームか匿名かを
// 選べるようにしてほしい」という要望への対応。ニックネームを設定済みの会員には
// 「ニックネームで投稿」／「匿名で投稿」の2択を出し、それ以外（非会員・ニックネーム未設定）
// には従来通りの自由入力欄をそのまま表示する（見た目・挙動を変えない）。
// 4つのコメント投稿画面（クリップ詳細・総合スレ・タグスレ・トップページのサイドパネル）で
// 共通利用する。
//
// 呼び出し側は、実際に投稿するdisplay_nameとして
// `nickname && useNickname ? nickname : freeText` を使う。

export default function CommentNameField({
  nickname,
  useNickname,
  onUseNicknameChange,
  freeText,
  onFreeTextChange,
  inputStyle,
}) {
  if (!nickname) {
    return (
      <input
        value={freeText}
        onChange={(e) => onFreeTextChange(e.target.value)}
        placeholder="名前（任意・空欄なら匿名）"
        style={inputStyle}
        maxLength={20}
      />
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.toggleRow}>
        <button
          type="button"
          onClick={() => onUseNicknameChange(true)}
          style={useNickname ? styles.toggleBtnActive : styles.toggleBtn}
        >
          {nickname} で投稿
        </button>
        <button
          type="button"
          onClick={() => onUseNicknameChange(false)}
          style={!useNickname ? styles.toggleBtnActive : styles.toggleBtn}
        >
          匿名で投稿
        </button>
      </div>
      {!useNickname && (
        <input
          value={freeText}
          onChange={(e) => onFreeTextChange(e.target.value)}
          placeholder="名前（任意・空欄なら匿名）"
          style={inputStyle}
          maxLength={20}
        />
      )}
    </div>
  );
}

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 6 },
  toggleRow: { display: "flex", gap: 6 },
  toggleBtn: {
    background: "transparent",
    border: "1px solid #2E2E3A",
    color: "#8A8A99",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 12,
  },
  toggleBtnActive: {
    background: "#24242F",
    border: "1px solid #3A3A48",
    color: "#EDEDF2",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
  },
};
