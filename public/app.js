const state = {
  pages: [],
  blocks: [],
  activePageId: null,
  search: "",
  draggingBlockId: null,
  updatedAt: null,
  syncing: false
};

if (new URLSearchParams(window.location.search).get("app") === "mac") {
  document.documentElement.classList.add("macos-app");
}

const icons = {
  doc: "□",
  home: "⌂",
  spark: "✦",
  calendar: "◷",
  note: "▤"
};

const slashCommands = {
  "//p": "paragraph",
  "//paragraph": "paragraph",
  "//h": "heading",
  "//heading": "heading",
  "//bullet": "bulleted",
  "//bulleted": "bulleted",
  "//todo": "todo",
  "//check": "todo",
  "//quote": "quote",
  "//table": "table"
};

const appShell = document.querySelector("#appShell");
const pageTree = document.querySelector("#pageTree");
const surface = document.querySelector("#editorSurface");
const crumb = document.querySelector("#crumb");
const searchInput = document.querySelector("#searchInput");
const newPageButton = document.querySelector("#newPageButton");
const sidebarToggle = document.querySelector("#sidebarToggle");
const commandNib = document.querySelector("#commandNib");
const commandPalette = document.querySelector("#commandPalette");
const closeCommandPalette = document.querySelector("#closeCommandPalette");
const viewportScrollbar = document.querySelector("#viewportScrollbar");
const viewportScrollbarThumb = viewportScrollbar?.querySelector(".app-scrollbar-thumb");

const tableDragState = {
  type: null,
  blockId: null,
  index: null,
  clickMode: false
};

await loadWorkspace();
setupSidebarToggle();
setupViewportScrollbar();
setupLiveSync();

newPageButton.addEventListener("click", async () => {
  const page = await api("/api/pages", {
    method: "POST",
    body: { title: "Untitled", icon: "doc", parentId: state.activePageId }
  });
  state.activePageId = page.id;
  await loadWorkspace();
});

searchInput.addEventListener("input", async (event) => {
  const query = event.target.value.trim();
  state.search = query;
  if (query) {
    await renderSearch(query);
  } else {
    renderEditor();
  }
});

commandNib.addEventListener("click", () => setCommandPaletteOpen(commandPalette.classList.contains("hidden")));
closeCommandPalette.addEventListener("click", () => setCommandPaletteOpen(false));

function setCommandPaletteOpen(open) {
  commandPalette.classList.toggle("hidden", !open);
  commandPalette.setAttribute("aria-hidden", String(!open));
  commandNib.setAttribute("aria-expanded", String(open));
}

function setupSidebarToggle() {
  if (!appShell || !sidebarToggle) return;
  const saved = localStorage.getItem("taskathon.sidebarCollapsed") === "true";
  setSidebarCollapsed(saved);
  sidebarToggle.addEventListener("click", () => {
    const collapsed = !appShell.classList.contains("sidebar-collapsed");
    setSidebarCollapsed(collapsed);
    localStorage.setItem("taskathon.sidebarCollapsed", String(collapsed));
  });
}

function setSidebarCollapsed(collapsed) {
  appShell.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggle.textContent = collapsed ? "›" : "‹";
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", collapsed ? "Show sidebar" : "Tuck sidebar away");
  sidebarToggle.title = collapsed ? "Show sidebar" : "Tuck sidebar away";
  requestAnimationFrame(updateViewportScrollbar);
}

async function loadWorkspace({ preserveSearch = false } = {}) {
  const workspace = await api("/api/workspace");
  const previousActivePageId = state.activePageId;
  state.pages = workspace.pages;
  state.blocks = workspace.blocks;
  state.updatedAt = workspace.updatedAt || null;
  state.activePageId = state.pages.some((page) => page.id === previousActivePageId)
    ? previousActivePageId
    : state.pages[0]?.id || null;
  renderPageTree();
  if (preserveSearch && state.search) {
    await renderSearch(state.search);
  } else {
    renderEditor();
  }
}

