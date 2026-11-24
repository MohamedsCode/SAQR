// Content script: asks the background worker about this page and shows a warning when needed.
import type { CheckOutcome, ExtensionMessage } from "./messages";
import { mountWarning } from "./mount";

function send(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

send({ type: "saqr:check", url: location.href })
  .then((outcome) => {
    const result = outcome as CheckOutcome;
    if (result.kind === "none") return;
    mountWarning(result, {
      onLeave: () => void send({ type: "saqr:leave" }),
      onContinue: () => void send({ type: "saqr:bypass", host: location.hostname }),
    });
  })
  .catch(() => {
    // The extension was reloaded or updated while this page was open: nothing to show.
  });
