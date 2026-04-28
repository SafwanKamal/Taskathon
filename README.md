# Taskathon Notion Lite

A small local Notion-style workspace with nested pages, editable content blocks, tables, search, a JSON file store, and API endpoints designed so an MCP server can wrap them as tools and resources.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

Data is stored in `data/workspace.json`. To use another location:

```bash
DATA_PATH=/tmp/workspace.json npm run dev
```

## Test

```bash
npm test
```

## MCP server for Ollmcp Desktop GUI

Taskathon includes a small dependency-free Streamable HTTP MCP adapter. Run the Taskathon app first:

```bash
npm run dev
```

Then run the MCP adapter in another terminal:

```bash
npm run mcp
```

The MCP endpoint is:

```text
http://127.0.0.1:8000/mcp
```

Use that as `mcpServerBaseUrl` in Ollmcp Desktop GUI.

Configuration:

```bash
TASKATHON_URL=http://127.0.0.1:3000 MCP_PORT=8000 npm run mcp
```

Optional token auth is supported with `?token=`:

```bash
TASKATHON_MCP_TOKEN=local-secret npm run mcp
```

Then configure Ollmcp with:

```text
http://127.0.0.1:8000/mcp?token=local-secret
```

MCP tools exposed by the adapter:

- `get_workspace`
- `search_workspace`
- `get_page`
- `create_page`
- `update_page`
- `archive_page`
- `create_block`
- `update_block`
- `delete_block`

## macOS app bundle

Build a local `.app` wrapper:

```bash
npm run build:mac
```

Build prerequisites:

- Node.js 20 or newer
- Xcode Command Line Tools with `swiftc`
- Google Chrome at `/Applications/Google Chrome.app` for icon rendering

The app is written to:

```text
build/Taskathon.app
```

When opened, it starts:

- Taskathon UI/API at `http://127.0.0.1:3000`
- Taskathon MCP at `http://127.0.0.1:8000/mcp`

Use this MCP URL in Ollmcp Desktop GUI while `Taskathon.app` is running:

```text
http://127.0.0.1:8000/mcp
```

The local app bundle is unsigned and not notarized. It is intended for local development and personal use.

The `.app` stores editable workspace data at:

```text
~/Library/Application Support/Taskathon/workspace.json
```

## API

- `GET /api/health`
- `GET /api/workspace`
- `GET /api/pages`
- `POST /api/pages`
- `GET /api/pages/:id`
- `PATCH /api/pages/:id`
- `DELETE /api/pages/:id`
- `POST /api/pages/:id/blocks`
- `PATCH /api/blocks/:id`
- `DELETE /api/blocks/:id`
- `GET /api/search?q=query`
- `GET /api/mcp/manifest`

Blocks support `paragraph`, `heading`, `bulleted`, `todo`, `quote`, and `table`. Table blocks use a structured `data` payload:

```json
{
  "columns": ["Name", "Status"],
  "rows": [["MCP wrapper", "Next"]]
}
```

The manifest describes the API in tool/resource terms so a separate MCP server can map each endpoint to tool handlers without needing to know the UI.
