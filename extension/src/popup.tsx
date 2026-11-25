// Toolbar panel: shows SAQR's risk score for the open tab.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { ExtensionMessage, PanelStatus } from "./messages";
import Panel from "./Panel";
import css from "./styles.css?inline";

function PopupApp() {
  const [status, setStatus] = useState<PanelStatus | null>(null);
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (!tab?.url) return { kind: "skipped" } as PanelStatus;
        const message: ExtensionMessage = { type: "saqr:status", url: tab.url };
        return chrome.runtime.sendMessage(message) as Promise<PanelStatus>;
      })
      .then(setStatus, () => setStatus({ kind: "skipped" }));
  }, []);
  return <Panel status={status} />;
}

const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<PopupApp />);
