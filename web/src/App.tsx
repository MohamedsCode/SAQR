import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import CheckPage from "./pages/citizen/CheckPage";
import Operations from "./pages/Operations";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/check" element={<CheckPage />} />
        <Route path="/" element={<Layout><Operations /></Layout>} />
      </Routes>
    </BrowserRouter>
  );
}
