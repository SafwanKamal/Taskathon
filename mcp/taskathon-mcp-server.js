import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const protocolVersion = "2025-03-26";
const taskathonUrl = (process.env.TASKATHON_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const port = Number(process.env.MCP_PORT || 8000);
const host = process.env.MCP_HOST || "127.0.0.1";
const requiredToken = process.env.TASKATHON_MCP_TOKEN || "";

const tools = [
  {
    name: "get_workspace",
    description: "Return all active Taskathon pages and blocks.",
    inputSchema: objectSchema({})
  },
  {
    name: "search_workspace",
    description: "Search active Taskathon pages and blocks by text.",
    inputSchema: objectSchema({
      query: { type: "string", description: "Search query." }
    }, ["query"])
  },
  {
    name: "get_page",
    description: "Return one page and its blocks.",
    inputSchema: objectSchema({
      pageId: { type: "string", description: "Taskathon page id." }
    }, ["pageId"])
  },
  {
    name: "create_page",
    description: "Create a new page.",
    inputSchema: objectSchema({
      title: { type: "string" },
      icon: { type: "string", description: "Optional icon key: doc, home, spark, calendar, note." },
      parentId: { type: ["string", "null"], description: "Optional parent page id." },
      seed: { type: "boolean", description: "Whether to seed the page with an empty paragraph." }
    }, ["title"])
  },
  {
    name: "update_page",
    description: "Update page metadata.",
    inputSchema: objectSchema({
      pageId: { type: "string" },
      title: { type: "string" },
      icon: { type: "string" },
      parentId: { type: ["string", "null"] }
    }, ["pageId"])
  },
  {
    name: "archive_page",
    description: "Archive a page and its descendants.",
    inputSchema: objectSchema({
      pageId: { type: "string" }
    }, ["pageId"])
  },
  {
    name: "create_block",
    description: "Create a block on a page. Supported types: paragraph, heading, bulleted, todo, quote, table.",
    inputSchema: objectSchema({
      pageId: { type: "string" },
      type: { type: "string" },
      content: { type: "string" },
      checked: { type: "boolean" },
      order: { type: "number" },
      data: { type: ["object", "null"], description: "Structured table data for table blocks." }
    }, ["pageId", "type"])
  },
  {
    name: "update_block",
    description: "Update a block.",
    inputSchema: objectSchema({
      blockId: { type: "string" },
      type: { type: "string" },
      content: { type: "string" },
      checked: { type: "boolean" },
      order: { type: "number" },
      data: { type: ["object", "null"], description: "Structured table data for table blocks." }
    }, ["blockId"])
  },
  {
    name: "delete_block",
    description: "Delete a block.",
    inputSchema: objectSchema({
      blockId: { type: "string" }
    }, ["blockId"])
  }
];

const resources = [
  {
    uri: "taskathon://workspace",
    name: "Taskathon workspace",
    description: "All active pages and blocks in the local Taskathon workspace.",
    mimeType: "application/json"
  }
];

export async function handleMcpRequest(message, options = {}) {
  if (Array.isArray(message)) {
    const responses = [];
    for (const item of message) {
      const response = await handleOne(item, options);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return handleOne(message, options);
}

async function handleOne(message, options) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return errorResponse(message?.id ?? null, -32600, "Invalid Request");
  }

  const id = message.id;
  const params = message.params || {};

  try {
    switch (message.method) {
      case "initialize":
        return resultResponse(id, {
          protocolVersion,
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "taskathon-notion-lite",
            version: "0.1.0"
          }
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return resultResponse(id, {});
      case "tools/list":
        return resultResponse(id, { tools });
      case "tools/call":
        return resultResponse(id, await callTool(params.name, params.arguments || {}, options));
      case "resources/list":
        return resultResponse(id, { resources });
      case "resources/read":
        return resultResponse(id, await readResource(params.uri, options));
      case "prompts/list":
        return resultResponse(id, { prompts: [] });
      default:
        return errorResponse(id, -32601, `Method not found: ${message.method}`);
    }
  } catch (error) {
    return errorResponse(id, -32603, error.message || "Internal error");
  }
}

async function callTool(name, args, options) {
  switch (name) {
    case "get_workspace":
      return toolJson(await taskathonFetch("/api/workspace", {}, options));
    case "search_workspace":
      return toolJson(await taskathonFetch(`/api/search?q=${encodeURIComponent(requiredString(args.query, "query"))}`, {}, options));
    case "get_page":
      return toolJson(await taskathonFetch(`/api/pages/${encodeURIComponent(requiredString(args.pageId, "pageId"))}`, {}, options));
    case "create_page":
      return toolJson(await taskathonFetch("/api/pages", postJson(pick(args, ["title", "icon", "parentId", "seed"])), options));
    case "update_page": {
      const pageId = requiredString(args.pageId, "pageId");
      return toolJson(await taskathonFetch(`/api/pages/${encodeURIComponent(pageId)}`, patchJson(pick(args, ["title", "icon", "parentId"])), options));
    }
    case "archive_page":
      await taskathonFetch(`/api/pages/${encodeURIComponent(requiredString(args.pageId, "pageId"))}`, { method: "DELETE" }, options);
      return toolText("Page archived.");
    case "create_block": {
      const pageId = requiredString(args.pageId, "pageId");
      return toolJson(await taskathonFetch(`/api/pages/${encodeURIComponent(pageId)}/blocks`, postJson(pick(args, ["type", "content", "checked", "order", "data"])), options));
    }
    case "update_block": {
      const blockId = requiredString(args.blockId, "blockId");
      return toolJson(await taskathonFetch(`/api/blocks/${encodeURIComponent(blockId)}`, patchJson(pick(args, ["type", "content", "checked", "order", "data"])), options));
    }
    case "delete_block":
      await taskathonFetch(`/api/blocks/${encodeURIComponent(requiredString(args.blockId, "blockId"))}`, { method: "DELETE" }, options);
      return toolText("Block deleted.");
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function readResource(uri, options) {
  if (uri !== "taskathon://workspace") throw new Error(`Unknown resource: ${uri}`);
  const workspace = await taskathonFetch("/api/workspace", {}, options);
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(workspace, null, 2)
      }
    ]
  };
}

async function taskathonFetch(path, init = {}, options = {}) {
  const baseUrl = options.taskathonUrl || taskathonUrl;
  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "accept": "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });

  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.error || `Taskathon API returned ${response.status}`);
  return payload;
}

