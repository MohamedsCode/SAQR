import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { TourProvider } from "./components/Tour";
import CaseDetail from "./pages/CaseDetail";
import CasesPage from "./pages/CasesPage";
import CheckPage from "./pages/citizen/CheckPage";
import Dashboard from "./pages/Dashboard";
import DetectionPage from "./pages/DetectionPage";
import HelplinesPage from "./pages/HelplinesPage";
import ModelPage from "./pages/ModelPage";
import NetworksPage from "./pages/NetworksPage";
import PhonePage from "./pages/phone/PhonePage";
import ScanLink from "./pages/ScanLink";

export default function App() {
  return (
    <BrowserRouter>
      <TourProvider>
        <Routes>
          <Route path="/check" element={<CheckPage />} />
          <Route path="/demo/phone" element={<PhonePage />} />
          <Route path="/" element={<Layout><Dashboard /></Layout>} />
          <Route path="/detection" element={<Layout><DetectionPage /></Layout>} />
          <Route path="/helplines" element={<Layout><HelplinesPage /></Layout>} />
          <Route path="/cases" element={<Layout><CasesPage /></Layout>} />
          <Route path="/cases/:id" element={<Layout><CaseDetail /></Layout>} />
          <Route path="/networks" element={<Layout><NetworksPage /></Layout>} />
          <Route path="/networks/:id" element={<Layout><NetworksPage /></Layout>} />
          <Route path="/scan" element={<Layout><ScanLink /></Layout>} />
          <Route path="/model" element={<Layout><ModelPage /></Layout>} />
        </Routes>
      </TourProvider>
    </BrowserRouter>
  );
}
