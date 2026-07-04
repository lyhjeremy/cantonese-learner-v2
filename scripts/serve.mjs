// Minimal static file server for the frontend (dev + e2e). No dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../frontend/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path === "/") path = "/index.html";
      const filePath = normalize(join(ROOT, path));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": TYPES[extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}

// Run directly: `npm run serve`. Use pathToFileURL so paths containing spaces
// (e.g. "My Drive/…") compare correctly against the percent-encoded import URL.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 5173;
  startServer(port).then(({ port }) => console.log(`serving frontend at http://localhost:${port}`));
}
