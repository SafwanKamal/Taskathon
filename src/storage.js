import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();

const makePage = ({ title = "Untitled", icon = "doc", parentId = null } = {}) => ({
  id: randomUUID(),
  title: String(title || "Untitled").trim() || "Untitled",
  icon,
  parentId,
  archived: false,
  createdAt: now(),
  updatedAt: now()
});

const defaultTableData = () => ({
  columns: ["Name", "Status", "Notes"],
  columnWidths: [220, 180, 280],
  rows: [
    ["MCP wrapper", "Next", "Map manifest tools to handlers"],
    ["Local data", "Done", "Persist workspace JSON on disk"]
  ]
});

const makeBlock = ({ pageId, type = "paragraph", content = "", checked = false, order = 0, data = null } = {}) => ({
  id: randomUUID(),
  pageId,
  type,
  content: String(content ?? ""),
  checked: Boolean(checked),
  data: normalizeBlockData(type, data),
  order,
  createdAt: now(),
  updatedAt: now()
});

export function createInitialData() {
  const home = makePage({ title: "Workspace Home", icon: "home" });
  const project = makePage({ title: "Project Notes", icon: "spark", parentId: home.id });
  const journal = makePage({ title: "Daily Notes", icon: "calendar", parentId: home.id });

  const blocks = [
    makeBlock({ pageId: home.id, type: "heading", content: "Local workspace", order: 0 }),
    makeBlock({
      pageId: home.id,
      type: "paragraph",
      content: "A lightweight Notion-style editor with page nesting, blocks, search, and API endpoints ready for MCP tooling.",
      order: 1
    }),
    makeBlock({ pageId: home.id, type: "todo", content: "Create a page from the sidebar", order: 2 }),
    makeBlock({ pageId: home.id, type: "todo", content: "Use the API from an AI tool", checked: true, order: 3 }),
    makeBlock({ pageId: home.id, type: "table", content: "Example table", data: defaultTableData(), order: 4 }),
    makeBlock({ pageId: project.id, type: "heading", content: "Project plan", order: 0 }),
    makeBlock({ pageId: project.id, type: "bulleted", content: "Keep storage local and inspectable", order: 1 }),
    makeBlock({ pageId: journal.id, type: "paragraph", content: "Capture notes, decisions, and loose thoughts here.", order: 0 })
  ];

  return { pages: [home, project, journal], blocks, updatedAt: now() };
}

