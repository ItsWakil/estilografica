import { marked } from "./vendor/marked.esm.js";

/* ── Backend bridge ──────────────────────────────────────────
   Inside Tauri we call the Rust commands. In a plain browser
   (e.g. `npx serve src` while tweaking CSS) an in-memory mock
   stands in so the UI still works. */
const TAURI = window.__TAURI__;
const invoke = TAURI?.core?.invoke ?? mockInvoke;

const WELCOME = `# Welcome to Estilográfica

Notes are plain Markdown files, so any editor can open them too.

## Formatting

- **Bold** with Ctrl+B, _italic_ with Ctrl+I, ~~strike~~ with Ctrl+Shift+X
- \`Inline code\` with Ctrl+E, [links](https://example.com) with Ctrl+K
- Headings with Ctrl+1, Ctrl+2, Ctrl+3

> Quotes start with a greater-than sign.

## Lists

1. Press Enter to continue a list
2. Press Enter on an empty item to end it
3. Tab and Shift+Tab indent

- [x] Checklists work
- [ ] Tick them in the preview, too

\`\`\`
Code blocks keep their spacing.
\`\`\`
`;

/* ── Elements & state ── */
const $ = (id) => document.getElementById(id);
const editor = $("editor"), preview = $("preview"), panes = $("panes");
const titleInput = $("title"), list = $("note-list"), search = $("search");
const saveState = $("save-state"), counts = $("counts"), empty = $("empty");
const trashBtn = $("trash-btn");

let notes = [];          // [{id, modified, preview}]
let visibleIds = null;   // search result ids, or null for all
let currentId = null;
let dirty = false;
let saveTimer = 0;

marked.setOptions({ gfm: true, breaks: false });

/* ── Status ── */
function setStatus(text, kind = "") {
  saveState.textContent = text;
  saveState.className = kind;
}

function updateCounts() {
  const words = (editor.value.match(/\S+/g) || []).length;
  counts.textContent = `${words} ${words === 1 ? "word" : "words"}`;
}

/* ── Note list ── */
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
function when(ms) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : dayFmt.format(d);
}

function renderList() {
  list.replaceChildren();
  const shown = visibleIds ? notes.filter((n) => visibleIds.includes(n.id)) : notes;
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = visibleIds ? "No matching notes" : "No notes yet";
    list.append(li);
  }
  for (const n of shown) {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(n.id === currentId));
    li.dataset.id = n.id;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = n.id;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = n.preview ? `${when(n.modified)}  ${n.preview}` : when(n.modified);
    li.append(name, meta);
    list.append(li);
  }
  empty.hidden = notes.length > 0;
}

async function refreshList() {
  notes = await invoke("list_notes");
  const q = search.value.trim();
  visibleIds = q ? await invoke("search_notes", { query: q }) : null;
  renderList();
}

list.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) openNote(li.dataset.id);
});
list.addEventListener("keydown", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  if (e.key === "Enter") openNote(li.dataset.id);
  if (e.key === "ArrowDown") li.nextElementSibling?.focus();
  if (e.key === "ArrowUp") li.previousElementSibling?.focus();
});

let searchTimer = 0;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshList, 180);
});
search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = list.querySelector("li[data-id]");
    if (first) openNote(first.dataset.id).then(() => editor.focus());
  }
  if (e.key === "Escape") {
    search.value = "";
    refreshList();
    editor.focus();
  }
});

/* ── Open / save / create / rename / trash ── */
async function openNote(id) {
  if (id === currentId) return;
  await flush();
  try {
    const text = await invoke("read_note", { id });
    currentId = id;
    editor.value = text;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    titleInput.value = id;
    localStorage.setItem("last-note", id);
    renderPreview();
    updateCounts();
    renderList();
    setStatus("Saved");
  } catch (err) {
    setStatus(String(err), "error");
  }
}

