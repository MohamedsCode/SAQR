import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import CaseDetail from "./pages/CaseDetail";
import CheckPage from "./pages/citizen/CheckPage";
import Dashboard from "./pages/Dashboard";
import ModelPage from "./pages/ModelPage";
import PhonePage from "./pages/phone/PhonePage";
import ScanLink from "./pages/ScanLink";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/check" element={<CheckPage />} />
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/cases/:id" element={<Layout><CaseDetail /></Layout>} />
        <Route path="/scan" element={<Layout><ScanLink /></Layout>} />
        <Route path="/model" element={<Layout><ModelPage /></Layout>} />
        <Route path="/demo/phone" element={<PhonePage />} />
      </Routes>
    </BrowserRouter>
  );
}
