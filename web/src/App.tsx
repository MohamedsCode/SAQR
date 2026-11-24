import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import CheckLink from "./pages/CheckLink";
import Operations from "./pages/Operations";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Operations />} />
          <Route path="/check" element={<CheckLink />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
