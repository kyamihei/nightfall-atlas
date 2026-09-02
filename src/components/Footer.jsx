import { Link } from "react-router-dom";

const LINKS = [
  { to: "/", label: "ホーム" },
  { to: "/about", label: "サイトについて" },
  { to: "/terms", label: "利用規約" },
  { to: "/privacy", label: "プライバシーポリシー" },
  { to: "/contact", label: "お問い合わせ" },
];

export default function Footer({ note }) {
  return (
    <footer style={styles.footer}>
      {note && <p style={styles.note}>{note}</p>}
      <nav style={styles.links}>
        {LINKS.map((link, i) => (
          <span key={link.to} style={styles.linkGroup}>
            <Link to={link.to} style={styles.link}>
              {link.label}
            </Link>
            {i < LINKS.length - 1 && <span style={styles.divider}>・</span>}
          </span>
        ))}
      </nav>
      <p style={styles.copyright}>© {new Date().getFullYear()} クリスレ</p>
    </footer>
  );
}

const styles = {
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTop: "1px solid #24242F",
    textAlign: "center",
  },
  note: {
    fontSize: 11.5,
    color: "#4E4E58",
    margin: "0 0 12px",
  },
  links: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  linkGroup: { display: "inline-flex", alignItems: "center" },
  link: {
    fontSize: 12,
    color: "#8A8A99",
    textDecoration: "none",
    padding: "2px 4px",
  },
  divider: { fontSize: 12, color: "#3A3A44", margin: "0 2px" },
  copyright: {
    fontSize: 11,
    color: "#4E4E58",
    margin: 0,
  },
};
