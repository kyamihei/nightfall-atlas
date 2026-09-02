import { BrowserRouter, Routes, Route } from "react-router-dom";
import ClipRanking from "./components/ClipRanking";
import BroadcasterList from "./components/BroadcasterList";
import ClipDetail from "./components/ClipDetail";
import BroadcasterDetail from "./components/BroadcasterDetail";
import MyReactions from "./components/MyReactions";
import MyFavorites from "./components/MyFavorites";
import ClipperList from "./components/ClipperList";
import ClipperDetail from "./components/ClipperDetail";
import ClipSearch from "./components/ClipSearch";
import GeneralThread from "./components/GeneralThread";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClipRanking />} />
        <Route path="/broadcasters" element={<BroadcasterList />} />
        <Route path="/clips/:id" element={<ClipDetail />} />
        <Route path="/broadcasters/:name" element={<BroadcasterDetail />} />
        <Route path="/my-reactions" element={<MyReactions />} />
        <Route path="/favorites" element={<MyFavorites />} />
        <Route path="/clippers" element={<ClipperList />} />
        <Route path="/clippers/:creatorId" element={<ClipperDetail />} />
        <Route path="/search" element={<ClipSearch />} />
        <Route path="/general" element={<GeneralThread />} />
      </Routes>
    </BrowserRouter>
  );
}
