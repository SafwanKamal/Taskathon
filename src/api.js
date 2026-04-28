const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export async function handleApi(req, res, store) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    if (req.method === "GET" && path === "/api/health") {
      return send(res, 200, { ok: true, service: "taskathon-notion-lite" });
    }

    if (req.method === "GET" && path === "/api/workspace") {
      return send(res, 200, await store.getSnapshot());
    }

    if (req.method === "GET" && path === "/api/pages") {
      const snapshot = await store.getSnapshot();
      return send(res, 200, snapshot.pages);
    }

    if (req.method === "POST" && path === "/api/pages") {
      const body = await readJson(req);
      return send(res, 201, await store.createPage(body));
    }

    const pageMatch = path.match(/^\/api\/pages\/([^/]+)$/);
    if (pageMatch && req.method === "GET") {
      const page = await store.getPage(pageMatch[1]);
      return page ? send(res, 200, page) : sendError(res, 404, "Page not found");
    }

    if (pageMatch && req.method === "PATCH") {
      const page = await store.updatePage(pageMatch[1], await readJson(req));
      return page ? send(res, 200, page) : sendError(res, 404, "Page not found");
    }

    if (pageMatch && req.method === "DELETE") {
      const deleted = await store.archivePage(pageMatch[1]);
      return deleted ? send(res, 204) : sendError(res, 404, "Page not found");
    }

    const blockCollectionMatch = path.match(/^\/api\/pages\/([^/]+)\/blocks$/);
    if (blockCollectionMatch && req.method === "POST") {
      const block = await store.createBlock(blockCollectionMatch[1], await readJson(req));
      return block ? send(res, 201, block) : sendError(res, 404, "Page not found");
    }

    const blockMatch = path.match(/^\/api\/blocks\/([^/]+)$/);
    if (blockMatch && req.method === "PATCH") {
      const block = await store.updateBlock(blockMatch[1], await readJson(req));
      return block ? send(res, 200, block) : sendError(res, 404, "Block not found");
    }

    if (blockMatch && req.method === "DELETE") {
      const deleted = await store.deleteBlock(blockMatch[1]);
      return deleted ? send(res, 204) : sendError(res, 404, "Block not found");
    }

    if (req.method === "GET" && path === "/api/search") {
      return send(res, 200, await store.search(url.searchParams.get("q")));
    }

    if (req.method === "GET" && path === "/api/mcp/manifest") {
      return send(res, 200, mcpManifest());
    }

    return sendError(res, 404, "Endpoint not found");
  } catch (error) {
    if (error.name === "SyntaxError") return sendError(res, 400, "Invalid JSON");
    console.error(error);
    return sendError(res, 500, "Internal server error");
  }
}

function mcpManifest() {
  return {
    name: "Taskathon Notion Lite",
    description: "Local workspace API that can be wrapped by an MCP server.",
    resources: [
      { name: "workspace", method: "GET", path: "/api/workspace" },
      { name: "page", method: "GET", path: "/api/pages/:id" },
      { name: "search", method: "GET", path: "/api/search?q=:query" }
    ],
    tools: [
      { name: "create_page", method: "POST", path: "/api/pages", input: ["title", "icon", "parentId", "seed"] },
      { name: "update_page", method: "PATCH", path: "/api/pages/:id", input: ["title", "icon", "parentId"] },
      { name: "archive_page", method: "DELETE", path: "/api/pages/:id" },
      { name: "create_block", method: "POST", path: "/api/pages/:id/blocks", input: ["type", "content", "checked", "order", "data"] },
      { name: "update_block", method: "PATCH", path: "/api/blocks/:id", input: ["type", "content", "checked", "order", "data"] },
      { name: "delete_block", method: "DELETE", path: "/api/blocks/:id" }
    ]
  };
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendError(res, status, message) {
  return send(res, status, { error: message });
}

function send(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  if (status === 204) return res.end();
  res.end(JSON.stringify(payload));
}
