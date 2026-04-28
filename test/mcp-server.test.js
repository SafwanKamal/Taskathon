import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest } from "../mcp/taskathon-mcp-server.js";

test("mcp server initializes and lists taskathon tools", async () => {
  const initialized = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {}
  });

  assert.equal(initialized.result.serverInfo.name, "taskathon-notion-lite");
  assert.equal(initialized.result.capabilities.tools.constructor, Object);

  const listed = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });

  const toolNames = listed.result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("get_workspace"));
  assert.ok(toolNames.includes("create_block"));
  assert.ok(toolNames.includes("update_block"));
});

test("mcp server can call a taskathon-backed tool", async () => {
  const fetchMock = async (url) => {
    assert.equal(String(url), "mock://taskathon/api/search?q=roadmap");
    return new Response(JSON.stringify({ pages: [], blocks: [{ id: "block-1", content: "Roadmap result" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const response = await handleMcpRequest(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_workspace",
        arguments: { query: "roadmap" }
      }
    },
    {
      taskathonUrl: "mock://taskathon",
      fetch: fetchMock
    }
  );

  assert.equal(response.result.content[0].type, "text");
  assert.match(response.result.content[0].text, /Roadmap result/);
});