function scheduleSave() {
  if (!currentId) return;
  dirty = true;
  setStatus("Editing", "dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !currentId) return;
  dirty = false;
  const id = currentId, content = editor.value;
  try {
    await invoke("save_note", { id, content });
    setStatus("Saved");
    const n = notes.find((x) => x.id === id);
    if (n) {
      n.modified = Date.now();
      n.preview = firstLine(content);
      notes = [n, ...notes.filter((x) => x !== n)];
      renderList();
    }
  } catch (err) {
    dirty = true;
    setStatus(`Not saved: ${err}`, "error");
  }
}

function firstLine(text) {
  const line = text.split("\n").map((l) => l.replace(/^[#>\-* ]+/, "").trim()).find(Boolean);
  return (line || "").slice(0, 90);
}

async function newNote() {
  await flush();
  const id = await invoke("create_note");
  search.value = "";
  await refreshList();
  await openNote(id);
  titleInput.focus();
  titleInput.select();
}

async function renameCurrent() {
  if (!currentId) return;
  const wanted = titleInput.value.trim();
  if (!wanted || wanted === currentId) {
    titleInput.value = currentId;
    return;
  }
  await flush();
  try {
    const newId = await invoke("rename_note", { id: currentId, title: wanted });
    currentId = newId;
    titleInput.value = newId;
    localStorage.setItem("last-note", newId);
    await refreshList();
  } catch (err) {
    titleInput.value = currentId;
    setStatus(String(err), "error");
  }
}

titleInput.addEventListener("blur", renameCurrent);
titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); editor.focus(); }   // blur triggers rename
  if (e.key === "Escape") { titleInput.value = currentId ?? ""; editor.focus(); }
});

// Two-step trash: first click arms the button, second click within 3 s moves the file.
let armTimer = 0;
trashBtn.addEventListener("click", async () => {
  if (!currentId) return;
  if (!trashBtn.classList.contains("armed")) {
    trashBtn.classList.add("armed");
    trashBtn.textContent = "Confirm trash";
    armTimer = setTimeout(disarm, 3000);
    return;
  }
  disarm();
  dirty = false;
  const id = currentId;
  try {
    await invoke("trash_note", { id });
    currentId = null;
    await refreshList();
    if (notes.length) await openNote(notes[0].id);
    else { editor.value = ""; titleInput.value = ""; renderPreview(); updateCounts(); }
    setStatus(`Moved “${id}” to .trash`);
  } catch (err) {
    setStatus(String(err), "error");
  }
});
function disarm() {
  clearTimeout(armTimer);
  trashBtn.classList.remove("armed");
  trashBtn.textContent = "Trash";
}

$("new-btn").addEventListener("click", newNote);
$("empty-new").addEventListener("click", newNote);

/* ── Preview ── */
function renderPreview() {
  if (panes.dataset.mode === "write") return;
  preview.innerHTML = marked.parse(editor.value);
  preview.querySelectorAll('input[type="checkbox"]').forEach((b) => b.removeAttribute("disabled"));
}

// Ticking a box in the preview edits the matching "[ ]" in the source.
preview.addEventListener("change", (e) => {
  if (e.target.type !== "checkbox") return;
  const idx = [...preview.querySelectorAll('input[type="checkbox"]')].indexOf(e.target);
  const re = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/gm;
  let m, i = 0;
  while ((m = re.exec(editor.value))) {
    if (i++ === idx) {
      const pos = m.index + m[1].length;
      editor.setRangeText(e.target.checked ? "x" : " ", pos, pos + 1, "preserve");
      onInput();
      break;
    }
  }
});

// Links open in the system browser, never inside the app window.
preview.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  openExternal(a.getAttribute("href"));
});

function openExternal(url) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (TAURI) invoke("plugin:opener|open_url", { url }).catch((err) => setStatus(String(err), "error"));
  else window.open(url, "_blank", "noopener");
}

$("author-link").addEventListener("click", (e) => {
  e.preventDefault();
  openExternal(e.currentTarget.href);
});

