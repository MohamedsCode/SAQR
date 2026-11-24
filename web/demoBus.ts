import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// A tiny in-memory event relay for the live demo: the dashboard and the phone simulator both subscribe to
// /demo-bus/events (Server-Sent Events) and publish with POST /demo-bus/emit. It runs inside the Vite dev server,
// so it needs nothing beyond `npm run dev` and never leaves the laptop's network.
export function demoBus(): Plugin {
  const clients = new Set<ServerResponse>();

  function broadcast(payload: string) {
    for (const client of clients) client.write(`data: ${payload}\n\n`);
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 10_000) reject(new Error("Event too large"));
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  return {
    name: "saqr-demo-bus",
    configureServer(server) {
      server.middlewares.use("/demo-bus/events", (req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
        req.on("close", () => {
          clearInterval(keepAlive);
          clients.delete(res);
        });
      });

      server.middlewares.use("/demo-bus/emit", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const event = JSON.parse(await readBody(req));
          if (typeof event?.type !== "string") throw new Error("Missing event type");
          broadcast(JSON.stringify({ ...event, at: new Date().toISOString() }));
          res.statusCode = 204;
          res.end();
        } catch {
          res.statusCode = 400;
          res.end();
        }
      });
    },
  };
}