export class WorkspaceStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.data = createInitialData();
      await this.save();
    }

    return this.data;
  }

  async save() {
    this.data.updatedAt = now();
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }

  async withWriteLock(action) {
    const run = async () => {
      await this.load();
      return action();
    };
    const result = this.writeChain.then(run, run);
    this.writeChain = result.then(() => undefined, () => undefined);
    return result;
  }

  async getSnapshot({ includeArchived = false } = {}) {
    await this.load();
    const pages = includeArchived ? this.data.pages : this.data.pages.filter((page) => !page.archived);
    const pageIds = new Set(pages.map((page) => page.id));
    return {
      updatedAt: this.data.updatedAt,
      pages,
      blocks: this.data.blocks.filter((block) => pageIds.has(block.pageId)).sort(sortBlocks)
    };
  }

  async getPage(pageId) {
    await this.load();
    const page = this.data.pages.find((candidate) => candidate.id === pageId && !candidate.archived);
    if (!page) return null;
    return {
      page,
      blocks: this.data.blocks.filter((block) => block.pageId === pageId).sort(sortBlocks)
    };
  }

  async createPage(input = {}) {
    return this.withWriteLock(async () => {
      const page = makePage(input);
      this.data.pages.push(page);
      if (input.seed !== false) {
        this.data.blocks.push(makeBlock({ pageId: page.id, type: "paragraph", content: "", order: 0 }));
      }
      await this.save();
      return page;
    });
  }

  async updatePage(pageId, patch = {}) {
    return this.withWriteLock(async () => {
      const page = this.data.pages.find((candidate) => candidate.id === pageId && !candidate.archived);
      if (!page) return null;

      if (typeof patch.title === "string") page.title = patch.title.trim() || "Untitled";
      if (typeof patch.icon === "string") page.icon = patch.icon;
      if ("parentId" in patch) page.parentId = patch.parentId || null;
      page.updatedAt = now();
      await this.save();
      return page;
    });
  }

  async archivePage(pageId) {
    return this.withWriteLock(async () => {
      const page = this.data.pages.find((candidate) => candidate.id === pageId);
      if (!page) return false;
      const descendantIds = this.getDescendantPageIds(pageId);
      for (const candidate of this.data.pages) {
        if (candidate.id === pageId || descendantIds.has(candidate.id)) {
          candidate.archived = true;
          candidate.updatedAt = now();
        }
      }
      await this.save();
      return true;
    });
  }

  getDescendantPageIds(pageId) {
    const descendants = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const page of this.data.pages) {
        const parentMatches = page.parentId === pageId || descendants.has(page.parentId);
        if (parentMatches && !descendants.has(page.id)) {
          descendants.add(page.id);
          changed = true;
        }
      }
    }
    return descendants;
  }

  async createBlock(pageId, input = {}) {
    return this.withWriteLock(async () => {
      const page = this.data.pages.find((candidate) => candidate.id === pageId && !candidate.archived);
      if (!page) return null;
      const order = Number.isFinite(input.order) ? input.order : this.nextBlockOrder(pageId);
      const block = makeBlock({ ...input, pageId, order });
      this.data.blocks.push(block);
      page.updatedAt = now();
      await this.save();
      return block;
    });
  }

  async updateBlock(blockId, patch = {}) {
    return this.withWriteLock(async () => {
      const block = this.data.blocks.find((candidate) => candidate.id === blockId);
      if (!block) return null;
      if (typeof patch.type === "string") {
        block.type = patch.type;
        block.data = normalizeBlockData(block.type, block.data);
      }
      if ("content" in patch) block.content = String(patch.content ?? "");
      if ("checked" in patch) block.checked = Boolean(patch.checked);
      if ("data" in patch) block.data = normalizeBlockData(block.type, patch.data);
      if (Number.isFinite(patch.order)) block.order = patch.order;
      block.updatedAt = now();
      const page = this.data.pages.find((candidate) => candidate.id === block.pageId);
      if (page) page.updatedAt = now();
      await this.save();
      return block;
    });
  }

  async deleteBlock(blockId) {
    return this.withWriteLock(async () => {
      const index = this.data.blocks.findIndex((candidate) => candidate.id === blockId);
      if (index === -1) return false;
      this.data.blocks.splice(index, 1);
      await this.save();
      return true;
    });
  }

  async search(query) {
    await this.load();
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return { pages: [], blocks: [] };
    const activePageIds = new Set(this.data.pages.filter((page) => !page.archived).map((page) => page.id));
    return {
      pages: this.data.pages.filter((page) => !page.archived && page.title.toLowerCase().includes(needle)),
      blocks: this.data.blocks.filter((block) => activePageIds.has(block.pageId) && blockMatches(block, needle)).sort(sortBlocks)
    };
  }

  nextBlockOrder(pageId) {
    const orders = this.data.blocks.filter((block) => block.pageId === pageId).map((block) => block.order);
    return orders.length ? Math.max(...orders) + 1 : 0;
  }
}

function sortBlocks(a, b) {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

function normalizeBlockData(type, data) {
  if (type !== "table") return null;
  if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return defaultTableData();

  const columns = data.columns.map((column) => String(column ?? "")).slice(0, 12);
  const safeColumns = columns.length ? columns : ["Column 1"];
  const sourceWidths = Array.isArray(data.columnWidths) ? data.columnWidths : [];
  const columnWidths = safeColumns.map((column, index) => {
    const width = Number(sourceWidths[index]);
    if (Number.isFinite(width)) return Math.max(140, Math.min(720, Math.round(width)));
    return Math.max(180, Math.min(360, column.length * 9 + 96));
  });
  const rows = data.rows
    .filter((row) => Array.isArray(row))
    .slice(0, 100)
    .map((row) => safeColumns.map((_, index) => String(row[index] ?? "")));

  return {
    columns: safeColumns,
    columnWidths,
    rows: rows.length ? rows : [safeColumns.map(() => "")]
  };
}

function blockMatches(block, needle) {
  if (block.content.toLowerCase().includes(needle)) return true;
  if (block.type !== "table" || !block.data) return false;
  const tableText = [...block.data.columns, ...block.data.rows.flat()].join(" ").toLowerCase();
  return tableText.includes(needle);
}