// Split view: preview follows the editor's scroll position.
editor.addEventListener("scroll", () => {
  if (panes.dataset.mode !== "split") return;
  const max = editor.scrollHeight - editor.clientHeight;
  const ratio = max > 0 ? editor.scrollTop / max : 0;
  preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
});

/* ── Editing primitives ──
   execCommand("insertText") keeps the native undo stack (Ctrl+Z) intact;
   setRangeText is the fallback. */
let previewFrame = 0;
function onInput() {
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(renderPreview);
  updateCounts();
  scheduleSave();
}
editor.addEventListener("input", onInput);
editor.addEventListener("blur", flush);

function edit(start, end, text, selStart, selEnd = selStart) {
  editor.focus();
  editor.setSelectionRange(start, end);
  let ok = false;
  try {
    ok = text === "" && start !== end
      ? document.execCommand("delete")
      : text !== "" && document.execCommand("insertText", false, text);
  } catch { ok = false; }
  if (!ok) {
    editor.setRangeText(text, start, end, "end");
    onInput();
  }
  if (selStart != null) editor.setSelectionRange(selStart, selEnd);
}

function wrap(left, right = left, placeholder = "text") {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  const sel = v.slice(s, e);
  if (v.slice(s - left.length, s) === left && v.slice(e, e + right.length) === right) {
    edit(s - left.length, e + right.length, sel, s - left.length, e - left.length);
    return;
  }
  if (sel.length >= left.length + right.length && sel.startsWith(left) && sel.endsWith(right)) {
    const inner = sel.slice(left.length, sel.length - right.length);
    edit(s, e, inner, s, s + inner.length);
    return;
  }
  const inner = sel || placeholder;
  edit(s, e, left + inner + right, s + left.length, s + left.length + inner.length);
}

// Apply fn to every line the selection touches.
function replaceLines(fn) {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  const start = v.lastIndexOf("\n", s - 1) + 1;
  const endAt = e > s && v[e - 1] === "\n" ? e - 1 : e;
  let end = v.indexOf("\n", endAt);
  if (end === -1) end = v.length;
  const lines = v.slice(start, end).split("\n");
  const out = fn(lines);
  const text = out.join("\n");
  if (text === lines.join("\n")) return;
  if (lines.length === 1) {
    const caret = Math.max(start, s + (out[0].length - lines[0].length));
    edit(start, end, text, caret);
  } else {
    edit(start, end, text, start, start + text.length);
  }
}

const MARKERS = {
  ul: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  task: /^(\s*)[-*+] \[[ xX]\] /,
  ol: /^(\s*)\d+[.)] /,
  quote: /^(\s*)> ?/,
};
const ANY_LIST = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;

function toggleBlock(kind) {
  replaceLines((lines) => {
    const filled = lines.filter((l) => l.trim());
    const allHave = filled.length > 0 && filled.every((l) => MARKERS[kind].test(l));
    let n = 0;
    return lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      if (allHave) return l.replace(MARKERS[kind], "$1");
      const base = kind === "quote" ? l : l.replace(ANY_LIST, "$1");
      const indent = base.match(/^\s*/)[0];
      const mark = { ul: "- ", task: "- [ ] ", ol: `${++n}. `, quote: "> " }[kind];
      return indent + mark + base.slice(indent.length);
    });
  });
}

