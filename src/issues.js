/**
 * Notices: problems worth telling the person about, kept for the Gallery.
 *
 * A capture that fails on a web page, or a full-page capture cut short by a
 * closed tab, is recorded here instead of only reaching the console. The
 * Gallery shows them behind a small icon in its top bar, each with a dismiss
 * button. Stored in chrome.storage.local so every context sees them.
 *
 *   { id, at, kind: "error" | "warn", title, detail, source, count }
 */
export const ISSUES_KEY = "issues";
const MAX = 30;

function read() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([ISSUES_KEY], (data) => resolve(Array.isArray(data?.[ISSUES_KEY]) ? data[ISSUES_KEY] : []));
    } catch {
      resolve([]);
    }
  });
}

function write(list) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [ISSUES_KEY]: list.slice(0, MAX) }, () => resolve());
    } catch {
      resolve();
    }
  });
}

export function listIssues() {
  return read();
}

/** Record one notice. The same title within a minute is folded into a count. */
export async function recordIssue({ kind = "error", title = "Something went wrong", detail = "", source = "" } = {}) {
  const list = await read();
  const now = Date.now();
  const same = list.find((i) => i.title === title && i.detail === detail && now - i.at < 60000);
  if (same) {
    same.count = (same.count || 1) + 1;
    same.at = now;
  } else {
    list.unshift({
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: now,
      kind: kind === "warn" ? "warn" : "error",
      title: String(title).slice(0, 140),
      detail: String(detail || "").slice(0, 400),
      source: String(source || "").slice(0, 60),
      count: 1,
    });
  }
  list.sort((a, b) => b.at - a.at);
  await write(list);
}

export async function dismissIssue(id) {
  await write((await read()).filter((i) => i.id !== id));
}

export async function clearIssues() {
  await write([]);
}
