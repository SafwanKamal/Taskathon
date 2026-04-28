import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.js";
import { WorkspaceStore } from "./storage.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const dataPath = process.env.DATA_PATH || join(root, "data", "workspace.json");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const store = new WorkspaceStore(dataPath);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res, store);
  return serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Taskathon Notion Lite running at http://${host}:${port}`);
});

async function serveStatic(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = normalize(join(publicDir, requestedPath));

    if (!filePath.startsWith(`${publicDir}/`) && filePath !== publicDir) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error instanceof URIError) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Bad request");
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}