// level null = cycle H1 → H2 → H3 → plain; a number sets (or clears) that level.
function heading(level = null) {
  replaceLines((lines) => lines.map((l) => {
    const m = l.match(/^(#{1,6}) +/);
    const cur = m ? m[1].length : 0;
    const body = m ? l.slice(m[0].length) : l;
    const target = level != null ? (cur === level ? 0 : level) : (cur >= 3 ? 0 : cur + 1);
    return (target ? "#".repeat(target) + " " : "") + body;
  }));
}

function link() {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  const sel = v.slice(s, e);
  if (/^(https?:\/\/|mailto:)\S+$/.test(sel)) {
    edit(s, e, `[](${sel})`, s + 1);
    return;
  }
  const text = sel || "link text";
  const out = `[${text}](https://)`;
  if (sel) edit(s, e, out, s + text.length + 3, s + text.length + 11);
  else edit(s, e, out, s + 1, s + 1 + text.length);
}

function inlineCode() {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  if (v.slice(s, e).includes("\n")) codeBlock();
  else wrap("`", "`", "code");
}

function codeBlock() {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  const sel = v.slice(s, e);
  const lead = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
  const out = `${lead}\`\`\`\n${sel}\n\`\`\`\n`;
  const caret = s + lead.length + 4;
  edit(s, e, out, caret, caret + sel.length);
}

function rule() {
  const { selectionEnd: e, value: v } = editor;
  let end = v.indexOf("\n", e);
  if (end === -1) end = v.length;
  const line = v.slice(v.lastIndexOf("\n", end - 1) + 1, end);
  const out = (line.trim() ? "\n\n" : "") + "---\n";
  edit(end, end, out, end + out.length);
}

function indent(outdent) {
  replaceLines((lines) => lines.map((l) => (outdent ? l.replace(/^ {1,2}|^\t/, "") : "  " + l)));
}

const COMMANDS = {
  heading: () => heading(),
  bold: () => wrap("**"),
  italic: () => wrap("_"),
  strike: () => wrap("~~"),
  link,
  code: inlineCode,
  codeblock: codeBlock,
  quote: () => toggleBlock("quote"),
  ul: () => toggleBlock("ul"),
  ol: () => toggleBlock("ol"),
  task: () => toggleBlock("task"),
  rule,
};

document.querySelector(".toolbar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cmd]");
  if (!btn || !currentId) return;
  if (panes.dataset.mode === "read") setMode("split");
  COMMANDS[btn.dataset.cmd]();
});
// Keep the editor's selection when toolbar buttons are pressed.
document.querySelector(".toolbar").addEventListener("mousedown", (e) => e.preventDefault());

/* ── Editor keys: list continuation and indentation ── */
editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en, value: v } = editor;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const onList = ANY_LIST.test(v.slice(lineStart)) || MARKERS.quote.test(v.slice(lineStart));
    if (e.shiftKey || onList || v.slice(s, en).includes("\n")) indent(e.shiftKey);
    else edit(s, en, "  ", s + 2);
    return;
  }
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  const { selectionStart: s, selectionEnd: en, value: v } = editor;
  if (s !== en) return;
  const lineStart = v.lastIndexOf("\n", s - 1) + 1;
  const line = v.slice(lineStart, s);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )/);
  if (!m) return;
  e.preventDefault();
  if (!line.slice(m[0].length).trim()) {
    edit(lineStart, s, "", lineStart);          // empty item: end the list
    return;
  }
  let mark = m[2];
  if (m[3]) mark = `${Number(m[3]) + 1}${m[4]} `;
  else mark = mark.replace(/\[[xX]\]/, "[ ]");
  const out = "\n" + m[1] + mark;
  edit(s, s, out, s + out.length);
});

/* ── View modes ── */
const MODES = ["write", "split", "read"];
function setMode(mode) {
  panes.dataset.mode = mode;
  document.querySelectorAll(".modes button").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
  localStorage.setItem("mode", mode);
  renderPreview();
}
document.querySelector(".modes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (b) setMode(b.dataset.mode);
});

/* ── Themes: Tokyo Night / Tokyo Day, defaulting to the system setting ── */
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const MOON = '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
function applyTheme() {
  const theme = localStorage.getItem("theme") || (darkQuery.matches ? "night" : "day");
  document.documentElement.dataset.theme = theme;
  const btn = $("theme-btn");
  btn.querySelector("svg").innerHTML = theme === "night" ? SUN : MOON;
  btn.title = theme === "night" ? "Switch to Tokyo Day (Ctrl+Shift+L)" : "Switch to Tokyo Night (Ctrl+Shift+L)";
}
function toggleTheme() {
  const now = document.documentElement.dataset.theme;
  localStorage.setItem("theme", now === "night" ? "day" : "night");
  applyTheme();
}
$("theme-btn").addEventListener("click", toggleTheme);
darkQuery.addEventListener("change", () => { if (!localStorage.getItem("theme")) applyTheme(); });