function setupLiveSync() {
  setInterval(refreshFromExternalChanges, 1200);
  window.addEventListener("focus", refreshFromExternalChanges);
}

async function refreshFromExternalChanges() {
  if (state.syncing || hasActiveEditor()) return;
  state.syncing = true;
  try {
    const workspace = await api("/api/workspace");
    if (!workspace.updatedAt || workspace.updatedAt === state.updatedAt) return;
    state.pages = workspace.pages;
    state.blocks = workspace.blocks;
    state.updatedAt = workspace.updatedAt;
    if (!state.pages.some((page) => page.id === state.activePageId)) {
      state.activePageId = state.pages[0]?.id || null;
    }
    renderPageTree();
    if (state.search) {
      await renderSearch(state.search);
    } else {
      renderEditor();
    }
  } catch (error) {
    console.warn("Live workspace sync failed", error);
  } finally {
    state.syncing = false;
  }
}

function hasActiveEditor() {
  const element = document.activeElement;
  if (!element) return false;
  return element.matches("input, textarea, select") || element.isContentEditable;
}

function renderPageTree() {
  pageTree.innerHTML = "";
  const roots = state.pages.filter((page) => !page.parentId);
  for (const page of roots) renderPageButton(page, 0);
  requestAnimationFrame(updateViewportScrollbar);
}

function renderPageButton(page, depth) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `page-link${page.id === state.activePageId ? " active" : ""}`;
  button.style.paddingLeft = `${8 + depth * 16}px`;
  button.innerHTML = `<span>${icons[page.icon] || icons.doc}</span><span></span>`;
  button.lastElementChild.textContent = page.title;
  button.addEventListener("click", () => {
    state.activePageId = page.id;
    searchInput.value = "";
    state.search = "";
    renderPageTree();
    renderEditor();
  });
  pageTree.append(button);

  for (const child of state.pages.filter((candidate) => candidate.parentId === page.id)) {
    renderPageButton(child, depth + 1);
  }
}

function renderEditor() {
  const page = activePage();
  if (!page) {
    surface.innerHTML = `<div class="empty-state">Create a page to start writing.</div>`;
    requestAnimationFrame(updateViewportScrollbar);
    return;
  }

  crumb.textContent = parentCrumb(page);
  surface.innerHTML = "";
  const titleRow = document.createElement("div");
  titleRow.className = "page-title-row";

  const iconSelect = document.createElement("select");
  iconSelect.className = "icon-picker";
  iconSelect.setAttribute("aria-label", "Page icon");
  for (const key of Object.keys(icons)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = icons[key];
    option.selected = page.icon === key;
    iconSelect.append(option);
  }
  iconSelect.addEventListener("change", () => savePage(page.id, { icon: iconSelect.value }));

  const title = document.createElement("input");
  title.className = "title-input";
  title.value = page.title;
  title.setAttribute("aria-label", "Page title");
  title.addEventListener("change", () => savePage(page.id, { title: title.value }));

  const archive = document.createElement("button");
  archive.type = "button";
  archive.className = "archive-button";
  archive.textContent = "Archive";
  archive.addEventListener("click", async () => {
    await api(`/api/pages/${page.id}`, { method: "DELETE" });
    state.activePageId = null;
    await loadWorkspace();
  });

  titleRow.append(iconSelect, title, archive);
  surface.append(titleRow);

  const blockList = document.createElement("div");
  blockList.className = "blocks";
  const pageBlocks = blocksForPage(page.id);
  blockList.append(renderInsertLine(page.id, pageBlocks, 0));
  for (const [index, block] of pageBlocks.entries()) {
    blockList.append(renderBlock(page.id, pageBlocks, block, index));
    blockList.append(renderInsertLine(page.id, pageBlocks, index + 1));
  }
  surface.append(blockList);
  requestAnimationFrame(updateViewportScrollbar);
}

