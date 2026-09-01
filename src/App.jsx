import { BrowserRouter, Routes, Route } from "react-router-dom";
import ClipRanking from "./components/ClipRanking";
import BroadcasterList from "./components/BroadcasterList";
import ClipDetail from "./components/ClipDetail";
import BroadcasterDetail from "./components/BroadcasterDetail";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClipRanking />} />
        <Route path="/broadcasters" element={<BroadcasterList />} />
        <Route path="/clips/:id" element={<ClipDetail />} />
        <Route path="/broadcasters/:name" element={<BroadcasterDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
