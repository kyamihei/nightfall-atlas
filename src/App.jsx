import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Header from "./components/Header";
import ClipRanking from "./components/ClipRanking";
import BroadcasterList from "./components/BroadcasterList";
import ClipDetail from "./components/ClipDetail";
import BroadcasterDetail from "./components/BroadcasterDetail";
import MyReactions from "./components/MyReactions";
import MyFavorites from "./components/MyFavorites";
import MyStampsPage from "./components/MyStampsPage";
import ClipperList from "./components/ClipperList";
import ClipperDetail from "./components/ClipperDetail";
import ClipSearch from "./components/ClipSearch";
import GeneralThread from "./components/GeneralThread";
import TagThreadList from "./components/TagThreadList";
import TagThreadDetail from "./components/TagThreadDetail";
import AboutPage from "./components/AboutPage";
import HowToUsePage from "./components/HowToUsePage";
import TermsPage from "./components/TermsPage";
import PrivacyPage from "./components/PrivacyPage";
import ContactPage from "./components/ContactPage";
import AdminPage from "./components/AdminPage";
import RegisterPage from "./components/RegisterPage";
import MyPage from "./components/MyPage";

// 管理画面は内部ツールとして意図的に質素な見た目のままにするため、共通ヘッダーの対象外にする
// （BackgroundGlowを全ページ展開した際もAdminPageだけ除外した既存方針と同じ考え方）。
const NO_HEADER_PREFIXES = ["/admin-e9ae0115e698436e"];

function AppRoutes() {
  const location = useLocation();
  const showHeader = !NO_HEADER_PREFIXES.some((p) => location.pathname.startsWith(p));

  return (
    <>
      {showHeader && <Header />}
      <Routes>
        <Route path="/" element={<ClipRanking />} />
        <Route path="/broadcasters" element={<BroadcasterList />} />
        <Route path="/clips/:id" element={<ClipDetail />} />
        <Route path="/broadcasters/:name" element={<BroadcasterDetail />} />
        <Route path="/my-reactions" element={<MyReactions />} />
        <Route path="/favorites" element={<MyFavorites />} />
        <Route path="/my-stamps" element={<MyStampsPage />} />
        <Route path="/clippers" element={<ClipperList />} />
        <Route path="/clippers/:creatorId" element={<ClipperDetail />} />
        <Route path="/search" element={<ClipSearch />} />
        <Route path="/general" element={<GeneralThread />} />
        <Route path="/threads" element={<TagThreadList />} />
        <Route path="/threads/:id" element={<TagThreadDetail />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/guide" element={<HowToUsePage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="/admin-e9ae0115e698436e" element={<AdminPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
