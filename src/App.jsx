import { BrowserRouter, Routes, Route } from "react-router-dom";
import ClipRanking from "./components/ClipRanking";
import BroadcasterList from "./components/BroadcasterList";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClipRanking />} />
        <Route path="/broadcasters" element={<BroadcasterList />} />
      </Routes>
    </BrowserRouter>
  );
}