function setupViewportScrollbar() {
  if (!viewportScrollbar || !viewportScrollbarThumb) return;

  let dragStartY = 0;
  let scrollStart = 0;

  const onPointerMove = (event) => {
    const scroller = document.scrollingElement;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const maxThumbTop = viewportScrollbar.clientHeight - viewportScrollbarThumb.offsetHeight;
    if (maxScroll <= 0 || maxThumbTop <= 0) return;

    const delta = event.clientY - dragStartY;
    scroller.scrollTop = scrollStart + (delta / maxThumbTop) * maxScroll;
  };

  const stopDrag = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", stopDrag);
  };

  viewportScrollbarThumb.addEventListener("pointerdown", (event) => {
    const scroller = document.scrollingElement;
    event.preventDefault();
    dragStartY = event.clientY;
    scrollStart = scroller.scrollTop;
    viewportScrollbarThumb.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDrag, { once: true });
  });

  viewportScrollbar.addEventListener("pointerdown", (event) => {
    if (event.target === viewportScrollbarThumb) return;
    const scroller = document.scrollingElement;
    const rect = viewportScrollbar.getBoundingClientRect();
    const thumbHeight = viewportScrollbarThumb.offsetHeight;
    const maxThumbTop = viewportScrollbar.clientHeight - thumbHeight;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 0 || maxThumbTop <= 0) return;
    const targetTop = Math.min(Math.max(0, event.clientY - rect.top - thumbHeight / 2), maxThumbTop);
    scroller.scrollTo({ top: (targetTop / maxThumbTop) * maxScroll, behavior: "smooth" });
  });

  window.addEventListener("scroll", updateViewportScrollbar, { passive: true });
  window.addEventListener("resize", updateViewportScrollbar);
  new ResizeObserver(updateViewportScrollbar).observe(document.body);
  updateViewportScrollbar();
}

function updateViewportScrollbar() {
  if (!viewportScrollbar || !viewportScrollbarThumb) return;
  const scroller = document.scrollingElement;
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  if (maxScroll <= 1) {
    viewportScrollbar.classList.remove("visible");
    return;
  }

  const trackHeight = viewportScrollbar.clientHeight;
  const thumbHeight = Math.max(36, Math.round((scroller.clientHeight / scroller.scrollHeight) * trackHeight));
  const maxThumbTop = trackHeight - thumbHeight;
  const thumbTop = Math.round((scroller.scrollTop / maxScroll) * maxThumbTop);
  viewportScrollbarThumb.style.height = `${thumbHeight}px`;
  viewportScrollbarThumb.style.transform = `translateY(${thumbTop}px)`;
  viewportScrollbar.classList.add("visible");
}

function renderBlock(pageId, pageBlocks, block, index) {
  const row = document.createElement("div");
  row.className = `block-row block-row-${block.type}`;
  row.dataset.blockId = block.id;

  const controls = renderMoveRail(pageId, pageBlocks, block.id, index);
  if (block.type === "table") {
    const tableSlot = renderTableBlock(block);
    row.append(controls, tableSlot, renderRemoveButton(block.id));
    return row;
  }

  const content = document.createElement("textarea");
  content.className = "block-content";
  content.dataset.type = block.type;
  content.value = block.content;
  content.rows = block.type === "heading" ? 1 : 2;
  content.setAttribute("aria-label", "Block content");
  content.addEventListener("input", () => autoSizeTextarea(content));
  content.addEventListener("change", () => updateTextBlock(block, content.value));
  requestAnimationFrame(() => autoSizeTextarea(content));

  const contentSlot = document.createElement("div");
  if (block.type === "todo") {
    contentSlot.className = "todo-wrap";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = block.checked;
    checkbox.setAttribute("aria-label", "Todo complete");
    checkbox.addEventListener("change", () => saveBlock(block.id, { checked: checkbox.checked }));
    contentSlot.append(checkbox, content);
  } else {
    contentSlot.append(content);
  }

  row.append(controls, contentSlot, renderRemoveButton(block.id));
  return row;
}

