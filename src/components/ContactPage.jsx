import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import { useContactForm } from "../lib/use-clip-ranking";
import Footer from "./Footer";

const CATEGORIES = [
  { value: "bug", label: "不具合の報告" },
  { value: "request", label: "機能のご要望" },
  { value: "report", label: "コンテンツの通報" },
  { value: "other", label: "その他" },
];

export default function ContactPage() {
  const { submit, submitting, result } = useContactForm();
  const [category, setCategory] = useState("other");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!body.trim()) {
      setLocalError("お問い合わせ内容を入力してください。");
      return;
    }
    setLocalError("");
    submit(category, email.trim(), body.trim());
  }

  const sent = result?.ok;

  return (
    <div style={styles.page}>
      <style>{`
        * { font-family: 'Inter', sans-serif; }
        .clip-title-font { font-family: 'Oswald', sans-serif; }
        button, a { cursor: pointer; }
        textarea:focus, input:focus, select:focus { outline: 2px solid #FF4D6D33; }
      `}</style>

      <Link to="/" style={styles.backLink}>
        <ArrowLeft size={14} />
        ランキングに戻る
      </Link>

      <h1 className="clip-title-font" style={styles.h1}>
        お問い合わせ
      </h1>
      <p style={styles.tagline}>
        不具合報告・機能のご要望・コンテンツの通報など、お気軽にご連絡ください。
      </p>

      {sent ? (
        <div style={styles.successBox}>{result.message}</div>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            種類
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.select}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            メールアドレス（任意・返信が必要な場合のみ）
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@example.com"
              style={styles.input}
              maxLength={200}
            />
          </label>

          <label style={styles.label}>
            お問い合わせ内容
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                if (localError) setLocalError("");
              }}
              placeholder="内容をできるだけ詳しくご記入ください"
              style={styles.textarea}
              rows={8}
              maxLength={2000}
            />
          </label>

          {(localError || (result && !result.ok)) && (
            <p style={styles.errorText}>{localError || result.message}</p>
          )}

          <button type="submit" style={styles.submitBtn} disabled={submitting}>
            <Send size={14} />
            {submitting ? "送信中…" : "送信する"}
          </button>
        </form>
      )}

      <Footer />
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#14141B",
    color: "#EDEDF2",
    padding: "28px 32px 60px",
    maxWidth: 640,
    margin: "0 auto",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "#8A8A99",
    fontSize: 12.5,
    textDecoration: "none",
    marginBottom: 18,
  },
  h1: { fontSize: 24, fontWeight: 600, margin: "0 0 6px" },
  tagline: { fontSize: 13, color: "#6B6B78", margin: "0 0 24px" },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#9797A6" },
  select: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
    color: "#EDEDF2",
  },
  input: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
    color: "#EDEDF2",
  },
  textarea: {
    background: "#1C1C26",
    border: "1px solid #2E2E3A",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13.5,
    color: "#EDEDF2",
    resize: "vertical",
    lineHeight: 1.6,
  },
  errorText: { fontSize: 12.5, color: "#F0997B", margin: 0 },
  submitBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "#FF4D6D",
    border: "none",
    borderRadius: 8,
    color: "#1C1417",
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 600,
  },
  successBox: {
    background: "#1C2A20",
    border: "1px solid #2E4A38",
    color: "#8FDDA8",
    borderRadius: 10,
    padding: "18px 16px",
    fontSize: 13.5,
    lineHeight: 1.7,
  },
};