function postJson(body) {
  return { method: "POST", body: JSON.stringify(body) };
}

function patchJson(body) {
  return { method: "PATCH", body: JSON.stringify(body) };
}

function toolJson(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toolText(text) {
  return { content: [{ type: "text", text }] };
}

function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (key in source) result[key] = source[key];
  }
  return result;
}

function requiredString(value, key) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required argument: ${key}`);
  return value;
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function resultResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

function tokenAllowed(req, url) {
  if (!requiredToken) return true;
  const queryToken = url.searchParams.get("token");
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return queryToken === requiredToken || bearer === requiredToken;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  });
  res.end(payload === undefined ? "" : JSON.stringify(payload));
}

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "OPTIONS") return sendJson(res, 204);
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "taskathon-mcp" });
    if (url.pathname !== "/mcp") return sendJson(res, 404, { error: "Not found" });
    if (!tokenAllowed(req, url)) return sendJson(res, 401, { error: "Unauthorized" });
    if (req.method !== "POST") return sendJson(res, 405, { error: "MCP endpoint expects HTTP POST" });

    try {
      const body = await readRequestJson(req);
      const response = await handleMcpRequest(body);
      if (response === null) return sendJson(res, 202);
      return sendJson(res, 200, response);
    } catch (error) {
      return sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error.message || "Parse error" }
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`Taskathon MCP server running at http://${host}:${port}/mcp`);
    console.log(`Forwarding tools to ${taskathonUrl}`);
  });
}

async function readRequestJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) throw new Error("Empty request body");
  return JSON.parse(raw);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer();
}