function renderInsertLine(pageId, pageBlocks, insertIndex) {
  const wrap = document.createElement("div");
  wrap.className = "insert-line";
  wrap.addEventListener("dragover", (event) => {
    if (!state.draggingBlockId) return;
    event.preventDefault();
    wrap.classList.add("active");
  });
  wrap.addEventListener("dragleave", () => wrap.classList.remove("active"));
  wrap.addEventListener("drop", async (event) => {
    if (!state.draggingBlockId) return;
    event.preventDefault();
    wrap.classList.remove("active");
    const nextIds = reorderedIds(pageBlocks.map((block) => block.id), state.draggingBlockId, insertIndex);
    state.draggingBlockId = null;
    await reorderPageBlocks(pageId, nextIds);
  });

  const button = document.createElement("button");
  button.type = "button";
  button.className = "insert-button";
  button.textContent = "+";
  button.setAttribute("aria-label", "Insert block here");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "insert-input";
  input.placeholder = "Type //heading, //table, or text";
  input.setAttribute("aria-label", "Insert block command");
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await createBlockFromLine(pageId, input.value, insertIndex);
  });
  input.addEventListener("change", () => createBlockFromLine(pageId, input.value, insertIndex));
  input.addEventListener("blur", () => {
    if (!input.value.trim()) wrap.classList.remove("open");
  });
  button.addEventListener("click", () => {
    wrap.classList.add("open");
    input.focus();
  });

  wrap.append(button, input);
  return wrap;
}

function renderMoveRail(pageId, pageBlocks, blockId, index) {
  const rail = document.createElement("div");
  rail.className = "move-rail";

  const up = document.createElement("button");
  up.type = "button";
  up.className = "move-button";
  up.textContent = "^";
  up.title = "Move block up";
  up.setAttribute("aria-label", "Move block up");
  up.disabled = index === 0;
  up.addEventListener("click", async () => moveBlockByStep(pageId, pageBlocks, blockId, -1));

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "drag-handle";
  handle.draggable = true;
  handle.textContent = "::";
  handle.title = "Drag to reorder";
  handle.setAttribute("aria-label", "Drag block");
  handle.addEventListener("dragstart", (event) => {
    state.draggingBlockId = blockId;
    event.dataTransfer.effectAllowed = "move";
  });
  handle.addEventListener("dragend", () => {
    state.draggingBlockId = null;
    document.querySelectorAll(".insert-line.active").forEach((line) => line.classList.remove("active"));
  });
  handle.addEventListener("keydown", async (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    await moveBlockByStep(pageId, pageBlocks, blockId, event.key === "ArrowUp" ? -1 : 1);
  });

  const down = document.createElement("button");
  down.type = "button";
  down.className = "move-button";
  down.textContent = "v";
  down.title = "Move block down";
  down.setAttribute("aria-label", "Move block down");
  down.disabled = index === pageBlocks.length - 1;
  down.addEventListener("click", async () => moveBlockByStep(pageId, pageBlocks, blockId, 1));

  rail.append(up, handle, down);
  return rail;
}

async function createBlockFromLine(pageId, value, insertIndex = null) {
  const raw = value.trim();
  if (!raw) return;
  const type = slashType(raw) || "paragraph";
  const pageBlocks = blocksForPage(pageId);
  await api(`/api/pages/${pageId}/blocks`, {
    method: "POST",
    body: {
      type,
      content: slashType(raw) ? defaultContent(type) : raw,
      order: blockOrderForInsert(pageBlocks, insertIndex)
    }
  });
  await loadWorkspace();
}

async function updateTextBlock(block, value) {
  const type = slashType(value.trim());
  if (type) {
    await saveBlock(block.id, { type, content: defaultContent(type) });
  } else {
    await saveBlock(block.id, { content: value });
  }
}

function slashType(value) {
  return slashCommands[value.toLowerCase()] || null;
}

function defaultContent(type) {
  return type === "table" ? "Table" : "";
}

