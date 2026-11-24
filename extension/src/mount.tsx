import { createRoot } from "react-dom/client";
import type { CheckOutcome } from "./messages";
import css from "./styles.css?inline";
import Warning, { type WarningActions } from "./Warning";

/**
 * Render a warning inside a Shadow DOM so the page's CSS cannot restyle it and its CSS cannot leak into the page.
 * The dialog portal lives in the same shadow root, so Radix's overlay and focus trap stay isolated too.
 * Returns a function that removes the warning immediately.
 */
export function mountWarning(outcome: Exclude<CheckOutcome, { kind: "none" }>, actions: WarningActions): () => void {
  const host = document.createElement("saqr-warning");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const app = document.createElement("div");
  const portal = document.createElement("div");
  shadow.append(style, app, portal);
  document.documentElement.append(host);

  const root = createRoot(app);
  const remove = () => {
    root.unmount();
    host.remove();
  };
  root.render(<Warning outcome={outcome} actions={actions} portal={portal} onClosed={remove} />);
  return remove;
}