/* ── Global shortcuts ── */
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  const inEditor = e.target === editor;
  let handled = true;

  if (key === "n" && !e.shiftKey) newNote();
  else if (key === "s") flush();
  else if (key === "f" || key === "p") { search.focus(); search.select(); }
  else if (key === "/") setMode(MODES[(MODES.indexOf(panes.dataset.mode) + 1) % 3]);
  else if (key === "l" && e.shiftKey) toggleTheme();
  else if (!inEditor) handled = false;
  else if (key === "b" && !e.shiftKey) COMMANDS.bold();
  else if (key === "i" && !e.shiftKey) COMMANDS.italic();
  else if (key === "k") link();
  else if (key === "e") (e.shiftKey ? codeBlock : inlineCode)();
  else if (key === "x" && e.shiftKey) COMMANDS.strike();
  else if (key === "q" && e.shiftKey) COMMANDS.quote();
  else if (!e.shiftKey && /^Digit[1-3]$/.test(e.code)) heading(Number(e.code.slice(5)));
  else if (e.shiftKey && e.code === "Digit7") COMMANDS.ol();
  else if (e.shiftKey && e.code === "Digit8") COMMANDS.ul();
  else if (e.shiftKey && e.code === "Digit9") COMMANDS.task();
  else handled = false;

  if (handled) e.preventDefault();
});

/* ── Save before the window closes ── */
if (TAURI?.window?.getCurrentWindow) {
  TAURI.window.getCurrentWindow().onCloseRequested(async () => { await flush(); });
}
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

/* ── Start ── */
async function start() {
  applyTheme();
  setMode(localStorage.getItem("mode") || "write");
  try {
    $("folder").textContent = await invoke("notes_dir");
    await refreshList();
    if (!notes.length && !localStorage.getItem("welcomed")) {
      const id = await invoke("create_note");
      const named = await invoke("rename_note", { id, title: "Welcome" });
      await invoke("save_note", { id: named, content: WELCOME });
      await refreshList();
    }
    localStorage.setItem("welcomed", "1");
    const last = localStorage.getItem("last-note");
    const target = notes.find((n) => n.id === last) ?? notes[0];
    if (target) await openNote(target.id);
    else renderList();
  } catch (err) {
    setStatus(`Can't reach the notes folder: ${err}`, "error");
  }
}
start();

/* ── Browser-only mock backend ── */
function mockInvoke(cmd, args = {}) {
  const db = (mockInvoke.db ??= new Map());
  const now = () => Date.now();
  const uniq = (base, except) => {
    let c = base, n = 2;
    while (db.has(c) && c !== except) c = `${base} ${n++}`;
    return c;
  };
  switch (cmd) {
    case "notes_dir": return Promise.resolve("(browser preview, nothing is saved)");
    case "list_notes":
      return Promise.resolve([...db].map(([id, n]) => ({ id, modified: n.t, preview: firstLine(n.c) }))
        .sort((a, b) => b.modified - a.modified));
    case "search_notes": {
      const q = args.query.toLowerCase();
      return Promise.resolve([...db].filter(([id, n]) => (id + n.c).toLowerCase().includes(q)).map(([id]) => id));
    }
    case "read_note": return Promise.resolve(db.get(args.id)?.c ?? "");
    case "save_note": db.set(args.id, { c: args.content, t: now() }); return Promise.resolve();
    case "create_note": { const id = uniq("Untitled"); db.set(id, { c: "", t: now() }); return Promise.resolve(id); }
    case "rename_note": {
      const id = uniq(args.title.trim() || "Untitled", args.id);
      const n = db.get(args.id); db.delete(args.id); db.set(id, n);
      return Promise.resolve(id);
    }
    case "trash_note": db.delete(args.id); return Promise.resolve();
    default: return Promise.reject(`Unknown command ${cmd}`);
  }
}