function blockOrderForInsert(blocks, insertIndex) {
  if (insertIndex == null || !blocks.length) return blocks.length ? blocks.at(-1).order + 1 : 0;
  if (insertIndex <= 0) return blocks[0].order - 1;
  if (insertIndex >= blocks.length) return blocks.at(-1).order + 1;
  const before = blocks[insertIndex - 1].order;
  const after = blocks[insertIndex].order;
  return before + (after - before) / 2;
}

function reorderedIds(ids, movedId, insertIndex) {
  const filtered = ids.filter((id) => id !== movedId);
  filtered.splice(insertIndex, 0, movedId);
  return filtered;
}

async function reorderPageBlocks(pageId, orderedIds) {
  for (const [index, id] of orderedIds.entries()) {
    await api(`/api/blocks/${id}`, {
      method: "PATCH",
      body: { order: index }
    });
  }
  await loadWorkspace();
}

async function moveBlockByStep(pageId, pageBlocks, blockId, delta) {
  const ids = pageBlocks.map((block) => block.id);
  const currentIndex = ids.indexOf(blockId);
  const nextIndex = Math.max(0, Math.min(ids.length - 1, currentIndex + delta));
  if (nextIndex === currentIndex) return;
  await reorderPageBlocks(pageId, reorderedIds(ids, blockId, nextIndex));
}

function renderRemoveButton(blockId) {
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button";
  remove.title = "Delete block";
  remove.setAttribute("aria-label", "Delete block");
  remove.textContent = "×";
  remove.addEventListener("click", async () => {
    await api(`/api/blocks/${blockId}`, { method: "DELETE" });
    await loadWorkspace();
  });
  return remove;
}

