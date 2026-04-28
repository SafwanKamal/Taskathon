import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { WorkspaceStore } from "../src/storage.js";

async function withTempStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "notion-lite-"));
  try {
    const store = new WorkspaceStore(join(dir, "workspace.json"));
    await store.load();
    await run(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("creates pages, blocks, and searchable content", async () => {
  await withTempStore(async (store) => {
    const initialSnapshot = await store.getSnapshot();
    assert.equal(typeof initialSnapshot.updatedAt, "string");
    const page = await store.createPage({ title: "Launch Plan", icon: "spark", seed: false });
    const block = await store.createBlock(page.id, { type: "todo", content: "Draft MCP wrapper", checked: false });

    const search = await store.search("mcp");
    assert.equal(search.pages.length, 0);
    assert.equal(search.blocks[0].id, block.id);

    const updated = await store.updateBlock(block.id, { checked: true });
    assert.equal(updated.checked, true);
  });
});

test("archiving a parent page hides descendants from snapshots", async () => {
  await withTempStore(async (store) => {
    const parent = await store.createPage({ title: "Parent", seed: false });
    const child = await store.createPage({ title: "Child", parentId: parent.id, seed: false });

    await store.archivePage(parent.id);

    const snapshot = await store.getSnapshot();
    assert.equal(snapshot.pages.some((page) => page.id === parent.id), false);
    assert.equal(snapshot.pages.some((page) => page.id === child.id), false);
  });
});

test("archiving an already archived page is idempotent", async () => {
  await withTempStore(async (store) => {
    const page = await store.createPage({ title: "Archive me", seed: false });

    assert.equal(await store.archivePage(page.id), true);
    assert.equal(await store.archivePage(page.id), true);
    assert.equal(await store.getPage(page.id), null);
  });
});

test("table blocks keep structured data and are searchable by cell text", async () => {
  await withTempStore(async (store) => {
    const page = await store.createPage({ title: "Tables", seed: false });
    const block = await store.createBlock(page.id, {
      type: "table",
      content: "Roadmap",
      data: {
        columns: ["Feature", "Owner"],
        columnWidths: [260, 180],
        rows: [["Tables", "Safwan"]]
      }
    });

    assert.deepEqual(block.data.columns, ["Feature", "Owner"]);
    assert.deepEqual(block.data.columnWidths, [260, 180]);
    assert.deepEqual(block.data.rows, [["Tables", "Safwan"]]);

    const updated = await store.updateBlock(block.id, {
      data: {
        columns: ["Feature", "Owner", "Status"],
        columnWidths: [320, 180, 220],
        rows: [["Tables", "Safwan", "Shipped"]]
      }
    });
    assert.equal(updated.data.rows[0][2], "Shipped");
    assert.deepEqual(updated.data.columnWidths, [320, 180, 220]);

    const search = await store.search("shipped");
    assert.equal(search.blocks[0].id, block.id);
  });
});