function renderTableBlock(block) {
  const wrap = document.createElement("div");
  wrap.className = "table-block";
  const data = normalizedTable(block.data);

  const table = document.createElement("table");
  const colgroup = document.createElement("colgroup");
  const cornerCol = document.createElement("col");
  cornerCol.style.width = "34px";
  colgroup.append(cornerCol);
  data.columns.forEach((_, columnIndex) => {
    const col = document.createElement("col");
    col.style.width = `${data.columnWidths[columnIndex]}px`;
    colgroup.append(col);
  });
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "table-corner-cell";
  headerRow.append(corner);

  data.columns.forEach((column, columnIndex) => {
    const th = document.createElement("th");
    th.className = "table-column-target";
    th.dataset.columnIndex = String(columnIndex);
    attachTableDropHandlers(th, block.id, "column", columnIndex);
    th.append(renderColumnHandle(block.id, data, columnIndex));
    th.append(renderColumnResizeHandle(block.id, data, columnIndex, colgroup.children[columnIndex + 1]));
    const input = renderTableTextarea({
      value: column,
      ariaLabel: `Column ${columnIndex + 1} name`,
      className: "table-header-input",
      commandContext: { blockId: block.id, data, rowIndex: null, columnIndex },
      onCommit: (value) => {
        data.columns[columnIndex] = value;
        saveBlock(block.id, { data });
      }
    });
    th.append(input);
    headerRow.append(th);
  });
  thead.append(headerRow);

  const tbody = document.createElement("tbody");
  data.rows.forEach((cells, rowIndex) => {
    const tr = document.createElement("tr");
    tr.className = "table-row-target";
    tr.dataset.rowIndex = String(rowIndex);
    attachTableDropHandlers(tr, block.id, "row", rowIndex);
    const rowHandle = document.createElement("td");
    rowHandle.className = "table-row-handle-cell";
    rowHandle.append(renderRowHandle(block.id, data, rowIndex));
    tr.append(rowHandle);
    data.columns.forEach((_, columnIndex) => {
      const td = document.createElement("td");
      const input = renderTableTextarea({
        value: cells[columnIndex] || "",
        ariaLabel: `Row ${rowIndex + 1}, column ${columnIndex + 1}`,
        className: "table-cell-input",
        commandContext: { blockId: block.id, data, rowIndex, columnIndex },
        onCommit: (value) => {
          data.rows[rowIndex][columnIndex] = value;
          saveBlock(block.id, { data });
        }
      });
      td.append(input);
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(colgroup, thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderTableTextarea({ value, ariaLabel, className, commandContext, onCommit }) {
  const textarea = document.createElement("textarea");
  textarea.className = className;
  textarea.value = value;
  textarea.rows = 1;
  textarea.setAttribute("aria-label", ariaLabel);
  textarea.addEventListener("input", () => autoSizeTextarea(textarea));
  textarea.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== "Tab") return;
    const command = textarea.value.trim().toLowerCase();
    const handled = await runTableCommand(commandContext, command);
    if (!handled) return;
    event.preventDefault();
  });
  textarea.addEventListener("change", () => onCommit(textarea.value));
  requestAnimationFrame(() => autoSizeTextarea(textarea));
  return textarea;
}

function autoSizeTextarea(textarea) {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(42, textarea.scrollHeight)}px`;
}

function tableButton(label, onClick, className = "table-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function tableActionButton(label, ariaLabel, onClick, extraClass = "") {
  const className = extraClass ? `table-axis-button ${extraClass}` : "table-axis-button";
  const button = tableButton(label, onClick, className);
  button.setAttribute("aria-label", ariaLabel);
  return button;
}

function renderRowHandle(blockId, data, rowIndex) {
  const wrap = document.createElement("div");
  wrap.className = "table-axis-actions";

  const handle = tableActionButton("::", "Drag row", () => {}, "drag");
  handle.draggable = true;
  if (isTableDragSelected("row", blockId, rowIndex)) handle.classList.add("selected");
  handle.addEventListener("click", async () => handleTableDragClick(blockId, data, "row", rowIndex));
  handle.addEventListener("dragstart", (event) => {
    tableDragState.type = "row";
    tableDragState.blockId = blockId;
    tableDragState.index = rowIndex;
    tableDragState.clickMode = false;
    event.dataTransfer.effectAllowed = "move";
  });
  handle.addEventListener("dragend", () => resetTableDragState());

  const remove = tableActionButton("x", "Delete row", () => deleteTableRow(blockId, data, rowIndex), "delete");
  remove.disabled = data.rows.length === 1;
  wrap.append(handle, remove);
  return wrap;
}

function renderColumnHandle(blockId, data, columnIndex) {
  const wrap = document.createElement("div");
  wrap.className = "table-axis-actions table-axis-actions-columns";

  const handle = tableActionButton("::", "Drag column", () => {}, "drag");
  handle.draggable = true;
  if (isTableDragSelected("column", blockId, columnIndex)) handle.classList.add("selected");
  handle.addEventListener("click", async () => handleTableDragClick(blockId, data, "column", columnIndex));
  handle.addEventListener("dragstart", (event) => {
    tableDragState.type = "column";
    tableDragState.blockId = blockId;
    tableDragState.index = columnIndex;
    tableDragState.clickMode = false;
    event.dataTransfer.effectAllowed = "move";
  });
  handle.addEventListener("dragend", () => resetTableDragState());

  const remove = tableActionButton("x", "Delete column", () => deleteTableColumn(blockId, data, columnIndex), "delete");
  remove.disabled = data.columns.length === 1;
  wrap.append(handle, remove);
  return wrap;
}

function renderColumnResizeHandle(blockId, data, columnIndex, col) {
  const handle = document.createElement("div");
  handle.className = "table-column-resizer";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", `Resize column ${columnIndex + 1}`);
  handle.setAttribute("aria-orientation", "vertical");
  handle.tabIndex = 0;

  let startX = 0;
  let startWidth = 0;

  const resizeTo = (width) => {
    const nextWidth = Math.max(140, Math.round(width));
    data.columnWidths[columnIndex] = nextWidth;
    col.style.width = `${nextWidth}px`;
  };

  const onPointerMove = (event) => {
    resizeTo(startWidth + event.clientX - startX);
  };

  const stopResize = async () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", stopResize);
    await saveBlock(blockId, { data });
  };

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startX = event.clientX;
    startWidth = data.columnWidths[columnIndex];
    handle.classList.add("active");
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", async () => {
      handle.classList.remove("active");
      await stopResize();
    }, { once: true });
  });

  handle.addEventListener("keydown", async (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resizeTo(data.columnWidths[columnIndex] + (event.key === "ArrowRight" ? 16 : -16));
    await saveBlock(blockId, { data });
  });

  return handle;
}

function attachTableDropHandlers(element, blockId, type, insertIndex) {
  element.addEventListener("dragover", (event) => {
    if (tableDragState.type !== type || tableDragState.blockId !== blockId) return;
    event.preventDefault();
    element.classList.add("active");
  });
  element.addEventListener("dragleave", () => element.classList.remove("active"));
  element.addEventListener("drop", async (event) => {
    if (tableDragState.type !== type || tableDragState.blockId !== blockId) return;
    event.preventDefault();
    element.classList.remove("active");
    if (type === "row") {
      await moveTableRowTo(blockId, normalizedTable(findBlockById(blockId).data), tableDragState.index, insertIndex);
    } else {
      await moveTableColumnTo(blockId, normalizedTable(findBlockById(blockId).data), tableDragState.index, insertIndex);
    }
    resetTableDragState();
  });
}

async function runTableCommand(context, command) {
  if (!context || !command) return false;
  if (command === "//r" && context.rowIndex != null) {
    await insertTableRow(context.blockId, context.data, context.rowIndex);
    return true;
  }
  if (command === "//c" && context.columnIndex != null) {
    await insertTableColumn(context.blockId, context.data, context.columnIndex);
    return true;
  }
  if (command === "//dr" && context.rowIndex != null) {
    await deleteTableRow(context.blockId, context.data, context.rowIndex);
    return true;
  }
  if (command === "//dc" && context.columnIndex != null) {
    await deleteTableColumn(context.blockId, context.data, context.columnIndex);
    return true;
  }
  return false;
}

async function insertTableRow(blockId, data, rowIndex) {
  data.rows.splice(rowIndex + 1, 0, data.columns.map(() => ""));
  await saveBlock(blockId, { data });
}

async function insertTableColumn(blockId, data, columnIndex) {
  const nextName = `Column ${data.columns.length + 1}`;
  data.columns.splice(columnIndex + 1, 0, nextName);
  data.columnWidths.splice(columnIndex + 1, 0, 220);
  data.rows = data.rows.map((row) => {
    const nextRow = [...row];
    nextRow.splice(columnIndex + 1, 0, "");
    return nextRow;
  });
  await saveBlock(blockId, { data });
}

async function moveTableRowTo(blockId, data, fromIndex, insertIndex) {
  if (fromIndex === insertIndex) return;
  const nextRows = [...data.rows];
  [nextRows[fromIndex], nextRows[insertIndex]] = [nextRows[insertIndex], nextRows[fromIndex]];
  data.rows = nextRows;
  await saveBlock(blockId, { data });
}

async function moveTableColumnTo(blockId, data, fromIndex, insertIndex) {
  if (fromIndex === insertIndex) return;
  const nextColumns = [...data.columns];
  [nextColumns[fromIndex], nextColumns[insertIndex]] = [nextColumns[insertIndex], nextColumns[fromIndex]];
  data.columns = nextColumns;
  const nextWidths = [...data.columnWidths];
  [nextWidths[fromIndex], nextWidths[insertIndex]] = [nextWidths[insertIndex], nextWidths[fromIndex]];
  data.columnWidths = nextWidths;
  data.rows = data.rows.map((row) => {
    const nextRow = [...row];
    [nextRow[fromIndex], nextRow[insertIndex]] = [nextRow[insertIndex], nextRow[fromIndex]];
    return nextRow;
  });
  await saveBlock(blockId, { data });
}

async function deleteTableRow(blockId, data, rowIndex) {
  if (data.rows.length === 1) return;
  data.rows.splice(rowIndex, 1);
  await saveBlock(blockId, { data });
}

async function deleteTableColumn(blockId, data, columnIndex) {
  if (data.columns.length === 1) return;
  data.columns.splice(columnIndex, 1);
  data.columnWidths.splice(columnIndex, 1);
  data.rows = data.rows.map((row) => row.filter((_, index) => index !== columnIndex));
  await saveBlock(blockId, { data });
}

function resetTableDragState() {
  tableDragState.type = null;
  tableDragState.blockId = null;
  tableDragState.index = null;
  tableDragState.clickMode = false;
  document.querySelectorAll(".table-row-target.active, .table-column-target.active").forEach((node) => node.classList.remove("active"));
}

function findBlockById(blockId) {
  return state.blocks.find((block) => block.id === blockId);
}

function isTableDragSelected(type, blockId, index) {
  return tableDragState.clickMode && tableDragState.type === type && tableDragState.blockId === blockId && tableDragState.index === index;
}

async function handleTableDragClick(blockId, data, type, index) {
  if (tableDragState.clickMode && tableDragState.type === type && tableDragState.blockId === blockId) {
    const fromIndex = tableDragState.index;
    resetTableDragState();
    if (fromIndex === index) {
      renderEditor();
      return;
    }
    if (type === "row") {
      await moveTableRowTo(blockId, normalizedTable(findBlockById(blockId).data), fromIndex, index);
    } else {
      await moveTableColumnTo(blockId, normalizedTable(findBlockById(blockId).data), fromIndex, index);
    }
    return;
  }

  tableDragState.type = type;
  tableDragState.blockId = blockId;
  tableDragState.index = index;
  tableDragState.clickMode = true;
  renderEditor();
}

function normalizedTable(data) {
  const columns = Array.isArray(data?.columns) && data.columns.length ? data.columns.map(String) : ["Name", "Status"];
  const rows = Array.isArray(data?.rows) && data.rows.length ? data.rows : [columns.map(() => "")];
  const sourceWidths = Array.isArray(data?.columnWidths) ? data.columnWidths : [];
  const columnWidths = columns.map((column, index) => {
    const saved = Number(sourceWidths[index]);
    if (Number.isFinite(saved) && saved >= 140) return Math.round(saved);
    return Math.max(180, Math.min(360, column.length * 9 + 96));
  });
  return {
    columns,
    columnWidths,
    rows: rows.map((row) => columns.map((_, index) => String(row?.[index] ?? "")))
  };
}

async function renderSearch(query) {
  const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
  if (query !== state.search) return;
  crumb.textContent = "Search";
  surface.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "search-results";
  const heading = document.createElement("h2");
  heading.textContent = `Results for "${query}"`;
  wrap.append(heading);

  const items = [
    ...results.pages.map((page) => ({ pageId: page.id, label: page.title, kind: "Page" })),
    ...results.blocks.map((block) => ({
      pageId: block.pageId,
      label: block.type === "table" ? block.content || "Table" : block.content || "Empty block",
      kind: block.type
    }))
  ];

  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "No matches.";
    wrap.append(empty);
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    button.textContent = `${item.kind}: ${item.label}`;
    button.addEventListener("click", () => {
      state.activePageId = item.pageId;
      searchInput.value = "";
      state.search = "";
      renderPageTree();
      renderEditor();
    });
    wrap.append(button);
  }

  surface.append(wrap);
  requestAnimationFrame(updateViewportScrollbar);
}

async function savePage(id, patch) {
  await api(`/api/pages/${id}`, { method: "PATCH", body: patch });
  await loadWorkspace();
}

async function saveBlock(id, patch) {
  await api(`/api/blocks/${id}`, { method: "PATCH", body: patch });
  await loadWorkspace();
}

function activePage() {
  return state.pages.find((page) => page.id === state.activePageId) || state.pages[0];
}

function blocksForPage(pageId) {
  return state.blocks.filter((block) => block.pageId === pageId);
}

function parentCrumb(page) {
  const names = [];
  let current = page;
  while (current) {
    names.unshift(current.title);
    current = state.pages.find((candidate) => candidate.id === current.parentId);
  }
  return names.join(" / ");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 204) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}
