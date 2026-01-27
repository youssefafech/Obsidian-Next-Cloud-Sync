var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// webdav.ts
var import_obsidian = require("obsidian");
var DEFAULT_TIMEOUT_MS = 3e4;
function base64Encode(value) {
  if (typeof btoa === "function") {
    return btoa(value);
  }
  const buffer = globalThis.Buffer?.from(value, "utf8");
  return buffer ? buffer.toString("base64") : value;
}
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "") + "/";
}
function encodePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
async function requestWithTimeout(url, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await (0, import_obsidian.requestUrl)({
    url,
    method: init.method,
    headers: init.headers,
    body: init.body,
    throw: false,
    timeout: timeoutMs
  });
  const textValue = response.text ?? "";
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: "",
    text: async () => textValue
  };
}
var WebDavClient = class {
  baseUrl;
  authHeader;
  constructor(baseUrl, username, password) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.authHeader = `Basic ${base64Encode(`${username}:${password}`)}`;
  }
  buildUrl(remotePath) {
    const normalized = remotePath.replace(/^\/+/, "");
    return this.baseUrl + encodePath(normalized);
  }
  toRemotePathFromHref(href) {
    try {
      const base = new URL(this.baseUrl);
      const hrefUrl = new URL(href, base);
      const basePath = base.pathname.replace(/\/+$/, "") + "/";
      if (!hrefUrl.pathname.startsWith(basePath)) return null;
      const relative = hrefUrl.pathname.slice(basePath.length);
      return decodeURIComponent(relative);
    } catch {
      return null;
    }
  }
  async propfindDocument(url, depth, body) {
    const response = await requestWithTimeout(url, {
      method: "PROPFIND",
      headers: {
        Authorization: this.authHeader,
        Depth: depth,
        "Content-Type": "text/xml"
      },
      body
    });
    if (!response.ok) {
      throw { status: response.status, message: response.statusText };
    }
    const text = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, "text/xml");
  }
  async propfind(remotePath) {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getlastmodified />
  </d:prop>
</d:propfind>`;
    const xml = await this.propfindDocument(this.buildUrl(remotePath), "0", body);
    const etagNode = xml.querySelector("getetag");
    const mtimeNode = xml.querySelector("getlastmodified");
    return {
      etag: etagNode?.textContent ?? null,
      lastModified: mtimeNode?.textContent ?? null
    };
  }
  async list(remotePath, depth = "1") {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getlastmodified />
    <d:getcontenttype />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;
    const xml = await this.propfindDocument(this.buildUrl(remotePath), depth, body);
    const responses = Array.from(xml.getElementsByTagName("response"));
    const entries = [];
    for (const responseEl of responses) {
      const href = responseEl.querySelector("href")?.textContent?.trim();
      if (!href) continue;
      const path = this.toRemotePathFromHref(href);
      if (!path) continue;
      let propEl = null;
      const propstats = Array.from(responseEl.getElementsByTagName("propstat"));
      for (const propstat of propstats) {
        const status = propstat.querySelector("status")?.textContent ?? "";
        if (status.includes(" 200 ")) {
          propEl = propstat.querySelector("prop");
          break;
        }
      }
      if (!propEl) {
        propEl = responseEl.querySelector("prop");
      }
      const etag = propEl?.querySelector("getetag")?.textContent ?? null;
      const lastModified = propEl?.querySelector("getlastmodified")?.textContent ?? null;
      const contentType = propEl?.querySelector("getcontenttype")?.textContent ?? null;
      const isCollection = !!propEl?.querySelector("resourcetype > collection");
      entries.push({
        path,
        etag,
        lastModified,
        contentType,
        isCollection
      });
    }
    return entries;
  }
  async propfindFileId(remotePath) {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:fileid />
  </d:prop>
</d:propfind>`;
    const xml = await this.propfindDocument(this.buildUrl(remotePath), "0", body);
    const fileIdNode = xml.querySelector("fileid");
    return fileIdNode?.textContent ?? null;
  }
  async propfindAbsolute(url, depth, body) {
    return this.propfindDocument(url, depth, body);
  }
  async getAbsolute(url) {
    return requestWithTimeout(url, {
      method: "GET",
      headers: {
        Authorization: this.authHeader
      }
    });
  }
  async deleteAbsolute(url, headers = {}) {
    return requestWithTimeout(url, {
      method: "DELETE",
      headers: {
        Authorization: this.authHeader,
        ...headers
      }
    });
  }
  async putAbsolute(url, content, headers = {}) {
    return requestWithTimeout(url, {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "text/calendar; charset=utf-8",
        ...headers
      },
      body: content
    });
  }
  async reportAbsolute(url, body, depth = "1") {
    const response = await requestWithTimeout(url, {
      method: "REPORT",
      headers: {
        Authorization: this.authHeader,
        Depth: depth,
        "Content-Type": "text/xml"
      },
      body
    });
    if (!response.ok) {
      throw { status: response.status, message: response.statusText };
    }
    const text = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, "text/xml");
  }
  async get(remotePath) {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "GET",
      headers: {
        Authorization: this.authHeader
      }
    });
  }
  async put(remotePath, content, headers = {}) {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "text/markdown; charset=utf-8",
        ...headers
      },
      body: content
    });
  }
  async mkcol(remotePath) {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "MKCOL",
      headers: {
        Authorization: this.authHeader
      }
    });
  }
  async delete(remotePath, headers = {}) {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "DELETE",
      headers: {
        Authorization: this.authHeader,
        ...headers
      }
    });
  }
  async move(remotePath, destinationPath, overwrite = true) {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "MOVE",
      headers: {
        Authorization: this.authHeader,
        Destination: this.buildUrl(destinationPath),
        Overwrite: overwrite ? "T" : "F"
      }
    });
  }
};

// main.ts
var DEFAULT_SETTINGS = {
  nextcloudBaseUrl: "https://your-nextcloud.example.com",
  username: "",
  appPassword: "",
  remoteRoot: "Obsidian",
  debounceMs: 900,
  includePatterns: "**/*.md",
  excludePatterns: "",
  syncOnModify: true,
  syncOnFileClose: true,
  checkRemoteOnOpen: true,
  checkRemoteOnFocus: true,
  focusCheckThrottleMs: 2e3,
  periodicRemoteCheckEnabled: false,
  periodicRemoteCheckMinutes: 15,
  periodicRemoteCheckNotices: false,
  taskSyncIntervalEnabled: false,
  taskSyncIntervalMinutes: 10,
  taskInboxEnabled: false,
  taskInboxPath: "Task Inbox.md",
  taskInboxQuery: "```tasks\nnot done\n```",
  taskInboxAutoMove: true,
  taskInboxArchivePath: "Task Inbox closed.md",
  taskDeletionPromptEnabled: true,
  taskDeletionDefaultAction: "keep",
  todayNoteEnabled: true,
  todayNotePath: "Today.md",
  todayNoteLimit: 4,
  todayNoteUseQuery: true,
  todayNoteQuery: "```tasks\nnot done\nlimit {{limit}}\nsort by due\n```",
  remindersEnabled: true,
  remindersMinutes: 60,
  remindersMode: "both",
  remindersMaxCount: 3,
  dailyChecklistEnabled: false,
  dailyChecklistPath: "Daily Checklist.md",
  dailyChecklistTemplate: "- [ ] Plan top 3 tasks\n- [ ] Take a short break\n- [ ] Review today",
  quickCapturePath: "Task Inbox.md",
  focusTag: "focus",
  promptRemoteDelete: true,
  applyRemoteDeletions: true,
  remoteDeletionsPath: ".sync-deletions.json",
  enableTaskSync: false,
  taskListUrl: "",
  caldavBaseUrl: "",
  taskSyncOnFileSync: true,
  enableChangelog: false,
  changelogPath: "Sync Changelog.md",
  enableDebug: false,
  archiveConflictsOnResolve: true,
  conflictArchiveFolder: "Sync Conflicts",
  conflictArchiveRemoteFolder: ".sync-conflicts"
};
var CREDENTIAL_PREFIX = "enc:v1:";
var CREDENTIAL_KEY_STORAGE = "sync-plugin-cred-key";
var EMPTY_STATE = {
  files: {},
  conflicts: {},
  deletionsApplied: {},
  tasks: {},
  noSync: {},
  noTaskSync: {},
  lastChecklistDate: null
};
var SyncPlugin = class extends import_obsidian2.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  state = { ...EMPTY_STATE };
  statusBarItem = null;
  currentStatus = "idle";
  queue = [];
  queuedPaths = /* @__PURE__ */ new Set();
  queueRunning = false;
  debounceTimers = /* @__PURE__ */ new Map();
  taskDebounceTimers = /* @__PURE__ */ new Map();
  suppressModifyForPaths = /* @__PURE__ */ new Set();
  lastActiveFile = null;
  currentSyncPath = null;
  progressActive = false;
  progressTotal = 0;
  progressDone = 0;
  logEntries = [];
  logLimit = 200;
  lastFocusChecks = /* @__PURE__ */ new Map();
  previewFiles = /* @__PURE__ */ new Set();
  fileStatuses = /* @__PURE__ */ new Map();
  deletionSyncInFlight = false;
  periodicSyncInFlight = false;
  lockStatusPath = false;
  pausePeriodic = false;
  suppressDeletePrompt = /* @__PURE__ */ new Set();
  suppressTaskDeletePrompt = /* @__PURE__ */ new Set();
  credentialKeyPromise = null;
  periodicSyncTimer = null;
  taskSyncTimer = null;
  reminderTimer = null;
  async onload() {
    await this.loadPluginData();
    this.addSettingTab(new SyncSettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("idle");
    this.seedStatusesFromState();
    this.applyStatusStyles();
    this.registerTaskIdIconProcessor();
    void this.syncRemoteDeletions("startup");
    this.setupPeriodicRemoteCheck();
    this.setupTaskSyncInterval();
    this.setupReminders();
    void this.refreshTodayNote();
    void this.refreshDailyChecklist();
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.onVaultModify(file))
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.onVaultDelete(file))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => void this.onVaultRename(file, oldPath))
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );
    this.registerDomEvent(window, "focus", () => this.onWindowFocus());
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.cleanupPreviewFiles())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.refreshFileExplorerIcons())
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof import_obsidian2.TFile)) return;
        menu.addItem((item) => {
          const isDisabled = this.isNoSync(file.path);
          item.setTitle(isDisabled ? "Enable sync for this note" : "Disable sync for this note").setIcon(isDisabled ? "toggle-right" : "toggle-left").onClick(() => void this.toggleNoSync(file));
        });
        menu.addItem((item) => {
          const isDisabled = this.isNoTaskSync(file.path);
          item.setTitle(isDisabled ? "Enable task sync for this note" : "Disable task sync for this note").setIcon(isDisabled ? "check-square" : "square").onClick(() => void this.toggleNoTaskSync(file));
        });
        menu.addItem((item) => {
          item.setTitle("Open remote version history").setIcon("history").onClick(() => void this.openRemoteHistory(file));
        });
        menu.addItem((item) => {
          item.setTitle("Delete (sync)").setIcon("trash").onClick(() => void this.promptDeleteWithSync(file));
        });
      })
    );
    this.addCommand({
      id: "sync-current-file",
      name: "Sync now (current file)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        this.enqueueSync(file.path, "manual-current");
        return true;
      }
    });
    this.addCommand({
      id: "sync-all-files",
      name: "Sync all",
      callback: () => this.syncAllMarkdown()
    });
    this.addCommand({
      id: "sync-show-queue",
      name: "Show sync queue",
      callback: () => this.showSyncQueue()
    });
    this.addCommand({
      id: "sync-show-log",
      name: "Show sync log",
      callback: () => this.showSyncLog()
    });
    this.addCommand({
      id: "sync-resolve-conflict",
      name: "Resolve conflict for current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const conflict = this.state.conflicts[file.path];
        if (!conflict) return false;
        if (checking) return true;
        this.openConflictResolver(conflict);
        return true;
      }
    });
    this.addCommand({
      id: "sync-show-conflicts",
      name: "Show conflicts",
      callback: () => this.showConflicts()
    });
    this.addCommand({
      id: "sync-remote-history",
      name: "Open remote version history",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        void this.openRemoteHistory(file);
        return true;
      }
    });
    this.addCommand({
      id: "sync-task-id-cleanup",
      name: "Task ID cleanup (redownload IDs)",
      callback: () => void this.cleanupTaskIds()
    });
    this.addCommand({
      id: "sync-refresh-today",
      name: "Refresh Today Focus note",
      callback: () => void this.refreshTodayNote()
    });
    this.addCommand({
      id: "sync-quick-capture",
      name: "Quick capture task",
      callback: () => void this.quickCaptureTask()
    });
    this.addCommand({
      id: "sync-start-task",
      name: "Start task (mark in progress)",
      callback: () => void this.startTaskAtCursor()
    });
    this.addCommand({
      id: "sync-snooze-task",
      name: "Snooze task to tomorrow",
      callback: () => void this.snoozeTaskToTomorrow()
    });
    this.addCommand({
      id: "sync-timeblock-task",
      name: "Add time block to task",
      callback: () => void this.addTimeBlockToTask()
    });
    this.addCommand({
      id: "sync-sort-tasks",
      name: "Sort tasks in current note",
      callback: () => void this.sortTasksInActiveFile()
    });
    this.addCommand({
      id: "sync-update-progress",
      name: "Update task progress line",
      callback: () => void this.updateProgressLineInActiveFile()
    });
    this.addCommand({
      id: "sync-refresh-daily-checklist",
      name: "Refresh daily checklist",
      callback: () => void this.refreshDailyChecklist()
    });
    this.addRibbonSeparator();
    this.addRibbonAction("calendar", "Refresh Today Focus note", () => void this.refreshTodayNote());
    this.addRibbonAction("plus-circle", "Quick capture task", () => void this.quickCaptureTask());
    this.addRibbonAction("play-circle", "Start task (mark in progress)", () => void this.startTaskAtCursor());
    this.addRibbonAction("clock-3", "Snooze task to tomorrow", () => void this.snoozeTaskToTomorrow());
    this.addRibbonAction("clock", "Add time block to task", () => void this.addTimeBlockToTask());
    this.addRibbonAction("arrow-down-up", "Sort tasks in current note", () => void this.sortTasksInActiveFile());
    this.addRibbonAction("activity", "Update task progress line", () => void this.updateProgressLineInActiveFile());
    this.addRibbonAction("list-checks", "Refresh daily checklist", () => void this.refreshDailyChecklist());
  }
  onunload() {
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const timer of this.taskDebounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.taskDebounceTimers.clear();
    if (this.periodicSyncTimer) {
      window.clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
    if (this.taskSyncTimer) {
      window.clearInterval(this.taskSyncTimer);
      this.taskSyncTimer = null;
    }
    if (this.reminderTimer) {
      window.clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
  }
  setupPeriodicRemoteCheck() {
    if (this.periodicSyncTimer) {
      window.clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
    if (!this.settings.periodicRemoteCheckEnabled) return;
    const rawMinutes = Number.isFinite(this.settings.periodicRemoteCheckMinutes) ? this.settings.periodicRemoteCheckMinutes : 15;
    const minutes = Math.max(1, Math.floor(rawMinutes));
    const intervalMs = minutes * 60 * 1e3;
    this.periodicSyncTimer = window.setInterval(() => {
      void this.runPeriodicRemoteCheck();
    }, intervalMs);
    this.logDebug(`Periodic remote check enabled (${minutes}m).`);
    void this.runPeriodicRemoteCheck();
  }
  setupTaskSyncInterval() {
    if (this.taskSyncTimer) {
      window.clearInterval(this.taskSyncTimer);
      this.taskSyncTimer = null;
    }
    if (!this.settings.taskSyncIntervalEnabled) return;
    const rawMinutes = Number.isFinite(this.settings.taskSyncIntervalMinutes) ? this.settings.taskSyncIntervalMinutes : 10;
    const minutes = Math.max(1, Math.floor(rawMinutes));
    const intervalMs = minutes * 60 * 1e3;
    this.taskSyncTimer = window.setInterval(() => {
      void this.runPeriodicTaskSync();
    }, intervalMs);
    this.logDebug(`Task sync interval enabled (${minutes}m).`);
    void this.runPeriodicTaskSync();
  }
  setupReminders() {
    if (this.reminderTimer) {
      window.clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
    if (!this.settings.remindersEnabled) return;
    const rawMinutes = Number.isFinite(this.settings.remindersMinutes) ? this.settings.remindersMinutes : 60;
    const minutes = Math.max(5, Math.floor(rawMinutes));
    const intervalMs = minutes * 60 * 1e3;
    this.reminderTimer = window.setInterval(() => {
      void this.runReminderCheck();
    }, intervalMs);
    this.logDebug(`Task reminders enabled (${minutes}m).`);
    void this.runReminderCheck();
  }
  async runPeriodicRemoteCheck() {
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      return;
    }
    if (this.periodicSyncInFlight) return;
    this.periodicSyncInFlight = true;
    this.startProgress();
    this.updatePeriodicLock();
    this.setStatus("syncing");
    if (this.settings.periodicRemoteCheckNotices) {
      new import_obsidian2.Notice("Nextcloud sync: periodic check started.");
    }
    this.logDebug("Periodic remote check: start");
    const trackedPaths = Object.keys(this.state.files);
    try {
      if (this.hasDirtyFiles()) {
        if (!this.pausePeriodic) {
          this.pausePeriodic = true;
          this.logDebug("Periodic check paused: dirty files pending.");
        }
        const cleared = await this.waitForNoDirtyFiles();
        if (!cleared) {
          this.logDebug("Periodic check aborted: dirty files still pending.");
          return;
        }
        this.pausePeriodic = false;
      }
      for (const path of trackedPaths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian2.TFile)) continue;
        if (!this.isFileInScope(file)) continue;
        this.enqueueRemoteCheck(file.path, "periodic");
      }
      await this.syncRemoteNewFiles("periodic");
      await this.syncRemoteDeletions("periodic");
      if (this.settings.periodicRemoteCheckNotices) {
        new import_obsidian2.Notice("Nextcloud sync: periodic check finished.");
      }
    } finally {
      this.periodicSyncInFlight = false;
      this.updatePeriodicLock();
      this.updateIdleStatus();
    }
  }
  async runPeriodicTaskSync() {
    if (!this.settings.enableTaskSync) return;
    if (!this.settings.taskListUrl) return;
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      return;
    }
    if (this.hasDirtyFiles()) return;
    const client = this.getClientOrNotice();
    if (!client) return;
    const calendarUrl = this.normalizeCalendarUrl(this.settings.taskListUrl);
    let remoteTasks;
    try {
      remoteTasks = await this.fetchRemoteTasks(client, calendarUrl);
    } catch (error) {
      const message = this.describeError(error);
      this.logDebug(`Error (task interval): ${message}`);
      return;
    }
    const useTasksPlugin = this.isTasksPluginEnabled();
    const filesToUpdate = /* @__PURE__ */ new Map();
    for (const state of Object.values(this.state.tasks)) {
      if (this.isNoTaskSync(state.filePath)) continue;
      const file = this.app.vault.getAbstractFileByPath(state.filePath);
      if (!(file instanceof import_obsidian2.TFile)) continue;
      if (!this.isFileInScope(file)) continue;
      filesToUpdate.set(file.path, file);
    }
    for (const file of filesToUpdate.values()) {
      let content = await this.app.vault.read(file);
      const lines = content.split(/\r?\n/);
      const tasks = parseTaskLines(lines, { useTasksPlugin });
      let changed = false;
      for (const task of tasks) {
        if (!task.uid) continue;
        const remote = remoteTasks.get(task.uid);
        if (!remote) continue;
        const state = this.state.tasks[task.uid];
        if (!state) continue;
        const localLine = task.raw.trimEnd();
        const localChanged = state.lastSyncedLine !== localLine;
        const remoteChanged = !!state.lastRemoteModified && remote.lastModified !== state.lastRemoteModified || !!state.lastRemoteEtag && remote.etag !== state.lastRemoteEtag;
        if (!remoteChanged) continue;
        if (localChanged) continue;
        const updatedLine = buildTaskLine({
          prefix: task.prefix,
          checked: remote.completed,
          summary: remote.summary,
          tags: remote.categories,
          meta: mapRemoteToTaskMeta(remote),
          uid: task.uid,
          statusSymbol: task.statusSymbol,
          useTasksPlugin
        });
        lines[task.lineIndex] = updatedLine;
        changed = true;
        this.state.tasks[task.uid] = {
          uid: task.uid,
          filePath: file.path,
          lastSyncedLine: updatedLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag
        };
      }
      if (changed) {
        this.suppressModifyForPaths.add(file.path);
        await this.app.vault.modify(file, lines.join("\n"));
      }
    }
    if (this.settings.taskInboxEnabled) {
      await this.appendRemoteTasksToInbox(remoteTasks, useTasksPlugin);
    }
    await this.savePluginData();
  }
  async runReminderCheck() {
    if (!this.settings.remindersEnabled) return;
    const tasks = await this.collectAllOpenTasks();
    const today = formatDateOnly(/* @__PURE__ */ new Date());
    const overdue = [];
    const dueToday = [];
    for (const task of tasks) {
      const due = task.meta.dueDate ?? task.meta.scheduledDate ?? task.meta.startDate;
      if (!due) continue;
      if (due < today) {
        overdue.push(task);
      } else if (due === today) {
        dueToday.push(task);
      }
    }
    let list = [];
    if (this.settings.remindersMode === "overdue") {
      list = overdue;
    } else if (this.settings.remindersMode === "today") {
      list = dueToday;
    } else {
      list = overdue.concat(dueToday);
    }
    if (list.length === 0) return;
    const count = Math.min(this.settings.remindersMaxCount, list.length);
    const label = list.length === 1 ? "task" : "tasks";
    new import_obsidian2.Notice(`Nextcloud sync: ${list.length} ${label} due. Showing top ${count}.`);
  }
  async collectAllOpenTasks() {
    const tasks = [];
    const files = this.app.vault.getMarkdownFiles();
    const useTasksPlugin = this.isTasksPluginEnabled();
    for (const file of files) {
      if (this.isNoTaskSync(file.path)) continue;
      if (!this.isFileInScope(file)) continue;
      const content = await this.app.vault.read(file);
      const lines = content.split(/\r?\n/);
      const parsed = parseTaskLines(lines, { useTasksPlugin });
      for (const task of parsed) {
        if (!task.checked && task.summary.trim()) {
          tasks.push(task);
        }
      }
    }
    return tasks;
  }
  async appendRemoteTasksToInbox(remoteTasks, useTasksPlugin) {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    this.ensureInboxNoSync(inboxPath);
    if (this.isNoTaskSync(inboxPath)) return;
    let inboxFile = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!inboxFile) {
      const folder = inboxPath.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      inboxFile = await this.app.vault.create(inboxPath, "# Task Inbox\n");
    }
    if (!(inboxFile instanceof import_obsidian2.TFile)) return;
    let content = await this.app.vault.read(inboxFile);
    content = this.ensureInboxQueryBlock(content);
    const lines = content.split(/\r?\n/);
    const existingTasks = parseTaskLines(lines, { useTasksPlugin });
    const existingUids = new Set(existingTasks.map((task) => task.uid).filter(Boolean));
    const newLines = [];
    for (const remote of remoteTasks.values()) {
      if (this.state.tasks[remote.uid]) continue;
      if (existingUids.has(remote.uid)) continue;
      const line = buildTaskLine({
        prefix: "- ",
        checked: remote.completed,
        summary: remote.summary,
        tags: remote.categories,
        meta: mapRemoteToTaskMeta(remote),
        uid: remote.uid,
        statusSymbol: remote.completed ? "x" : " ",
        useTasksPlugin
      });
      newLines.push(line);
      this.state.tasks[remote.uid] = {
        uid: remote.uid,
        filePath: inboxPath,
        lastSyncedLine: line,
        lastRemoteModified: remote.lastModified,
        lastRemoteEtag: remote.etag
      };
    }
    if (newLines.length === 0) return;
    const separator = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    const updated = content + separator + newLines.join("\n") + "\n";
    this.suppressModifyForPaths.add(inboxPath);
    await this.app.vault.modify(inboxFile, updated);
  }
  ensureInboxQueryBlock(content) {
    const query = this.settings.taskInboxQuery.trim();
    if (!query) return content;
    const hasQuery = /```tasks[\s\S]*?```/m.test(content);
    if (hasQuery) return content;
    const block = `${query}

`;
    if (content.trim().length === 0) {
      return `# Task Inbox

${block}`;
    }
    return content.startsWith("#") ? `${content}

${block}` : `# Task Inbox

${block}${content}`;
  }
  async reconcileTaskOwnership(file, content) {
    if (!this.settings.taskInboxEnabled) return;
    if (!this.settings.taskInboxAutoMove) return;
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    this.ensureInboxNoSync(inboxPath);
    if (file.path === inboxPath) return;
    if (this.isNoTaskSync(file.path)) return;
    const useTasksPlugin = this.isTasksPluginEnabled();
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    const seen = /* @__PURE__ */ new Set();
    let moved = false;
    for (const task of tasks) {
      if (!task.uid) continue;
      if (seen.has(task.uid)) continue;
      seen.add(task.uid);
      const state = this.state.tasks[task.uid];
      if (!state) continue;
      if (state.filePath !== inboxPath) continue;
      state.filePath = file.path;
      state.lastSyncedLine = task.raw.trimEnd();
      this.state.tasks[task.uid] = state;
      this.suppressTaskDeletePrompt.add(task.uid);
      await this.removeTaskLineByUid(inboxPath, task.uid);
      moved = true;
    }
    if (moved) {
      await this.savePluginData();
    }
  }
  async removeTaskLineByUid(path, uid) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) return;
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const useTasksPlugin = this.isTasksPluginEnabled();
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    let changed = false;
    for (const task of tasks) {
      if (task.uid !== uid) continue;
      lines.splice(task.lineIndex, 1);
      changed = true;
      break;
    }
    if (!changed) return;
    this.suppressModifyForPaths.add(path);
    await this.app.vault.modify(file, lines.join("\n"));
  }
  resolvePathTemplate(template) {
    const date = formatDateOnly(/* @__PURE__ */ new Date());
    return template.replace(/\{\{date\}\}/g, date);
  }
  async refreshTodayNote() {
    if (!this.settings.todayNoteEnabled) return;
    const path = this.resolvePathTemplate(this.settings.todayNotePath.trim() || "Today.md");
    const limit = Math.max(1, this.settings.todayNoteLimit);
    const useQuery = this.settings.todayNoteUseQuery && this.isTasksPluginEnabled();
    let content = `# Today Focus

`;
    if (useQuery) {
      const query = (this.settings.todayNoteQuery || "").replace(/\{\{limit\}\}/g, String(limit));
      content += `${query}
`;
    } else {
      const tasks = await this.collectAllOpenTasks();
      const sorted = tasks.sort((a, b) => compareTaskPriority(a, b));
      const top = sorted.slice(0, limit);
      if (top.length === 0) {
        content += "_No open tasks._\n";
      } else {
        for (const task of top) {
          content += `- [ ] ${task.summary}
`;
        }
      }
    }
    await this.writeNote(path, content, true);
    await this.updateProgressLine(path);
  }
  async refreshDailyChecklist() {
    if (!this.settings.dailyChecklistEnabled) return;
    const today = formatDateOnly(/* @__PURE__ */ new Date());
    if (this.state.lastChecklistDate === today) return;
    const path = this.resolvePathTemplate(this.settings.dailyChecklistPath.trim() || "Daily Checklist.md");
    this.ensureChecklistNoSync(path);
    const content = `# Daily Checklist (${today})

${this.settings.dailyChecklistTemplate.trim()}
`;
    await this.writeNote(path, content, true);
    this.state.lastChecklistDate = today;
    await this.savePluginData();
  }
  async quickCaptureTask() {
    const data = await this.promptQuickCapture();
    if (!data || !data.summary.trim()) return;
    const path = this.resolvePathTemplate(this.settings.quickCapturePath.trim() || "Task Inbox.md");
    const useTasksPlugin = this.isTasksPluginEnabled();
    const shouldAddUid = this.settings.enableTaskSync && this.settings.taskListUrl.trim().length > 0;
    const line = shouldAddUid ? buildTaskLine({
      prefix: "- ",
      checked: data.checked,
      summary: data.summary.trim(),
      tags: data.tags,
      meta: data.meta,
      uid: generateUid(),
      statusSymbol: data.statusSymbol,
      useTasksPlugin
    }) : buildTaskLineNoUid({
      summary: data.summary.trim(),
      checked: data.checked,
      tags: data.tags,
      meta: data.meta,
      statusSymbol: data.statusSymbol,
      useTasksPlugin
    });
    await this.appendLineToNote(path, line);
    if (this.settings.enableTaskSync && this.settings.taskListUrl.trim()) {
      await this.syncTasksForPath(path);
    }
  }
  async startTaskAtCursor() {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    const { file, lineIndex, lines } = result;
    const line = lines[lineIndex] ?? "";
    if (!isTaskLine(line)) return;
    let updated = line;
    if (!updated.includes("#doing")) {
      updated = `${updated} #doing`.trimEnd();
    }
    lines.splice(lineIndex, 1);
    const insertIndex = findFirstTaskIndex(lines);
    lines.splice(insertIndex, 0, updated);
    await this.writeFileLines(file, lines);
  }
  async snoozeTaskToTomorrow() {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    const { file, lineIndex, lines } = result;
    let line = lines[lineIndex] ?? "";
    if (!isTaskLine(line)) return;
    const tomorrow = formatDateOnly(new Date(Date.now() + 864e5));
    if (line.match(/📅\s*\d{4}-\d{2}-\d{2}/)) {
      line = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `\u{1F4C5} ${tomorrow}`);
    } else {
      line = `${line} \u{1F4C5} ${tomorrow}`.trimEnd();
    }
    lines[lineIndex] = line;
    await this.writeFileLines(file, lines);
  }
  async addTimeBlockToTask() {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    const { file, lineIndex, lines } = result;
    let line = lines[lineIndex] ?? "";
    if (!isTaskLine(line)) return;
    const value = window.prompt("Time block (e.g., 10:00-11:00):");
    if (!value || !value.trim()) return;
    if (line.match(/🕒\s*[^\s]+/)) {
      line = line.replace(/🕒\s*[^\s]+/, `\u{1F552} ${value.trim()}`);
    } else {
      line = `${line} \u{1F552} ${value.trim()}`.trimEnd();
    }
    lines[lineIndex] = line;
    await this.writeFileLines(file, lines);
  }
  async sortTasksInActiveFile() {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    const { file, lines } = result;
    const useTasksPlugin = this.isTasksPluginEnabled();
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    if (tasks.length === 0) return;
    const sorted = [...tasks].sort((a, b) => compareTaskPriority(a, b));
    const sortedLines = sorted.map((task) => task.raw.trimEnd());
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      if (isTaskLine(lines[i])) {
        lines[i] = sortedLines[cursor] ?? lines[i];
        cursor += 1;
      }
    }
    await this.writeFileLines(file, lines);
  }
  async updateProgressLineInActiveFile() {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    await this.updateProgressLine(result.file.path);
  }
  async updateProgressLine(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) return;
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin: this.isTasksPluginEnabled() });
    const total = tasks.length;
    const done = tasks.filter((t) => t.checked).length;
    const percent = total === 0 ? 0 : Math.round(done / total * 100);
    const progressLine = `Progress: ${done}/${total} (${percent}%)`;
    const existingIndex = lines.findIndex((line) => line.startsWith("Progress:"));
    if (existingIndex !== -1) {
      lines[existingIndex] = progressLine;
    } else {
      const insertIndex = lines[0]?.startsWith("#") ? 1 : 0;
      lines.splice(insertIndex, 0, progressLine);
    }
    await this.writeFileLines(file, lines);
  }
  async writeNote(path, content, overwrite) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const folder = path.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      await this.app.vault.create(path, content);
      return;
    }
    if (file instanceof import_obsidian2.TFile && overwrite) {
      this.suppressModifyForPaths.add(path);
      await this.app.vault.modify(file, content);
    }
  }
  async appendLineToNote(path, line) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const folder = path.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      await this.app.vault.create(path, `# ${getFileName(path)}

${line}
`);
      return;
    }
    if (file instanceof import_obsidian2.TFile) {
      const content = await this.app.vault.read(file);
      const separator = content.endsWith("\n") || content.length === 0 ? "" : "\n";
      this.suppressModifyForPaths.add(path);
      await this.app.vault.modify(file, content + separator + line + "\n");
    }
  }
  async syncTasksForPath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) return;
    let content = await this.app.vault.read(file);
    const result = await this.syncTasksForFile(file, content, { force: true });
    if (result.changed) {
      this.suppressModifyForPaths.add(file.path);
      await this.app.vault.modify(file, result.content);
    }
  }
  async getActiveFileAndLine() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) return null;
    const lineIndex = editor.getCursor().line;
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    return { file, lineIndex, lines };
  }
  async writeFileLines(file, lines) {
    this.suppressModifyForPaths.add(file.path);
    await this.app.vault.modify(file, lines.join("\n"));
  }
  async promptQuickCapture() {
    return await new Promise((resolve) => {
      new QuickCaptureModal(this.app, resolve).open();
    });
  }
  isTasksPluginEnabled() {
    const plugins = this.app.plugins;
    if (!plugins) return false;
    const enabledSet = plugins.enabledPlugins;
    if (enabledSet && !enabledSet.has("obsidian-tasks-plugin")) return false;
    return Boolean(plugins.getPlugin?.("obsidian-tasks-plugin"));
  }
  isEncryptedCredential(value) {
    return Boolean(value) && value.startsWith(CREDENTIAL_PREFIX);
  }
  encodeBase64(bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  async getCredentialKey() {
    if (!globalThis.crypto?.subtle) {
      return null;
    }
    if (this.credentialKeyPromise) {
      return this.credentialKeyPromise;
    }
    this.credentialKeyPromise = (async () => {
      const storage = globalThis.localStorage;
      let encodedKey = storage.getItem(CREDENTIAL_KEY_STORAGE);
      if (!encodedKey) {
        const keyBytes = new Uint8Array(32);
        globalThis.crypto.getRandomValues(keyBytes);
        encodedKey = this.encodeBase64(keyBytes);
        storage.setItem(CREDENTIAL_KEY_STORAGE, encodedKey);
      }
      const rawKey = this.decodeBase64(encodedKey);
      return globalThis.crypto.subtle.importKey(
        "raw",
        rawKey,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
      );
    })();
    return this.credentialKeyPromise;
  }
  async encryptCredential(value) {
    if (!value) return "";
    if (this.isEncryptedCredential(value)) return value;
    const key = await this.getCredentialKey();
    if (!key) return value;
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(value);
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );
    const cipherBytes = new Uint8Array(cipherBuffer);
    const payload = `${this.encodeBase64(iv)}:${this.encodeBase64(cipherBytes)}`;
    return `${CREDENTIAL_PREFIX}${payload}`;
  }
  async decryptCredential(value) {
    if (!value) return "";
    if (!this.isEncryptedCredential(value)) return value;
    const key = await this.getCredentialKey();
    if (!key) return "";
    const payload = value.slice(CREDENTIAL_PREFIX.length);
    const [ivEncoded, cipherEncoded] = payload.split(":");
    if (!ivEncoded || !cipherEncoded) return "";
    try {
      const iv = this.decodeBase64(ivEncoded);
      const cipherBytes = this.decodeBase64(cipherEncoded);
      const plaintextBuffer = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipherBytes
      );
      return new TextDecoder().decode(plaintextBuffer);
    } catch (error) {
      this.logDebug(`Failed to decrypt stored credentials: ${error}`);
      return "";
    }
  }
  async loadPluginData() {
    const data = await this.loadData();
    if (data?.settings) {
      const storedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      const wasUsernameEncrypted = this.isEncryptedCredential(
        storedSettings.username
      );
      const wasPasswordEncrypted = this.isEncryptedCredential(
        storedSettings.appPassword
      );
      const wasNextcloudEncrypted = this.isEncryptedCredential(
        storedSettings.nextcloudBaseUrl
      );
      const wasTaskListEncrypted = this.isEncryptedCredential(
        storedSettings.taskListUrl
      );
      const wasCaldavEncrypted = this.isEncryptedCredential(
        storedSettings.caldavBaseUrl
      );
      this.settings = {
        ...storedSettings,
        nextcloudBaseUrl: await this.decryptCredential(storedSettings.nextcloudBaseUrl),
        username: await this.decryptCredential(storedSettings.username),
        appPassword: await this.decryptCredential(storedSettings.appPassword),
        taskListUrl: await this.decryptCredential(storedSettings.taskListUrl),
        caldavBaseUrl: await this.decryptCredential(storedSettings.caldavBaseUrl)
      };
      this.state = {
        files: data.state?.files ?? {},
        conflicts: data.state?.conflicts ?? {},
        deletionsApplied: data.state?.deletionsApplied ?? {},
        tasks: data.state?.tasks ?? {},
        noSync: data.state?.noSync ?? {},
        noTaskSync: data.state?.noTaskSync ?? {},
        lastChecklistDate: data.state?.lastChecklistDate ?? null
      };
      if (!wasUsernameEncrypted || !wasPasswordEncrypted || !wasNextcloudEncrypted || !wasTaskListEncrypted || !wasCaldavEncrypted) {
        await this.savePluginData();
      }
      return;
    }
    if (data && !data.settings) {
      const legacy = data;
      this.state = {
        files: legacy?.files ?? {},
        conflicts: legacy?.conflicts ?? {},
        deletionsApplied: legacy?.deletionsApplied ?? {},
        tasks: legacy?.tasks ?? {},
        noSync: {},
        noTaskSync: {},
        lastChecklistDate: null
      };
    }
  }
  async savePluginData() {
    const settings = {
      ...this.settings,
      nextcloudBaseUrl: await this.encryptCredential(this.settings.nextcloudBaseUrl),
      username: await this.encryptCredential(this.settings.username),
      appPassword: await this.encryptCredential(this.settings.appPassword),
      taskListUrl: await this.encryptCredential(this.settings.taskListUrl),
      caldavBaseUrl: await this.encryptCredential(this.settings.caldavBaseUrl)
    };
    const data = {
      settings,
      state: this.state
    };
    await this.saveData(data);
  }
  onVaultModify(file) {
    if (!(file instanceof import_obsidian2.TFile)) return;
    if (this.isNoSync(file.path)) {
      if (this.settings.enableTaskSync && !this.isNoTaskSync(file.path)) {
        this.scheduleTaskDebouncedSync(file.path);
      }
      return;
    }
    if (!this.isFileInScope(file)) return;
    if (this.suppressModifyForPaths.has(file.path)) {
      this.suppressModifyForPaths.delete(file.path);
      return;
    }
    this.setFileStatus(file.path, "dirty");
    if (!this.settings.syncOnModify) return;
    this.scheduleDebouncedSync(file.path, "modify");
  }
  onVaultDelete(file) {
    if (!(file instanceof import_obsidian2.TFile)) return;
    if (this.suppressDeletePrompt.has(file.path)) {
      this.suppressDeletePrompt.delete(file.path);
      return;
    }
    if (this.settings.taskInboxEnabled) {
      const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
      if (file.path === inboxPath) {
        void this.restoreTaskInbox();
        new import_obsidian2.Notice("Nextcloud sync: Task Inbox cannot be deleted.");
        return;
      }
    }
    this.fileStatuses.delete(file.path);
    this.updateFileExplorerIcon(file.path, null);
    if (this.state.conflicts[file.path]) {
      delete this.state.conflicts[file.path];
    }
    if (this.state.noSync[file.path]) {
      delete this.state.noSync[file.path];
    }
    if (this.state.noTaskSync[file.path]) {
      delete this.state.noTaskSync[file.path];
    }
    const lastState = this.state.files[file.path];
    if (this.state.files[file.path]) {
      delete this.state.files[file.path];
    }
    for (const [uid, task] of Object.entries(this.state.tasks)) {
      if (task.filePath === file.path) {
        delete this.state.tasks[uid];
      }
    }
    void this.savePluginData();
    if (!this.settings.promptRemoteDelete) return;
    if (!lastState?.lastSyncedHash) return;
    new RemoteDeleteModal(this.app, file.path, async (shouldDelete) => {
      if (!shouldDelete) return;
      try {
        await this.deleteRemoteAndRecord(file.path, lastState.lastKnownEtag);
      } catch (error) {
        const message = this.describeError(error);
        new import_obsidian2.Notice(`Nextcloud sync delete error: ${message}`);
      }
    }).open();
  }
  async onVaultRename(file, oldPath) {
    if (file.path === oldPath) return;
    if (this.settings.taskInboxEnabled) {
      const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
      if (oldPath === inboxPath && file.path !== inboxPath && file instanceof import_obsidian2.TFile) {
        try {
          await this.app.fileManager.renameFile(file, inboxPath);
          this.ensureInboxNoSync(inboxPath);
          await this.savePluginData();
          new import_obsidian2.Notice("Nextcloud sync: Task Inbox cannot be renamed.");
        } catch (error) {
          this.logDebug(`Inbox rename restore failed: ${this.describeError(error)}`);
        }
        return;
      }
    }
    if (file instanceof import_obsidian2.TFile) {
      await this.handleFileRename(file, oldPath);
      return;
    }
    if (file instanceof import_obsidian2.TFolder) {
      await this.handleFolderRename(file, oldPath);
    }
  }
  renameStatusEntries(oldPrefix, newPrefix) {
    for (const [path, status] of Array.from(this.fileStatuses.entries())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      const newPath = newPrefix + path.slice(oldPrefix.length);
      this.fileStatuses.delete(path);
      this.updateFileExplorerIcon(path, null);
      this.fileStatuses.set(newPath, status);
      this.updateFileExplorerIcon(newPath, status);
    }
  }
  renamePrefixInSet(set, oldPrefix, newPrefix) {
    for (const path of Array.from(set.values())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      set.delete(path);
      const newPath = newPrefix + path.slice(oldPrefix.length);
      set.add(newPath);
    }
  }
  renamePrefixInMap(map, oldPrefix, newPrefix) {
    for (const [path, value] of Array.from(map.entries())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      map.delete(path);
      const newPath = newPrefix + path.slice(oldPrefix.length);
      map.set(newPath, value);
    }
  }
  clearDebounceTimersForPrefix(oldPrefix) {
    for (const [path, timer] of Array.from(this.debounceTimers.entries())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      window.clearTimeout(timer);
      this.debounceTimers.delete(path);
    }
  }
  renamePrefixInQueue(oldPrefix, newPrefix) {
    for (const task of this.queue) {
      if (task.path !== oldPrefix && !task.path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      task.path = newPrefix + task.path.slice(oldPrefix.length);
    }
    this.renamePrefixInSet(this.queuedPaths, oldPrefix, newPrefix);
  }
  renamePrefixInRecord(record, oldPrefix, newPrefix, transform) {
    const moved = [];
    for (const [path, value] of Object.entries(record)) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      const newPath = newPrefix + path.slice(oldPrefix.length);
      record[newPath] = transform ? transform(value, newPath) : value;
      delete record[path];
      moved.push(newPath);
    }
    return moved;
  }
  updateTaskPathsForRename(oldPrefix, newPrefix) {
    for (const task of Object.values(this.state.tasks)) {
      if (task.filePath !== oldPrefix && !task.filePath.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      task.filePath = newPrefix + task.filePath.slice(oldPrefix.length);
    }
  }
  async handleFileRename(file, oldPath) {
    const newPath = file.path;
    const previousState = this.state.files[oldPath];
    const previousConflict = this.state.conflicts[oldPath];
    if (previousState) {
      this.state.files[newPath] = { ...previousState, vaultPath: newPath };
      delete this.state.files[oldPath];
    }
    if (previousConflict) {
      this.state.conflicts[newPath] = {
        ...previousConflict,
        vaultPath: newPath,
        remotePath: this.buildRemotePath(newPath)
      };
      delete this.state.conflicts[oldPath];
    }
    this.renameStatusEntries(oldPath, newPath);
    this.renamePrefixInMap(this.lastFocusChecks, oldPath, newPath);
    this.renamePrefixInSet(this.suppressModifyForPaths, oldPath, newPath);
    this.renamePrefixInSet(this.suppressDeletePrompt, oldPath, newPath);
    this.renamePrefixInSet(this.previewFiles, oldPath, newPath);
    this.renamePrefixInQueue(oldPath, newPath);
    this.clearDebounceTimersForPrefix(oldPath);
    this.updateTaskPathsForRename(oldPath, newPath);
    this.renamePrefixInRecord(this.state.noSync, oldPath, newPath);
    this.renamePrefixInRecord(this.state.noTaskSync, oldPath, newPath);
    if (this.currentSyncPath === oldPath) {
      this.currentSyncPath = newPath;
    }
    if (!this.isFileInScope(file)) {
      delete this.state.files[newPath];
      delete this.state.conflicts[newPath];
      this.fileStatuses.delete(newPath);
      this.updateFileExplorerIcon(newPath, null);
      await this.savePluginData();
      return;
    }
    await this.savePluginData();
    if (previousState?.lastSyncedHash) {
      const moved = await this.moveRemotePath(oldPath, newPath);
      if (!moved) {
        this.enqueueSync(newPath, "rename");
      }
    } else {
      this.enqueueSync(newPath, "rename");
    }
  }
  async handleFolderRename(folder, oldPath) {
    const newPath = folder.path;
    let movedFiles = this.renamePrefixInRecord(
      this.state.files,
      oldPath,
      newPath,
      (value, path) => ({ ...value, vaultPath: path })
    );
    this.renamePrefixInRecord(
      this.state.conflicts,
      oldPath,
      newPath,
      (value, path) => ({ ...value, vaultPath: path, remotePath: this.buildRemotePath(path) })
    );
    this.renameStatusEntries(oldPath, newPath);
    this.renamePrefixInMap(this.lastFocusChecks, oldPath, newPath);
    this.renamePrefixInSet(this.suppressModifyForPaths, oldPath, newPath);
    this.renamePrefixInSet(this.suppressDeletePrompt, oldPath, newPath);
    this.renamePrefixInSet(this.previewFiles, oldPath, newPath);
    this.renamePrefixInQueue(oldPath, newPath);
    this.clearDebounceTimersForPrefix(oldPath);
    this.updateTaskPathsForRename(oldPath, newPath);
    this.renamePrefixInRecord(this.state.noSync, oldPath, newPath);
    this.renamePrefixInRecord(this.state.noTaskSync, oldPath, newPath);
    movedFiles = movedFiles.filter((path) => {
      const fileItem = this.app.vault.getAbstractFileByPath(path);
      if (!(fileItem instanceof import_obsidian2.TFile) || !this.isFileInScope(fileItem)) {
        delete this.state.files[path];
        delete this.state.conflicts[path];
        this.fileStatuses.delete(path);
        this.updateFileExplorerIcon(path, null);
        return false;
      }
      return true;
    });
    if (this.currentSyncPath && (this.currentSyncPath === oldPath || this.currentSyncPath.startsWith(`${oldPath}/`))) {
      this.currentSyncPath = newPath + this.currentSyncPath.slice(oldPath.length);
    }
    const scopedFiles = this.app.vault.getMarkdownFiles().filter((fileItem) => fileItem.path.startsWith(`${newPath}/`) && this.isFileInScope(fileItem));
    if (scopedFiles.length === 0) {
      await this.savePluginData();
      return;
    }
    await this.savePluginData();
    if (movedFiles.length > 0) {
      const moved = await this.moveRemotePath(oldPath, newPath);
      if (moved) {
        return;
      }
    }
    for (const fileItem of scopedFiles) {
      this.enqueueSync(fileItem.path, "rename-folder");
    }
  }
  async promptDeleteWithSync(file) {
    const lastState = this.state.files[file.path];
    const synced = !!lastState?.lastSyncedHash;
    new DeleteWithSyncModal(this.app, file.path, synced, async (action) => {
      if (action === "cancel") return;
      this.suppressDeletePrompt.add(file.path);
      await this.app.vault.trash(file, true);
      this.fileStatuses.delete(file.path);
      this.updateFileExplorerIcon(file.path, null);
      delete this.state.files[file.path];
      delete this.state.conflicts[file.path];
      await this.savePluginData();
      if (action === "delete-remote" && synced) {
        try {
          await this.deleteRemoteAndRecord(file.path, lastState?.lastKnownEtag ?? null);
        } catch (error) {
          const message = this.describeError(error);
          new import_obsidian2.Notice(`Nextcloud sync delete error: ${message}`);
        }
      }
    }).open();
  }
  onFileOpen(file) {
    const previous = this.lastActiveFile;
    this.lastActiveFile = file;
    if (this.settings.syncOnFileClose && previous && previous !== file) {
      let isArchive = false;
      let isInbox = false;
      if (this.settings.taskInboxEnabled) {
        const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
        const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
        if (previous.path === inboxPath) {
          isInbox = true;
          void this.archiveInboxCompleted();
        }
        if (previous.path === archivePath) {
          isArchive = true;
          void this.restoreArchiveToInbox();
        }
      }
      if (this.isNoSync(previous.path)) {
        if (!isArchive && !isInbox && this.settings.enableTaskSync && !this.isNoTaskSync(previous.path)) {
          void this.syncTasksForPath(previous.path);
        }
      } else if (this.isFileInScope(previous)) {
        this.enqueueSync(previous.path, "file-close");
      }
    }
    if (this.settings.checkRemoteOnOpen && file && this.isFileInScope(file)) {
      this.enqueueRemoteCheck(file.path, "file-open");
    }
    if (file && this.settings.taskInboxEnabled) {
      const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
      if (file.path === archivePath) {
        this.ensureArchiveNoSync(archivePath);
        void this.savePluginData();
      }
    }
  }
  onWindowFocus() {
    if (!this.settings.checkRemoteOnFocus) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.isFileInScope(file)) return;
    const now = Date.now();
    const last = this.lastFocusChecks.get(file.path) ?? 0;
    if (now - last < this.settings.focusCheckThrottleMs) return;
    this.lastFocusChecks.set(file.path, now);
    this.enqueueRemoteCheck(file.path, "window-focus");
    void this.syncRemoteDeletions("window-focus");
  }
  scheduleDebouncedSync(path, reason) {
    const current = this.debounceTimers.get(path);
    if (current) {
      window.clearTimeout(current);
    }
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(path);
      this.enqueueSync(path, reason);
    }, this.settings.debounceMs);
    this.debounceTimers.set(path, timer);
  }
  scheduleTaskDebouncedSync(path) {
    const current = this.taskDebounceTimers.get(path);
    if (current) {
      window.clearTimeout(current);
    }
    const timer = window.setTimeout(() => {
      this.taskDebounceTimers.delete(path);
      void this.syncTasksForPath(path);
    }, this.settings.debounceMs);
    this.taskDebounceTimers.set(path, timer);
  }
  enqueueSync(path, reason) {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "sync" });
      this.queuedPaths.add(path);
      this.addProgressTotal(1);
      this.logDebug(`Queued: ${path} (${reason})`);
    }
    void this.processQueue();
  }
  enqueueRemoteCheck(path, reason) {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "check" });
      this.queuedPaths.add(path);
      if (reason === "periodic") {
        this.updatePeriodicLock();
      }
      this.addProgressTotal(1);
      this.logDebug(`Queued (check): ${path} (${reason})`);
    }
    void this.processQueue();
  }
  async processQueue() {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) continue;
        this.queuedPaths.delete(task.path);
        if (task.reason === "periodic") {
          this.updatePeriodicLock();
        }
        this.logDebug(`Processing: ${task.path} (${task.reason})`);
        if (task.kind === "check") {
          await this.checkRemoteForPath(task.path, task.reason);
        } else {
          await this.syncFileByPath(task.path, task.reason);
        }
        if (task.reason === "periodic") {
          this.updatePeriodicLock();
        }
        this.markProgressDone(1);
      }
    } finally {
      this.queueRunning = false;
      this.updatePeriodicLock();
      this.updateIdleStatus();
    }
  }
  async syncAllMarkdown() {
    if (this.hasDirtyFiles()) {
      new import_obsidian2.Notice("Nextcloud sync: waiting for dirty files before Sync all.");
      const cleared = await this.waitForNoDirtyFiles();
      if (!cleared) {
        new import_obsidian2.Notice("Nextcloud sync: Sync all canceled (dirty files still pending).");
        return;
      }
    }
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isFileInScope(file)) continue;
      this.enqueueSync(file.path, "manual-all");
    }
    await this.syncRemoteNewFiles("manual-all");
  }
  getRemoteBaseUrl() {
    const base = this.settings.nextcloudBaseUrl.replace(/\/+$/, "");
    const user = encodeURIComponent(this.settings.username);
    return `${base}/remote.php/dav/files/${user}/`;
  }
  buildRemotePath(localPath) {
    const root = this.settings.remoteRoot.replace(/^\/+|\/+$/g, "");
    if (!root) return localPath;
    return `${root}/${localPath}`;
  }
  isFileInScope(file) {
    return this.isPathInScope(file.path);
  }
  isPathInScope(path) {
    if (this.isNoSync(path)) return false;
    if (!path.endsWith(".md")) return false;
    if (this.settings.enableChangelog && path === this.settings.changelogPath) {
      return false;
    }
    if (this.isInConflictArchive(path)) {
      return false;
    }
    if (this.isInPreviewFolder(path)) {
      return false;
    }
    if (this.isDeletionsLog(path)) {
      return false;
    }
    const includePatterns = parsePatterns(this.settings.includePatterns);
    const excludePatterns = parsePatterns(this.settings.excludePatterns);
    if (includePatterns.length > 0 && !matchAnyGlob(path, includePatterns)) {
      return false;
    }
    if (excludePatterns.length > 0 && matchAnyGlob(path, excludePatterns)) {
      return false;
    }
    return true;
  }
  isNoSync(path) {
    return Boolean(this.state.noSync[path]);
  }
  isNoTaskSync(path) {
    return Boolean(this.state.noTaskSync[path]);
  }
  async toggleNoSync(file) {
    if (this.isNoSync(file.path)) {
      delete this.state.noSync[file.path];
      await this.reconcileNoteTaskState(file);
      new import_obsidian2.Notice(`Nextcloud sync: enabled for ${file.path}`);
    } else {
      this.state.noSync[file.path] = true;
      this.fileStatuses.delete(file.path);
      this.updateFileExplorerIcon(file.path, null);
      new import_obsidian2.Notice(`Nextcloud sync: disabled for ${file.path}`);
    }
    await this.savePluginData();
  }
  async toggleNoTaskSync(file) {
    if (this.isNoTaskSync(file.path)) {
      delete this.state.noTaskSync[file.path];
      new import_obsidian2.Notice(`Nextcloud sync: task sync enabled for ${file.path}`);
    } else {
      this.state.noTaskSync[file.path] = true;
      new import_obsidian2.Notice(`Nextcloud sync: task sync disabled for ${file.path}`);
    }
    await this.savePluginData();
  }
  async reconcileNoteTaskState(file) {
    if (!this.settings.enableTaskSync) return;
    if (!this.settings.taskListUrl) return;
    if (this.isNoTaskSync(file.path)) return;
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin: this.isTasksPluginEnabled() });
    let changed = false;
    for (const task of tasks) {
      if (!task.uid) continue;
      const state = this.state.tasks[task.uid];
      if (!state) {
        this.state.tasks[task.uid] = {
          uid: task.uid,
          filePath: file.path,
          lastSyncedLine: task.raw.trimEnd(),
          lastRemoteModified: null,
          lastRemoteEtag: null
        };
        changed = true;
        continue;
      }
      if (state.filePath !== file.path) {
        state.filePath = file.path;
        state.lastSyncedLine = task.raw.trimEnd();
        this.state.tasks[task.uid] = state;
        changed = true;
      }
    }
    if (changed) {
      await this.savePluginData();
    }
  }
  ensureInboxNoSync(inboxPath) {
    if (!this.settings.taskInboxEnabled) return;
    if (!inboxPath) return;
    this.state.noSync[inboxPath] = true;
    if (this.state.noTaskSync[inboxPath]) {
      delete this.state.noTaskSync[inboxPath];
    }
  }
  ensureArchiveNoSync(path) {
    if (!path) return;
    this.state.noSync[path] = true;
    this.state.noTaskSync[path] = true;
  }
  ensureChecklistNoSync(path) {
    if (!path) return;
    this.state.noSync[path] = true;
  }
  async archiveInboxCompleted() {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
    const inboxFile = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!(inboxFile instanceof import_obsidian2.TFile)) return;
    const content = await this.app.vault.read(inboxFile);
    const lines = content.split(/\r?\n/);
    const useTasksPlugin = this.isTasksPluginEnabled();
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    const completed = tasks.filter((t) => t.checked);
    if (completed.length === 0) return;
    const remaining = new Set(tasks.filter((t) => !t.checked).map((t) => t.lineIndex));
    const updatedLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (isTaskLine(lines[i]) && !remaining.has(i)) continue;
      updatedLines.push(lines[i]);
    }
    for (const task of completed) {
      if (task.uid) {
        this.suppressTaskDeletePrompt.add(task.uid);
      }
    }
    this.suppressModifyForPaths.add(inboxPath);
    await this.app.vault.modify(inboxFile, updatedLines.join("\n"));
    await this.appendLineToNote(archivePath, "");
    const archiveFile = this.app.vault.getAbstractFileByPath(archivePath);
    if (archiveFile instanceof import_obsidian2.TFile) {
      const archiveContent = await this.app.vault.read(archiveFile);
      const separator = archiveContent.endsWith("\n") || archiveContent.length === 0 ? "" : "\n";
      const completedLines = completed.map((t) => t.raw.trimEnd()).join("\n");
      this.suppressModifyForPaths.add(archivePath);
      await this.app.vault.modify(archiveFile, archiveContent + separator + completedLines + "\n");
    }
    this.ensureArchiveNoSync(archivePath);
    await this.savePluginData();
  }
  async restoreArchiveToInbox() {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
    const archiveFile = this.app.vault.getAbstractFileByPath(archivePath);
    if (!(archiveFile instanceof import_obsidian2.TFile)) return;
    const content = await this.app.vault.read(archiveFile);
    const lines = content.split(/\r?\n/);
    const useTasksPlugin = this.isTasksPluginEnabled();
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    const reopened = tasks.filter((t) => !t.checked);
    if (reopened.length === 0) return;
    const remaining = new Set(tasks.filter((t) => t.checked).map((t) => t.lineIndex));
    const updatedLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (isTaskLine(lines[i]) && !remaining.has(i)) continue;
      updatedLines.push(lines[i]);
    }
    for (const task of reopened) {
      if (task.uid) {
        this.suppressTaskDeletePrompt.add(task.uid);
      }
    }
    this.suppressModifyForPaths.add(archivePath);
    await this.app.vault.modify(archiveFile, updatedLines.join("\n"));
    this.ensureInboxNoSync(inboxPath);
    const inboxFile = this.app.vault.getAbstractFileByPath(inboxPath);
    if (inboxFile instanceof import_obsidian2.TFile) {
      const inboxContent = await this.app.vault.read(inboxFile);
      const separator = inboxContent.endsWith("\n") || inboxContent.length === 0 ? "" : "\n";
      const reopenedLines = reopened.map((t) => t.raw.trimEnd()).join("\n");
      this.suppressModifyForPaths.add(inboxPath);
      await this.app.vault.modify(inboxFile, inboxContent + separator + reopenedLines + "\n");
    }
    for (const task of reopened) {
      if (!task.uid) continue;
      const state = this.state.tasks[task.uid];
      if (state) {
        state.filePath = inboxPath;
        state.lastSyncedLine = task.raw.trimEnd();
        this.state.tasks[task.uid] = state;
      }
    }
    await this.savePluginData();
    await this.syncTasksForPath(inboxPath);
  }
  async restoreTaskInbox() {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    this.ensureInboxNoSync(inboxPath);
    let file = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!file) {
      const folder = inboxPath.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      const content = this.ensureInboxQueryBlock("# Task Inbox\n\n");
      file = await this.app.vault.create(inboxPath, content);
    } else if (file instanceof import_obsidian2.TFile) {
      const content = await this.app.vault.read(file);
      const updated = this.ensureInboxQueryBlock(content);
      if (updated !== content) {
        this.suppressModifyForPaths.add(inboxPath);
        await this.app.vault.modify(file, updated);
      }
    }
    await this.savePluginData();
  }
  isInConflictArchive(path) {
    const folder = this.settings.conflictArchiveFolder.trim();
    if (!folder) return false;
    const normalized = folder.replace(/\/+$/, "");
    return path === normalized || path.startsWith(`${normalized}/`);
  }
  isInPreviewFolder(path) {
    const folder = ".sync-previews";
    return path === folder || path.startsWith(`${folder}/`);
  }
  isDeletionsLog(path) {
    const logPath = this.settings.remoteDeletionsPath.replace(/^\/+/, "");
    return path === logPath;
  }
  setStatus(status) {
    if (!this.statusBarItem) return;
    this.currentStatus = status;
    this.statusBarItem.empty();
    const detail = this.lockStatusPath ? " periodic check" : this.currentSyncPath ? ` ${this.currentSyncPath}` : "";
    const percent = this.progressActive && this.progressTotal > 0 ? ` (${Math.min(100, Math.floor(this.progressDone / this.progressTotal * 100))}%)` : "";
    switch (status) {
      case "syncing":
        (0, import_obsidian2.setIcon)(this.statusBarItem, "sync");
        this.statusBarItem.appendText(` Syncing${detail}${percent}`);
        break;
      case "conflict":
        (0, import_obsidian2.setIcon)(this.statusBarItem, "alert-triangle");
        this.statusBarItem.appendText(` Conflict${detail}${percent}`);
        break;
      case "error":
        (0, import_obsidian2.setIcon)(this.statusBarItem, "x-circle");
        this.statusBarItem.appendText(` Error${detail}${percent}`);
        break;
      default:
        (0, import_obsidian2.setIcon)(this.statusBarItem, "check-circle");
        this.statusBarItem.appendText(` Idle${detail}${percent}`);
        break;
    }
  }
  hasPeriodicWork() {
    if (this.periodicSyncInFlight) return true;
    return this.queue.some((task) => task.reason === "periodic");
  }
  updateIdleStatus() {
    if (this.queueRunning) return;
    if (this.queue.length > 0) return;
    if (this.hasPeriodicWork()) return;
    this.currentSyncPath = null;
    this.progressActive = false;
    this.progressTotal = 0;
    this.progressDone = 0;
    this.setStatus("idle");
  }
  hasDirtyFiles() {
    for (const status of this.fileStatuses.values()) {
      if (status === "dirty") return true;
    }
    return false;
  }
  async waitForNoDirtyFiles(timeoutMs = 12e4) {
    if (!this.hasDirtyFiles()) return true;
    return await new Promise((resolve) => {
      const interval = window.setInterval(() => {
        if (!this.hasDirtyFiles()) {
          window.clearInterval(interval);
          resolve(true);
        }
      }, 250);
      window.setTimeout(() => {
        window.clearInterval(interval);
        resolve(!this.hasDirtyFiles());
      }, timeoutMs);
    });
  }
  updatePeriodicLock() {
    const shouldLock = this.hasPeriodicWork();
    if (!shouldLock) {
      this.lockStatusPath = false;
      return;
    }
    this.lockStatusPath = true;
    this.currentSyncPath = "periodic check";
    this.setStatus(this.currentStatus);
  }
  startProgress() {
    if (this.progressActive) return;
    this.progressActive = true;
    this.progressTotal = 0;
    this.progressDone = 0;
  }
  addProgressTotal(count = 1) {
    if (count <= 0) return;
    this.startProgress();
    this.progressTotal += count;
    this.setStatus(this.currentStatus);
  }
  markProgressDone(count = 1) {
    if (!this.progressActive) return;
    this.progressDone += count;
    if (this.progressDone > this.progressTotal) {
      this.progressTotal = this.progressDone;
    }
    this.setStatus(this.currentStatus);
  }
  async syncFileByPath(path, reason) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) {
      this.logDebug(`Skip (not file): ${path}`);
      return;
    }
    if (this.state.conflicts[file.path]) {
      this.logDebug(`Skip (conflict exists): ${file.path}`);
      new import_obsidian2.Notice(`Nextcloud sync: conflict pending for ${file.path}. Resolve it first.`);
      this.setStatus("conflict");
      return;
    }
    if (!this.isFileInScope(file)) {
      this.logDebug(`Skip (out of scope): ${path}`);
      if (reason.startsWith("manual")) {
        new import_obsidian2.Notice(`Nextcloud sync skipped: ${path} not in scope.`);
      }
      return;
    }
    if (!this.lockStatusPath) {
      this.currentSyncPath = path;
    }
    this.setStatus("syncing");
    const baseUrl = this.getRemoteBaseUrl();
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      this.setStatus("error");
      this.logDebug("Error: missing credentials or base URL.");
      new import_obsidian2.Notice("Nextcloud sync: missing credentials or base URL.");
      return;
    }
    const client = new WebDavClient(baseUrl, this.settings.username, this.settings.appPassword);
    const remotePath = this.buildRemotePath(file.path);
    let localContent = await this.app.vault.read(file);
    const taskResult = await this.syncTasksForFile(file, localContent);
    if (taskResult.changed) {
      localContent = taskResult.content;
      this.suppressModifyForPaths.add(file.path);
      await this.app.vault.modify(file, localContent);
    }
    const localHash = await hashString(localContent);
    const state = this.state.files[file.path] ?? {
      vaultPath: file.path,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
      lastKnownLocalMtime: null
    };
    const syncAttempt = async () => {
      let remoteInfo = null;
      try {
        remoteInfo = await client.propfind(remotePath);
      } catch (error) {
        const status = error.status;
        if (status === 404) {
          this.logDebug(`Remote missing: ${remotePath}`);
          remoteInfo = null;
        } else {
          this.logDebug(`PROPFIND failed: ${remotePath} (${status ?? "unknown"})`);
          throw error;
        }
      }
      if (!remoteInfo) {
        await this.ensureRemoteFolders(client, remotePath);
        const response2 = await client.put(remotePath, localContent, {
          "If-None-Match": "*"
        });
        if (!response2.ok) {
          this.logDebug(`PUT failed: ${remotePath} (${response2.status})`);
          throw await this.handleWebDavError(response2, file.path);
        }
        this.logDebug(`Uploaded (new): ${remotePath}`);
        await this.updateStateAfterUpload(
          client,
          file.path,
          remotePath,
          localHash,
          file.stat.mtime,
          state
        );
        this.setFileStatus(file.path, "synced");
        await this.appendChangelogEntry(file.path, reason);
        return;
      }
      if (!state.lastSyncedHash) {
        const response2 = await client.get(remotePath);
        if (!response2.ok) {
          throw await this.handleWebDavError(response2, file.path);
        }
        const remoteContent = await response2.text();
        const remoteHash = await hashString(remoteContent);
        if (remoteHash !== localHash) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          this.setFileStatus(file.path, "conflict");
          new import_obsidian2.Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
          this.logDebug(`Conflict (initial): ${file.path}`);
          return;
        }
        state.lastSyncedHash = localHash;
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastKnownLocalMtime = file.stat.mtime;
        state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
        this.state.files[file.path] = state;
        await this.savePluginData();
        this.setFileStatus(file.path, "synced");
        return;
      }
      const lastEtag = normalizeEtag(state.lastKnownEtag);
      const remoteEtag = normalizeEtag(remoteInfo.etag);
      const remoteChanged = !!lastEtag && !!remoteEtag && lastEtag !== remoteEtag;
      const localChanged = state.lastSyncedHash !== localHash;
      if (remoteChanged && localChanged) {
        const conflictPath = await this.createConflictCopy(file, localContent);
        await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
        this.setStatus("conflict");
        this.setFileStatus(file.path, "conflict");
        new import_obsidian2.Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
        this.logDebug(`Conflict: ${file.path}`);
        return;
      }
      if (remoteChanged && !localChanged) {
        const response2 = await client.get(remotePath);
        if (!response2.ok) {
          this.logDebug(`GET failed: ${remotePath} (${response2.status})`);
          throw await this.handleWebDavError(response2, file.path);
        }
        const remoteContent = await response2.text();
        this.suppressModifyForPaths.add(file.path);
        await this.app.vault.modify(file, remoteContent);
        await this.reconcileTaskOwnership(file, remoteContent);
        state.lastSyncedHash = await hashString(remoteContent);
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastKnownLocalMtime = file.stat.mtime;
        state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
        this.state.files[file.path] = state;
        await this.savePluginData();
        this.logDebug(`Downloaded: ${remotePath}`);
        this.setFileStatus(file.path, "synced");
        return;
      }
      if (!localChanged) {
        if (reason.startsWith("manual")) {
          new import_obsidian2.Notice(`Nextcloud sync: ${file.path} has no changes to upload.`);
        }
        this.logDebug(`No changes: ${file.path}`);
        return;
      }
      const response = await client.put(remotePath, localContent, {
        "If-Match": remoteInfo.etag ?? "*"
      });
      if (!response.ok) {
        if (response.status === 412) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          this.setFileStatus(file.path, "conflict");
          new import_obsidian2.Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
          this.logDebug(`Conflict (412): ${file.path}`);
          return;
        }
        this.logDebug(`PUT failed: ${remotePath} (${response.status})`);
        throw await this.handleWebDavError(response, file.path);
      }
      this.logDebug(`Uploaded: ${remotePath}`);
      await this.updateStateAfterUpload(
        client,
        file.path,
        remotePath,
        localHash,
        file.stat.mtime,
        state
      );
      this.setFileStatus(file.path, "synced");
      await this.appendChangelogEntry(file.path, reason);
    };
    try {
      await this.retryWithBackoff(syncAttempt);
    } catch (error) {
      this.setStatus("error");
      const message = this.describeError(error);
      this.setFileStatus(path, "error");
      this.logDebug(`Error: ${message}`);
      new import_obsidian2.Notice(`Nextcloud sync error: ${message}`);
    } finally {
      if (!this.lockStatusPath) {
        this.currentSyncPath = null;
      }
    }
  }
  async checkRemoteForPath(path, reason) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) {
      this.logDebug(`Skip (not file): ${path}`);
      return;
    }
    if (this.state.conflicts[file.path]) {
      this.logDebug(`Skip (conflict exists): ${file.path}`);
      this.setStatus("conflict");
      return;
    }
    if (!this.isFileInScope(file)) {
      this.logDebug(`Skip (out of scope): ${path}`);
      return;
    }
    if (!this.lockStatusPath) {
      this.currentSyncPath = path;
    }
    this.setStatus("syncing");
    const client = this.getClientOrNotice();
    if (!client) return;
    const remotePath = this.buildRemotePath(file.path);
    const state = this.state.files[file.path] ?? {
      vaultPath: file.path,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
      lastKnownLocalMtime: null
    };
    const checkAttempt = async () => {
      let localContent = null;
      let remoteInfo = null;
      try {
        remoteInfo = await client.propfind(remotePath);
      } catch (error) {
        const status = error.status;
        if (status === 404) {
          this.logDebug(`Remote missing (check): ${remotePath}`);
          return;
        }
        throw error;
      }
      if (!remoteInfo) return;
      const localMtime = file.stat.mtime;
      const lastEtag = normalizeEtag(state.lastKnownEtag);
      const remoteEtag = normalizeEtag(remoteInfo.etag);
      const remoteChanged = !!lastEtag && !!remoteEtag && lastEtag !== remoteEtag;
      if (!state.lastSyncedHash) {
        localContent = await this.app.vault.read(file);
        const taskResult = await this.syncTasksForFile(file, localContent);
        if (taskResult.changed) {
          localContent = taskResult.content;
          this.suppressModifyForPaths.add(file.path);
          await this.app.vault.modify(file, localContent);
        }
        const localHash2 = await hashString(localContent);
        const response2 = await client.get(remotePath);
        if (!response2.ok) {
          throw await this.handleWebDavError(response2, file.path);
        }
        const remoteContent2 = await response2.text();
        const remoteHash = await hashString(remoteContent2);
        if (remoteHash !== localHash2) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          new import_obsidian2.Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
          this.logDebug(`Conflict (check initial): ${file.path}`);
          return;
        }
        state.lastSyncedHash = localHash2;
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastKnownLocalMtime = file.stat.mtime;
        state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
        this.state.files[file.path] = state;
        await this.savePluginData();
        return;
      }
      if (!remoteChanged) return;
      const canUseMtime = state.lastKnownLocalMtime !== null;
      const localChangedByMtime = canUseMtime && localMtime !== state.lastKnownLocalMtime;
      let localHash = state.lastSyncedHash ?? null;
      let localChanged = localChangedByMtime;
      if (!canUseMtime || localChangedByMtime) {
        localContent = await this.app.vault.read(file);
        const taskResult = await this.syncTasksForFile(file, localContent);
        if (taskResult.changed) {
          localContent = taskResult.content;
          this.suppressModifyForPaths.add(file.path);
          await this.app.vault.modify(file, localContent);
        }
        localHash = await hashString(localContent);
        localChanged = state.lastSyncedHash !== localHash;
      }
      if (localChanged) {
        const conflictPath = await this.createConflictCopy(
          file,
          localContent ?? await this.app.vault.read(file)
        );
        await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
        this.setStatus("conflict");
        this.setFileStatus(file.path, "conflict");
        new import_obsidian2.Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
        this.logDebug(`Conflict (check): ${file.path}`);
        return;
      }
      const response = await client.get(remotePath);
      if (!response.ok) {
        throw await this.handleWebDavError(response, file.path);
      }
      const remoteContent = await response.text();
      this.suppressModifyForPaths.add(file.path);
      await this.app.vault.modify(file, remoteContent);
      await this.reconcileTaskOwnership(file, remoteContent);
      state.lastSyncedHash = await hashString(remoteContent);
      state.lastKnownEtag = remoteInfo.etag;
      state.lastKnownRemoteMtime = remoteInfo.lastModified;
      state.lastKnownLocalMtime = file.stat.mtime;
      state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
      this.state.files[file.path] = state;
      await this.savePluginData();
      this.setFileStatus(file.path, "synced");
      this.logDebug(`Downloaded (check): ${remotePath}`);
    };
    try {
      await this.retryWithBackoff(checkAttempt);
    } catch (error) {
      this.setStatus("error");
      const message = this.describeError(error);
      this.setFileStatus(path, "error");
      this.logDebug(`Error (check): ${message}`);
      new import_obsidian2.Notice(`Nextcloud sync error: ${message}`);
    } finally {
      if (!this.lockStatusPath) {
        this.currentSyncPath = null;
      }
    }
  }
  async syncRemoteNewFiles(reason) {
    const client = this.getClientOrNotice();
    if (!client) return;
    const isPeriodic = reason === "periodic";
    const hadQueue = this.queueRunning || this.queue.length > 0;
    const showStatus = !isPeriodic;
    const showNotices = reason.startsWith("manual");
    if (!hadQueue && showStatus) {
      this.currentSyncPath = "remote scan";
      this.setStatus("syncing");
    }
    const remoteRoot = this.settings.remoteRoot.replace(/^\/+|\/+$/g, "");
    const remoteRootPrefix = remoteRoot ? `${remoteRoot}/` : "";
    const remoteConflictRoot = this.settings.conflictArchiveRemoteFolder.replace(/^\/+|\/+$/g, "");
    let entries;
    try {
      entries = await client.list(remoteRoot, "infinity");
    } catch (error) {
      const message = this.describeError(error);
      if (!isPeriodic) {
        this.setStatus("error");
      }
      this.logDebug(`Error (list remote): ${message}`);
      if (showNotices) {
        new import_obsidian2.Notice(`Nextcloud sync error: ${message}`);
      }
      return;
    }
    let downloaded = 0;
    let failed = 0;
    for (const entry of entries) {
      if (entry.isCollection) continue;
      if (!entry.path.endsWith(".md")) continue;
      if (remoteRoot && entry.path === remoteRoot) continue;
      if (remoteConflictRoot) {
        if (entry.path === remoteConflictRoot || entry.path.startsWith(`${remoteConflictRoot}/`)) {
          continue;
        }
      }
      if (remoteRoot && !entry.path.startsWith(remoteRootPrefix)) continue;
      const localPath = remoteRoot ? entry.path.slice(remoteRootPrefix.length) : entry.path;
      if (!localPath) continue;
      if (!this.isPathInScope(localPath)) continue;
      if (this.app.vault.getAbstractFileByPath(localPath)) continue;
      try {
        this.addProgressTotal(1);
        if (!this.lockStatusPath) {
          this.currentSyncPath = localPath;
        }
        await this.downloadRemoteFile(
          client,
          entry.path,
          localPath,
          entry.etag ?? null,
          entry.lastModified ?? null,
          reason
        );
        downloaded += 1;
      } catch (error) {
        failed += 1;
        this.logDebug(`Download failed: ${entry.path} (${this.describeError(error)})`);
      } finally {
        this.markProgressDone(1);
      }
    }
    if (downloaded > 0) {
      if (showNotices) {
        new import_obsidian2.Notice(`Nextcloud sync: downloaded ${downloaded} remote file(s).`);
      }
    }
    if (failed > 0) {
      if (showNotices) {
        new import_obsidian2.Notice("Nextcloud sync: some remote files could not be downloaded. Check sync log.");
      }
    }
    if (!hadQueue && showStatus) {
      this.currentSyncPath = null;
      this.updateIdleStatus();
    }
  }
  showSyncQueue() {
    new SyncQueueModal(this.app, this.currentSyncPath, this.queue).open();
  }
  showSyncLog() {
    new SyncLogModal(this.app, this.logEntries).open();
  }
  showConflicts() {
    new ConflictListModal(this.app, this).open();
  }
  async deleteRemoteAndRecord(path, lastKnownEtag) {
    const client = this.getClientOrNotice();
    if (!client) return;
    const remotePath = this.buildRemotePath(path);
    const headers = {};
    if (lastKnownEtag) {
      headers["If-Match"] = lastKnownEtag;
    }
    const response = await client.delete(remotePath, headers);
    if (!response.ok && response.status !== 404) {
      throw await this.handleWebDavError(response, path);
    }
    await this.appendDeletionRecord(client, path);
    new import_obsidian2.Notice(`Nextcloud sync: deleted ${path} on server.`);
  }
  async moveRemotePath(oldPath, newPath) {
    const client = this.getClientOrNotice();
    if (!client) return false;
    const remoteOld = this.buildRemotePath(oldPath);
    const remoteNew = this.buildRemotePath(newPath);
    try {
      await this.ensureRemoteFolders(client, remoteNew);
      const response = await client.move(remoteOld, remoteNew);
      if (response.ok) {
        this.logDebug(`Moved remote: ${remoteOld} -> ${remoteNew}`);
        return true;
      }
      if (response.status === 404) {
        this.logDebug(`Remote missing for move: ${remoteOld}`);
        return false;
      }
      throw await this.handleWebDavError(response, oldPath);
    } catch (error) {
      const message = this.describeError(error);
      this.logDebug(`Remote move failed: ${message}`);
      return false;
    }
  }
  async syncRemoteDeletions(reason) {
    if (!this.settings.applyRemoteDeletions) return;
    if (this.deletionSyncInFlight) return;
    this.deletionSyncInFlight = true;
    try {
      const client = this.getClientOrNotice();
      if (!client) return;
      const logPath = this.settings.remoteDeletionsPath.replace(/^\/+/, "");
      if (!logPath) return;
      const remoteLogPath = this.buildRemotePath(logPath);
      const { deletions } = await this.fetchDeletionLog(client, remoteLogPath);
      for (const entry of deletions) {
        if (this.state.deletionsApplied[entry.path]) continue;
        const localFile = this.app.vault.getAbstractFileByPath(entry.path);
        if (localFile instanceof import_obsidian2.TFile) {
          await this.app.vault.trash(localFile, true);
        }
        delete this.state.files[entry.path];
        delete this.state.conflicts[entry.path];
        this.fileStatuses.delete(entry.path);
        this.updateFileExplorerIcon(entry.path, null);
        this.state.deletionsApplied[entry.path] = entry.timestamp;
      }
      await this.savePluginData();
      this.logDebug(`Applied remote deletions (${reason}): ${deletions.length}`);
    } catch (error) {
      const message = this.describeError(error);
      this.logDebug(`Error (deletions): ${message}`);
    } finally {
      this.deletionSyncInFlight = false;
    }
  }
  async appendDeletionRecord(client, path) {
    const logPath = this.settings.remoteDeletionsPath.replace(/^\/+/, "");
    if (!logPath) return;
    const remoteLogPath = this.buildRemotePath(logPath);
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { deletions, etag, exists } = await this.fetchDeletionLog(client, remoteLogPath);
      deletions.push({ path, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
      const body = JSON.stringify({ deletions }, null, 2);
      const headers = {};
      if (etag) {
        headers["If-Match"] = etag;
      } else if (!exists) {
        headers["If-None-Match"] = "*";
      }
      const response = await client.put(remoteLogPath, body, headers);
      if (response.ok) {
        return;
      }
      if (response.status !== 412 || attempt === maxAttempts - 1) {
        throw await this.handleWebDavError(response, logPath);
      }
    }
  }
  async fetchDeletionLog(client, remoteLogPath) {
    let etag = null;
    let exists = true;
    try {
      const info = await client.propfind(remoteLogPath);
      etag = info.etag;
    } catch (error) {
      const status = error.status;
      if (status === 404) {
        exists = false;
      } else {
        throw error;
      }
    }
    if (!exists) {
      return { deletions: [], etag: null, exists: false };
    }
    const response = await client.get(remoteLogPath);
    if (!response.ok) {
      throw await this.handleWebDavError(response, remoteLogPath);
    }
    const text = await response.text();
    const parsed = safeJsonParse(text);
    const deletions = Array.isArray(parsed?.deletions) ? parsed.deletions : [];
    return { deletions, etag, exists: true };
  }
  async openRemoteHistory(file) {
    if (this.state.conflicts[file.path]) {
      new import_obsidian2.Notice(`Nextcloud sync: conflict pending for ${file.path}. Resolve it first.`);
      this.setStatus("conflict");
      return;
    }
    if (!this.isFileInScope(file)) {
      new import_obsidian2.Notice(`Nextcloud sync skipped: ${file.path} not in scope.`);
      return;
    }
    const client = this.getClientOrNotice();
    if (!client) return;
    const remotePath = this.buildRemotePath(file.path);
    this.setStatus("syncing");
    try {
      const fileId = await client.propfindFileId(remotePath);
      if (!fileId) {
        new import_obsidian2.Notice("Nextcloud sync: could not find remote file id.");
        return;
      }
      const base = this.settings.nextcloudBaseUrl.replace(/\/+$/, "");
      const metaUrl = `${base}/remote.php/dav/meta/${fileId}/v/`;
      const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getlastmodified />
    <d:getcontentlength />
  </d:prop>
</d:propfind>`;
      const xml = await client.propfindAbsolute(metaUrl, "1", body);
      const versions = parseVersionList(xml, metaUrl);
      if (versions.length === 0) {
        new import_obsidian2.Notice("Nextcloud sync: no remote versions found.");
        return;
      }
      new RemoteHistoryModal(
        this.app,
        file,
        versions,
        (entry) => this.openRemoteVersionPreview(file, entry)
      ).open();
    } catch (error) {
      const message = this.describeError(error);
      this.logDebug(`Error (history): ${message}`);
      new import_obsidian2.Notice(`Nextcloud sync error: ${message}`);
    } finally {
      this.setStatus("idle");
    }
  }
  getCalDavBaseUrl() {
    if (this.settings.caldavBaseUrl.trim()) {
      return this.settings.caldavBaseUrl.replace(/\/+$/, "");
    }
    const base = this.settings.nextcloudBaseUrl.replace(/\/+$/, "");
    return `${base}/remote.php/dav`;
  }
  getCalendarHomeUrl() {
    const base = this.getCalDavBaseUrl();
    const user = encodeURIComponent(this.settings.username);
    return `${base}/calendars/${user}/`;
  }
  findLockedTaskUid(filePath, normalizedLine) {
    if (!normalizedLine) return null;
    for (const state of Object.values(this.state.tasks)) {
      if (state.filePath !== filePath) continue;
      const normalizedState = stripTaskUid(state.lastSyncedLine);
      if (normalizedState === normalizedLine) {
        return state.uid;
      }
    }
    return null;
  }
  async syncTasksForFile(file, content, options) {
    if (this.isNoTaskSync(file.path)) {
      return { content, changed: false };
    }
    if (this.settings.taskInboxEnabled) {
      const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
      if (file.path === archivePath) {
        return { content, changed: false };
      }
    }
    if (!this.settings.enableTaskSync || !this.settings.taskSyncOnFileSync && !options?.force) {
      return { content, changed: false };
    }
    if (this.state.conflicts[file.path]) {
      return { content, changed: false };
    }
    if (!this.settings.taskListUrl) {
      return { content, changed: false };
    }
    const client = this.getClientOrNotice();
    if (!client) return { content, changed: false };
    const calendarUrl = this.normalizeCalendarUrl(this.settings.taskListUrl);
    const remoteTasks = await this.fetchRemoteTasks(client, calendarUrl);
    const cleanupMode = options?.cleanup ?? false;
    const remoteIndex = cleanupMode ? buildRemoteTaskIndex(remoteTasks) : null;
    const useTasksPlugin = this.isTasksPluginEnabled();
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    if (tasks.length === 0) return { content, changed: false };
    let changed = false;
    const seenUids = /* @__PURE__ */ new Set();
    for (const task of tasks) {
      const normalizedLine = stripTaskUid(task.raw);
      const lockedUid = this.findLockedTaskUid(file.path, normalizedLine);
      if (lockedUid && task.uid !== lockedUid) {
        const lockedLine = buildTaskLine({
          prefix: task.prefix,
          checked: task.checked,
          summary: task.summary,
          tags: task.tags,
          meta: task.meta,
          uid: lockedUid,
          statusSymbol: task.statusSymbol,
          useTasksPlugin
        });
        lines[task.lineIndex] = lockedLine;
        task.uid = lockedUid;
        changed = true;
      }
      let uid = task.uid;
      const summary = task.summary;
      const checked = task.checked;
      if (!uid) {
        if (cleanupMode) {
          const matched = popRemoteMatch(remoteIndex, summary, checked);
          if (matched) {
            uid = matched.uid;
            const updatedLine = buildTaskLine({
              prefix: task.prefix,
              checked,
              summary,
              tags: task.tags,
              meta: task.meta,
              uid,
              statusSymbol: task.statusSymbol,
              useTasksPlugin
            });
            lines[task.lineIndex] = updatedLine;
            this.state.tasks[uid] = {
              uid,
              filePath: file.path,
              lastSyncedLine: updatedLine,
              lastRemoteModified: matched.lastModified,
              lastRemoteEtag: matched.etag
            };
            changed = true;
            seenUids.add(uid);
            continue;
          }
          continue;
        }
        if (!summary.trim()) {
          continue;
        }
        uid = generateUid();
        const newLine = buildTaskLine({
          prefix: task.prefix,
          checked,
          summary,
          tags: task.tags,
          meta: task.meta,
          uid,
          statusSymbol: task.statusSymbol,
          useTasksPlugin
        });
        lines[task.lineIndex] = newLine;
        await this.createRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin);
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: newLine,
          lastRemoteModified: null,
          lastRemoteEtag: null
        };
        changed = true;
        seenUids.add(uid);
        continue;
      }
      seenUids.add(uid);
      const remote = remoteTasks.get(uid) ?? null;
      const state = this.state.tasks[uid];
      const localLine = lines[task.lineIndex];
      const localChanged = !state || state.lastSyncedLine !== localLine;
      const remoteChanged = !!remote && (!!state?.lastRemoteModified || !!state?.lastRemoteEtag) && (state?.lastRemoteModified && remote.lastModified !== state.lastRemoteModified || state?.lastRemoteEtag && remote.etag !== state.lastRemoteEtag);
      if (remote && remoteChanged && !localChanged) {
        const updatedLine = buildTaskLine({
          prefix: task.prefix,
          checked: remote.completed,
          summary: remote.summary,
          tags: remote.categories,
          meta: mapRemoteToTaskMeta(remote),
          uid,
          statusSymbol: task.statusSymbol,
          useTasksPlugin
        });
        lines[task.lineIndex] = updatedLine;
        changed = true;
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: updatedLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag
        };
        continue;
      }
      if (!remote) {
        await this.createRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin);
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: localLine,
          lastRemoteModified: null,
          lastRemoteEtag: null
        };
        continue;
      }
      if (localChanged) {
        if (remoteChanged) {
          const localMtime = file.stat.mtime;
          const remoteMtime = remote?.lastModified ? Date.parse(remote.lastModified) : Number.NaN;
          const keepRemote = !Number.isFinite(remoteMtime) || remoteMtime > localMtime;
          if (keepRemote && remote) {
            const updatedLine = buildTaskLine({
              prefix: task.prefix,
              checked: remote.completed,
              summary: remote.summary,
              tags: remote.categories,
              meta: mapRemoteToTaskMeta(remote),
              uid,
              statusSymbol: task.statusSymbol,
              useTasksPlugin
            });
            lines[task.lineIndex] = updatedLine;
            changed = true;
            this.state.tasks[uid] = {
              uid,
              filePath: file.path,
              lastSyncedLine: updatedLine,
              lastRemoteModified: remote.lastModified,
              lastRemoteEtag: remote.etag
            };
          } else {
            await this.updateRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin, remote.etag);
            this.state.tasks[uid] = {
              uid,
              filePath: file.path,
              lastSyncedLine: localLine,
              lastRemoteModified: remote.lastModified,
              lastRemoteEtag: remote.etag
            };
          }
          new import_obsidian2.Notice(`Task conflict for ${uid}. Kept newest change.`);
        } else {
          await this.updateRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin, remote.etag);
          this.state.tasks[uid] = {
            uid,
            filePath: file.path,
            lastSyncedLine: localLine,
            lastRemoteModified: remote.lastModified,
            lastRemoteEtag: remote.etag
          };
        }
      } else if (!remoteChanged) {
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: localLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag
        };
      }
    }
    for (const [uid, state] of Object.entries(this.state.tasks)) {
      if (state.filePath !== file.path || seenUids.has(uid)) continue;
      if (this.suppressTaskDeletePrompt.has(uid)) {
        this.suppressTaskDeletePrompt.delete(uid);
        delete this.state.tasks[uid];
        continue;
      }
      if (this.settings.taskInboxEnabled) {
        const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
        if (file.path === archivePath) {
          delete this.state.tasks[uid];
          continue;
        }
      }
      const remote = remoteTasks.get(uid) ?? null;
      if (!cleanupMode && remote) {
        const choice = await this.promptTaskDeletion(uid, remote.summary);
        if (choice === "delete") {
          await this.deleteRemoteTask(client, remote);
        } else if (choice === "complete") {
          await this.completeRemoteTask(client, calendarUrl, remote, useTasksPlugin);
        }
      }
      delete this.state.tasks[uid];
    }
    await this.savePluginData();
    return { content: lines.join("\n"), changed };
  }
  normalizeCalendarUrl(url) {
    if (url.startsWith("http")) {
      return url.replace(/\/+$/, "/");
    }
    const home = this.getCalendarHomeUrl();
    return `${home}${url.replace(/^\/+/, "")}`;
  }
  async fetchRemoteTasks(client, calendarUrl) {
    const body = `<?xml version="1.0"?>
<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
    const xml = await client.reportAbsolute(calendarUrl, body, "1");
    const responses = Array.from(xml.querySelectorAll("response"));
    const tasks = /* @__PURE__ */ new Map();
    for (const response of responses) {
      const href = response.querySelector("href")?.textContent ?? "";
      if (!href) continue;
      const calendarData = response.querySelector("calendar-data")?.textContent ?? "";
      if (!calendarData) continue;
      const etag = response.querySelector("getetag")?.textContent ?? null;
      const parsed = parseVtodo(calendarData);
      if (!parsed?.uid) continue;
      tasks.set(parsed.uid, {
        uid: parsed.uid,
        summary: parsed.summary ?? parsed.uid,
        completed: parsed.completed,
        lastModified: parsed.lastModified,
        etag,
        href: href.startsWith("http") ? href : new URL(href, calendarUrl).toString(),
        dueDate: parsed.dueDate,
        startDate: parsed.startDate,
        completedDate: parsed.completedDate,
        status: parsed.status,
        priority: parsed.priority,
        percentComplete: parsed.percentComplete,
        categories: parsed.categories,
        description: parsed.description,
        recurrenceRule: parsed.recurrenceRule
      });
    }
    return tasks;
  }
  async promptTaskDeletion(uid, summary) {
    if (!this.settings.taskDeletionPromptEnabled) {
      return this.settings.taskDeletionDefaultAction;
    }
    return await new Promise((resolve) => {
      new TaskDeleteModal(this.app, uid, summary, resolve).open();
    });
  }
  async deleteRemoteTask(client, remote) {
    const headers = {};
    if (remote.etag) {
      headers["If-Match"] = remote.etag;
    }
    const response = await client.deleteAbsolute(remote.href, headers);
    if (!response.ok && response.status !== 404) {
      throw await this.handleWebDavError(response, remote.href);
    }
  }
  async completeRemoteTask(client, calendarUrl, remote, useTasksPlugin) {
    const taskLine = {
      lineIndex: 0,
      raw: "",
      checked: true,
      summary: remote.summary,
      uid: remote.uid,
      prefix: "- ",
      statusSymbol: "x",
      tags: remote.categories ?? [],
      meta: mapRemoteToTaskMeta(remote)
    };
    await this.updateRemoteTask(
      client,
      calendarUrl,
      remote.uid,
      remote.summary,
      true,
      taskLine,
      useTasksPlugin,
      remote.etag
    );
  }
  async createRemoteTask(client, calendarUrl, uid, summary, completed, task, useTasksPlugin) {
    const url = `${calendarUrl.replace(/\/+$/, "/")}${uid}.ics`;
    const body = buildVtodo(uid, summary, completed, task, useTasksPlugin);
    const response = await client.putAbsolute(url, body, { "If-None-Match": "*" });
    if (!response.ok) {
      throw await this.handleWebDavError(response, uid);
    }
  }
  async updateRemoteTask(client, calendarUrl, uid, summary, completed, task, useTasksPlugin, etag) {
    const url = `${calendarUrl.replace(/\/+$/, "/")}${uid}.ics`;
    const body = buildVtodo(uid, summary, completed, task, useTasksPlugin);
    const headers = {};
    if (etag) {
      headers["If-Match"] = etag;
    }
    const response = await client.putAbsolute(url, body, headers);
    if (!response.ok) {
      throw await this.handleWebDavError(response, uid);
    }
  }
  async openTaskListPicker() {
    const client = this.getClientOrNotice();
    if (!client) return null;
    const homeUrl = this.getCalendarHomeUrl();
    const lists = await this.fetchTaskLists(client, homeUrl);
    if (lists.length === 0) {
      new import_obsidian2.Notice("Nextcloud sync: no task lists found.");
      return null;
    }
    return await new Promise((resolve) => {
      new TaskListModal(this.app, lists, (url) => resolve(url)).open();
    });
  }
  async fetchTaskLists(client, homeUrl) {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <cal:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;
    const xml = await client.propfindAbsolute(homeUrl, "1", body);
    const responses = Array.from(xml.querySelectorAll("response"));
    const lists = [];
    for (const response of responses) {
      const href = response.querySelector("href")?.textContent ?? "";
      const display = response.querySelector("displayname")?.textContent ?? "Tasks";
      const components = Array.from(response.querySelectorAll("supported-calendar-component-set comp")).map((node) => node.getAttribute("name")).filter(Boolean);
      if (!components.includes("VTODO")) continue;
      if (!href) continue;
      const url = href.startsWith("http") ? href : new URL(href, homeUrl).toString();
      lists.push({ name: display, url });
    }
    return lists;
  }
  async openRemoteVersionPreview(file, entry) {
    const client = this.getClientOrNotice();
    if (!client) return;
    const response = await client.getAbsolute(entry.href);
    if (!response.ok) {
      throw await this.handleWebDavError(response, file.path);
    }
    const content = await response.text();
    const previewFolder = ".sync-previews";
    await this.ensureLocalFolder(previewFolder);
    const timestamp = entry.lastModified ? formatTimestamp(entry.lastModified) : formatTimestamp((/* @__PURE__ */ new Date()).toISOString());
    const fileName = `${file.basename} (remote ${timestamp}).${file.extension || "md"}`;
    const previewPath = await this.getUniquePreviewPath(previewFolder, fileName);
    const previewFile = await this.app.vault.create(previewPath, content);
    this.previewFiles.add(previewFile.path);
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(previewFile, { state: { mode: "source" } });
    const view = leaf.view;
    if (view instanceof import_obsidian2.MarkdownView) {
      view.editor?.setOption?.("readOnly", true);
      view.setEditable?.(false);
    }
  }
  async getUniquePreviewPath(folder, fileName) {
    let candidate = `${folder}/${fileName}`;
    if (!this.app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    const dotIndex = fileName.lastIndexOf(".");
    const base = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
    const ext = dotIndex === -1 ? "" : fileName.slice(dotIndex);
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${folder}/${base} (${counter})${ext}`;
      counter += 1;
    }
    return candidate;
  }
  async cleanupPreviewFiles() {
    const openPaths = /* @__PURE__ */ new Set();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      const file = view?.file ?? null;
      if (file?.path) {
        openPaths.add(file.path);
      }
    });
    for (const path of Array.from(this.previewFiles)) {
      if (openPaths.has(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) {
        await this.app.vault.delete(file);
      }
      this.previewFiles.delete(path);
    }
  }
  logDebug(message) {
    if (!this.settings.enableDebug) return;
    const entry = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}`;
    this.logEntries.push(entry);
    if (this.logEntries.length > this.logLimit) {
      this.logEntries.shift();
    }
    console.debug("[YAA Nextcloud Sync]", message);
  }
  async ensureRemoteFolders(client, remotePath) {
    const parts = remotePath.split("/");
    if (parts.length <= 1) return;
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      const response = await client.mkcol(current);
      if (response.ok) continue;
      if (response.status === 405 || response.status === 301 || response.status === 409) {
        continue;
      }
      throw await this.handleWebDavError(response, current);
    }
  }
  async updateStateAfterUpload(client, vaultPath, remotePath, localHash, localMtime, state) {
    let updatedEtag = state.lastKnownEtag;
    let updatedMtime = state.lastKnownRemoteMtime;
    try {
      const info = await client.propfind(remotePath);
      updatedEtag = info.etag;
      updatedMtime = info.lastModified;
    } catch (error) {
    }
    state.lastSyncedHash = localHash;
    state.lastKnownEtag = updatedEtag;
    state.lastKnownRemoteMtime = updatedMtime;
    state.lastKnownLocalMtime = localMtime;
    state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    this.state.files[vaultPath] = state;
    await this.savePluginData();
  }
  async updateStateAfterDownload(vaultPath, content, remoteEtag, remoteMtime, localMtime) {
    const state = this.state.files[vaultPath] ?? {
      vaultPath,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
      lastKnownLocalMtime: null
    };
    state.lastSyncedHash = await hashString(content);
    state.lastKnownEtag = remoteEtag;
    state.lastKnownRemoteMtime = remoteMtime;
    state.lastKnownLocalMtime = localMtime;
    state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    this.state.files[vaultPath] = state;
    await this.savePluginData();
  }
  async downloadRemoteFile(client, remotePath, localPath, remoteEtag, remoteMtime, reason) {
    const response = await client.get(remotePath);
    if (!response.ok) {
      throw await this.handleWebDavError(response, localPath);
    }
    const content = await response.text();
    const folder = localPath.split("/").slice(0, -1).join("/");
    await this.ensureLocalFolder(folder);
    this.suppressModifyForPaths.add(localPath);
    const created = await this.app.vault.create(localPath, content);
    await this.reconcileTaskOwnership(created, content);
    await this.updateStateAfterDownload(
      localPath,
      content,
      remoteEtag,
      remoteMtime,
      created.stat.mtime
    );
    this.setFileStatus(localPath, "synced");
    this.logDebug(`Downloaded (new): ${remotePath}`);
  }
  async handleWebDavError(response, target) {
    const message = response.status === 401 || response.status === 403 ? "Authentication failed. Check username/app password." : `Request failed for ${target} (${response.status} ${response.statusText})`;
    return { status: response.status, message };
  }
  describeError(error) {
    if (typeof error === "string") return error;
    if (!error) return "Unknown error.";
    if (error.message) {
      return error.message;
    }
    if (error instanceof Error) return error.message;
    return "Unexpected error.";
  }
  async retryWithBackoff(task) {
    const delays = [500, 1500, 3500];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      try {
        await task();
        return;
      } catch (error) {
        const status = error.status;
        const transient = !status || status === 408 || status === 429 || status >= 500;
        if (!transient || attempt === delays.length - 1) {
          throw error;
        }
        await sleep(delays[attempt]);
      }
    }
  }
  async createConflictCopy(file, content) {
    const timestamp = /* @__PURE__ */ new Date();
    const date = timestamp.toISOString().slice(0, 10);
    const time = `${timestamp.getHours().toString().padStart(2, "0")}${timestamp.getMinutes().toString().padStart(2, "0")}`;
    const baseName = file.basename;
    const folder = file.parent?.path ?? "";
    let conflictPath = `${folder ? `${folder}/` : ""}${baseName} (conflict ${date} ${time}).md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(conflictPath)) {
      conflictPath = `${folder ? `${folder}/` : ""}${baseName} (conflict ${date} ${time} ${counter}).md`;
      counter += 1;
    }
    await this.app.vault.create(conflictPath, content);
    return conflictPath;
  }
  async appendChangelogEntry(path, reason) {
    if (!this.settings.enableChangelog) return;
    const entry = `- ${(/* @__PURE__ */ new Date()).toISOString()} | ${path} | ${reason}
`;
    const existing = this.app.vault.getAbstractFileByPath(this.settings.changelogPath);
    if (existing instanceof import_obsidian2.TFile) {
      await this.app.vault.append(existing, entry);
      return;
    }
    await this.app.vault.create(this.settings.changelogPath, `# Sync Changelog
${entry}`);
  }
  async storeConflict(vaultPath, conflictPath, remotePath, remoteEtag) {
    this.state.conflicts[vaultPath] = {
      vaultPath,
      conflictPath,
      remotePath,
      remoteEtag,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.savePluginData();
  }
  openConflictResolver(conflict) {
    new ConflictResolverModal(this.app, this, conflict).open();
  }
  getClientOrNotice() {
    const baseUrl = this.getRemoteBaseUrl();
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      this.setStatus("error");
      this.logDebug("Error: missing credentials or base URL.");
      new import_obsidian2.Notice("Nextcloud sync: missing credentials or base URL.");
      return null;
    }
    return new WebDavClient(baseUrl, this.settings.username, this.settings.appPassword);
  }
  async resolveConflictKeepLocal(conflict) {
    const file = this.app.vault.getAbstractFileByPath(conflict.vaultPath);
    if (!(file instanceof import_obsidian2.TFile)) {
      new import_obsidian2.Notice("Nextcloud sync: file no longer exists.");
      return;
    }
    const client = this.getClientOrNotice();
    if (!client) return;
    const localContent = await this.app.vault.read(file);
    const localHash = await hashString(localContent);
    const response = await client.put(conflict.remotePath, localContent, {
      "If-Match": conflict.remoteEtag ?? "*"
    });
    if (!response.ok) {
      if (response.status === 412) {
        new import_obsidian2.Notice("Nextcloud sync: conflict still exists. Remote changed again.");
        return;
      }
      throw await this.handleWebDavError(response, conflict.vaultPath);
    }
    const state = this.state.files[file.path] ?? {
      vaultPath: file.path,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
      lastKnownLocalMtime: null
    };
    await this.updateStateAfterUpload(
      client,
      file.path,
      conflict.remotePath,
      localHash,
      file.stat.mtime,
      state
    );
    if (this.settings.archiveConflictsOnResolve) {
      await this.archiveConflictCopy(conflict, client);
    } else {
      await this.deleteConflictFile(conflict.conflictPath);
    }
    delete this.state.conflicts[file.path];
    await this.savePluginData();
    this.setStatus("idle");
    this.setFileStatus(file.path, "synced");
    new import_obsidian2.Notice(`Nextcloud sync: kept local for ${file.path}`);
  }
  async resolveConflictKeepRemote(conflict) {
    const file = this.app.vault.getAbstractFileByPath(conflict.vaultPath);
    if (!(file instanceof import_obsidian2.TFile)) {
      new import_obsidian2.Notice("Nextcloud sync: file no longer exists.");
      return;
    }
    const client = this.getClientOrNotice();
    if (!client) return;
    const response = await client.get(conflict.remotePath);
    if (!response.ok) {
      throw await this.handleWebDavError(response, conflict.vaultPath);
    }
    const remoteContent = await response.text();
    this.suppressModifyForPaths.add(file.path);
    await this.app.vault.modify(file, remoteContent);
    let etag = conflict.remoteEtag;
    let mtime = null;
    try {
      const info = await client.propfind(conflict.remotePath);
      etag = info.etag;
      mtime = info.lastModified;
    } catch (error) {
    }
    const state = this.state.files[file.path] ?? {
      vaultPath: file.path,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
      lastKnownLocalMtime: null
    };
    state.lastSyncedHash = await hashString(remoteContent);
    state.lastKnownEtag = etag;
    state.lastKnownRemoteMtime = mtime;
    state.lastKnownLocalMtime = file.stat.mtime;
    state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    this.state.files[file.path] = state;
    if (this.settings.archiveConflictsOnResolve) {
      await this.archiveConflictCopy(conflict, client);
    } else {
      await this.deleteConflictFile(conflict.conflictPath);
    }
    delete this.state.conflicts[file.path];
    await this.savePluginData();
    this.setStatus("idle");
    this.setFileStatus(file.path, "synced");
    new import_obsidian2.Notice(`Nextcloud sync: kept remote for ${file.path}`);
  }
  async archiveConflictCopy(conflict, client) {
    const conflictFile = this.app.vault.getAbstractFileByPath(conflict.conflictPath);
    if (!(conflictFile instanceof import_obsidian2.TFile)) {
      return;
    }
    const conflictContent = await this.app.vault.read(conflictFile);
    const remoteArchiveRoot = this.settings.conflictArchiveRemoteFolder.replace(/^\/+|\/+$/g, "");
    if (remoteArchiveRoot) {
      const remoteArchivePath = `${remoteArchiveRoot}/${conflictFile.name}`;
      await this.ensureRemoteFolders(client, remoteArchivePath);
      const response = await client.put(remoteArchivePath, conflictContent, {
        "If-None-Match": "*"
      });
      if (!response.ok && response.status !== 405 && response.status !== 409) {
        this.logDebug(`Archive upload failed: ${remoteArchivePath} (${response.status})`);
      }
    }
    await this.deleteConflictFile(conflict.conflictPath);
  }
  async getUniqueArchivePath(folder, fileName) {
    let candidate = `${folder}/${fileName}`;
    if (!this.app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    const dotIndex = fileName.lastIndexOf(".");
    const base = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
    const ext = dotIndex === -1 ? "" : fileName.slice(dotIndex);
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${folder}/${base} (${counter})${ext}`;
      counter += 1;
    }
    return candidate;
  }
  async ensureLocalFolder(path) {
    if (!path) return;
    const parts = path.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const exists = this.app.vault.getAbstractFileByPath(current);
      if (!exists) {
        await this.app.vault.createFolder(current);
      }
    }
  }
  async deleteConflictFile(conflictPath) {
    const conflictFile = this.app.vault.getAbstractFileByPath(conflictPath);
    if (conflictFile instanceof import_obsidian2.TFile) {
      await this.app.vault.delete(conflictFile);
      return;
    }
    const abstract = this.app.vault.getAbstractFileByPath(conflictPath);
    if (abstract) {
      await this.app.vault.delete(abstract);
    }
  }
  async cleanupTaskIds() {
    if (!this.settings.enableTaskSync) {
      new import_obsidian2.Notice("Nextcloud sync: enable Task sync first.");
      return;
    }
    if (!this.settings.taskListUrl) {
      new import_obsidian2.Notice("Nextcloud sync: set Task list URL first.");
      return;
    }
    new import_obsidian2.Notice("Nextcloud sync: cleaning task IDs...");
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isFileInScope(file)) continue;
      const content = await this.app.vault.read(file);
      let updated = stripTaskUidKeepWhitespace(content);
      const legacyMatches = Array.from(content.matchAll(/<!--\s*nc-task:([A-Za-z0-9-]+)\s*-->/g));
      if (legacyMatches.length > 0) {
        const lines = updated.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(/^(\s*-\s+\[[^\]]\]\s+)(.*)$/);
          if (!match) continue;
          const body = match[2];
          const legacy = body.match(/<!--\s*nc-task:([A-Za-z0-9-]+)\s*-->/);
          if (!legacy) continue;
          const uid = legacy[1];
          const cleanedBody = body.replace(/<!--\s*nc-task:[A-Za-z0-9-]+\s*-->/g, "").trim();
          lines[i] = `${match[1]}${formatTaskUid(uid)} ${cleanedBody}`.trimEnd();
        }
        updated = lines.join("\n");
      }
      if (updated !== content) {
        this.suppressModifyForPaths.add(file.path);
        await this.app.vault.modify(file, updated);
      }
      for (const [uid, state] of Object.entries(this.state.tasks)) {
        if (state.filePath === file.path) {
          delete this.state.tasks[uid];
        }
      }
    }
    await this.savePluginData();
    for (const file of files) {
      if (!this.isFileInScope(file)) continue;
      let content = await this.app.vault.read(file);
      const result = await this.syncTasksForFile(file, content, { cleanup: true });
      if (result.changed) {
        this.suppressModifyForPaths.add(file.path);
        await this.app.vault.modify(file, result.content);
      }
    }
    await this.savePluginData();
    new import_obsidian2.Notice("Nextcloud sync: task ID cleanup finished.");
  }
  seedStatusesFromState() {
    for (const path of Object.keys(this.state.files)) {
      if (!this.fileStatuses.has(path)) {
        this.fileStatuses.set(path, "synced");
      }
    }
    for (const path of Object.keys(this.state.conflicts)) {
      this.fileStatuses.set(path, "conflict");
    }
    this.refreshFileExplorerIcons();
  }
  setFileStatus(path, status) {
    this.fileStatuses.set(path, status);
    this.updateFileExplorerIcon(path, status);
  }
  refreshFileExplorerIcons() {
    for (const [path, status] of this.fileStatuses.entries()) {
      this.updateFileExplorerIcon(path, status);
    }
  }
  updateFileExplorerIcon(path, status) {
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of leaves) {
      const view = leaf.view;
      const item = view.fileItems?.[path];
      const container = item?.titleEl ?? item?.el;
      if (!container) continue;
      const special = this.getSpecialNoteType(path);
      let specialEl = container.querySelector(".nc-special-note-icon");
      if (special) {
        if (!specialEl) {
          specialEl = container.createSpan({ cls: "nc-special-note-icon" });
        } else {
          specialEl.empty();
        }
        specialEl.classList.remove(
          "nc-special-note-inbox",
          "nc-special-note-archive",
          "nc-special-note-today",
          "nc-special-note-checklist"
        );
        specialEl.addClass(`nc-special-note-${special}`);
        const icon2 = special === "inbox" ? "inbox" : special === "archive" ? "archive" : special === "today" ? "calendar" : "check-square";
        (0, import_obsidian2.setIcon)(specialEl, icon2);
        container.addClass("nc-special-note");
      } else {
        container.removeClass("nc-special-note");
        if (specialEl) specialEl.remove();
      }
      let iconEl = container.querySelector(".sync-status-icon");
      if (!status) {
        if (iconEl) iconEl.remove();
        container.removeAttribute("aria-label");
        container.removeAttribute("title");
        continue;
      }
      if (!iconEl) {
        iconEl = container.createSpan({ cls: "sync-status-icon" });
      } else {
        iconEl.empty();
      }
      const icon = status === "synced" ? "check-circle" : status === "dirty" ? "circle" : status === "conflict" ? "alert-triangle" : "x-circle";
      (0, import_obsidian2.setIcon)(iconEl, icon);
      iconEl.setAttr("aria-label", `Sync status: ${status}`);
      iconEl.setAttr("title", `Sync status: ${status}`);
    }
  }
  getSpecialNoteType(path) {
    if (this.settings.taskInboxEnabled) {
      const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
      const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
      if (path === inboxPath) return "inbox";
      if (path === archivePath) return "archive";
    }
    if (this.settings.todayNoteEnabled) {
      const todayPath = this.resolvePathTemplate(this.settings.todayNotePath.trim() || "Today.md");
      if (path === todayPath) return "today";
    }
    if (this.settings.dailyChecklistEnabled) {
      const checklistPath = this.resolvePathTemplate(this.settings.dailyChecklistPath.trim() || "Daily Checklist.md");
      if (path === checklistPath) return "checklist";
    }
    return null;
  }
  applyStatusStyles() {
    const style = document.createElement("style");
    style.textContent = `
.nav-file-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nav-file-title-content {
  flex: 1 1 auto;
  min-width: 0;
}
.tree-item.nav-file {
  display: flex;
  align-items: center;
}
.sync-status-icon {
  opacity: 0.7;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  line-height: 1;
  flex: 0 0 auto;
}
.nc-special-note-icon {
  display: inline-flex;
  align-items: center;
  margin-right: 6px;
  opacity: 0.85;
  vertical-align: middle;
}
.nc-special-note-icon svg {
  width: 14px;
  height: 14px;
}
.nc-special-note {
  color: var(--text-accent);
}
.nc-special-note-icon.nc-special-note-inbox {
  color: var(--color-green);
}
.nc-special-note-icon.nc-special-note-archive {
  color: var(--color-orange);
}
.nc-special-note-icon.nc-special-note-today {
  color: var(--color-blue);
}
.nc-special-note-icon.nc-special-note-checklist {
  color: var(--color-yellow);
}
.nc-task-synced-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  opacity: 0.6;
  vertical-align: middle;
}
.nc-task-synced-icon svg {
  width: 14px;
  height: 14px;
}
.nc-sync-ribbon-spacer {
  margin: 6px 0;
  border-top: 1px solid var(--background-modifier-border);
}
.nc-sync-ribbon-icon {
  margin-top: 2px;
}
.nc-modal-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.nc-modal-label {
  font-size: 12px;
  opacity: 0.75;
}
.nc-modal-summary {
  min-height: 90px;
  resize: vertical;
  width: 100%;
}
`;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }
  addRibbonSeparator() {
    const ribbon = this.app.workspace.leftRibbonEl;
    if (!ribbon) return;
    const spacer = ribbon.createDiv({ cls: "nc-sync-ribbon-spacer" });
    this.register(() => spacer.remove());
  }
  addRibbonAction(icon, title, callback) {
    const el = this.addRibbonIcon(icon, title, callback);
    el.addClass("nc-sync-ribbon-icon");
  }
  registerTaskIdIconProcessor() {
    this.registerMarkdownPostProcessor((el) => {
      const touched = /* @__PURE__ */ new Set();
      const listItems = Array.from(el.querySelectorAll("li"));
      for (const li of listItems) {
        if (touched.has(li)) continue;
        if (!li.textContent?.includes("\u{1F194}")) continue;
        touched.add(li);
        let icon = li.querySelector(".nc-task-synced-icon");
        if (!icon) {
          icon = document.createElement("span");
          icon.className = "nc-task-synced-icon";
          (0, import_obsidian2.setIcon)(icon, "check-circle");
          const checkbox = li.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.insertAdjacentElement("afterend", icon);
          } else {
            li.insertBefore(icon, li.firstChild);
          }
        }
      }
    });
  }
};
var SyncSettingTab = class extends import_obsidian2.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Nextcloud Sync Suite" });
    containerEl.createEl("h3", { text: "Connection" });
    new import_obsidian2.Setting(containerEl).setName("Nextcloud base URL").setDesc("Base URL of your Nextcloud (e.g., https://cloud.example.com)").addText(
      (text) => text.setPlaceholder("https://cloud.example.com").setValue(this.plugin.settings.nextcloudBaseUrl).onChange(async (value) => {
        this.plugin.settings.nextcloudBaseUrl = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Username").setDesc("Nextcloud username").addText(
      (text) => text.setPlaceholder("username").setValue(this.plugin.settings.username).onChange(async (value) => {
        this.plugin.settings.username = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("App password").setDesc("Nextcloud app password (stored locally)").addText(
      (text) => text.setPlaceholder("app password").setValue(this.plugin.settings.appPassword).onChange(async (value) => {
        this.plugin.settings.appPassword = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote root folder").setDesc("Folder under your WebDAV root where files are stored").addText(
      (text) => text.setPlaceholder("Obsidian").setValue(this.plugin.settings.remoteRoot).onChange(async (value) => {
        this.plugin.settings.remoteRoot = value.trim();
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Sync Behavior" });
    new import_obsidian2.Setting(containerEl).setName("Debounce (ms)").setDesc("Delay before syncing after edits").addText(
      (text) => text.setPlaceholder("900").setValue(String(this.plugin.settings.debounceMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.debounceMs = Number.isFinite(parsed) ? parsed : 900;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Include patterns").setDesc("Glob patterns (one per line). Default: **/*.md").addTextArea(
      (text) => text.setPlaceholder("**/*.md").setValue(this.plugin.settings.includePatterns).onChange(async (value) => {
        this.plugin.settings.includePatterns = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Exclude patterns").setDesc("Glob patterns to skip (one per line)").addTextArea(
      (text) => text.setPlaceholder("Templates/**").setValue(this.plugin.settings.excludePatterns).onChange(async (value) => {
        this.plugin.settings.excludePatterns = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync on modify").setDesc("Automatically sync after edits").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncOnModify).onChange(async (value) => {
        this.plugin.settings.syncOnModify = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync on file close").setDesc("Sync file when switching away from it").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncOnFileClose).onChange(async (value) => {
        this.plugin.settings.syncOnFileClose = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Check remote on open").setDesc("When opening a note, fetch remote changes and sync down if newer").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.checkRemoteOnOpen).onChange(async (value) => {
        this.plugin.settings.checkRemoteOnOpen = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Check remote on focus").setDesc("When Obsidian regains focus, check the active note for remote changes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.checkRemoteOnFocus).onChange(async (value) => {
        this.plugin.settings.checkRemoteOnFocus = value;
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Remote Checks" });
    new import_obsidian2.Setting(containerEl).setName("Periodic remote check").setDesc("Check remote changes for all in-scope notes every N minutes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.periodicRemoteCheckEnabled).onChange(async (value) => {
        this.plugin.settings.periodicRemoteCheckEnabled = value;
        await this.plugin.savePluginData();
        this.plugin.setupPeriodicRemoteCheck();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Periodic check interval (minutes)").setDesc("How often to check for remote changes when periodic check is enabled").addText(
      (text) => text.setPlaceholder("15").setValue(String(this.plugin.settings.periodicRemoteCheckMinutes)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.periodicRemoteCheckMinutes = Number.isFinite(parsed) ? Math.max(1, parsed) : 15;
        await this.plugin.savePluginData();
        this.plugin.setupPeriodicRemoteCheck();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Periodic check notices").setDesc("Show a notice when a periodic check starts and finishes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.periodicRemoteCheckNotices).onChange(async (value) => {
        this.plugin.settings.periodicRemoteCheckNotices = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Focus check throttle (ms)").setDesc("Minimum delay between focus-triggered checks per file").addText(
      (text) => text.setPlaceholder("2000").setValue(String(this.plugin.settings.focusCheckThrottleMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.focusCheckThrottleMs = Number.isFinite(parsed) ? parsed : 2e3;
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Deletes" });
    new import_obsidian2.Setting(containerEl).setName("Prompt to delete remote file").setDesc("When deleting a synced file locally, ask to delete it on the server too").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.promptRemoteDelete).onChange(async (value) => {
        this.plugin.settings.promptRemoteDelete = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Apply remote deletions").setDesc("Delete locally when a synced file was deleted on another device").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.applyRemoteDeletions).onChange(async (value) => {
        this.plugin.settings.applyRemoteDeletions = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote deletions log path").setDesc("Remote JSON file used to broadcast deletions across devices").addText(
      (text) => text.setPlaceholder(".sync-deletions.json").setValue(this.plugin.settings.remoteDeletionsPath).onChange(async (value) => {
        this.plugin.settings.remoteDeletionsPath = value.trim() || ".sync-deletions.json";
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Task Sync" });
    new import_obsidian2.Setting(containerEl).setName("Task sync").setDesc("Sync Markdown checkboxes with Nextcloud Tasks").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableTaskSync).onChange(async (value) => {
        this.plugin.settings.enableTaskSync = value;
        await this.plugin.savePluginData();
      })
    );
    let taskListText = null;
    new import_obsidian2.Setting(containerEl).setName("Task list URL").setDesc("Nextcloud task list (CalDAV) URL").addText((text) => {
      taskListText = text;
      return text.setPlaceholder("https://cloud.example.com/remote.php/dav/calendars/user/tasks/").setValue(this.plugin.settings.taskListUrl).onChange(async (value) => {
        this.plugin.settings.taskListUrl = value.trim();
        await this.plugin.savePluginData();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Select task list").setDesc("Pick from your Nextcloud task lists").addButton(
      (button) => button.setButtonText("Select").onClick(() => {
        void this.plugin.openTaskListPicker().then((selectedUrl) => {
          if (!selectedUrl) return;
          this.plugin.settings.taskListUrl = selectedUrl;
          taskListText?.setValue(selectedUrl);
          void this.plugin.savePluginData();
        });
      })
    );
    new import_obsidian2.Setting(containerEl).setName("CalDAV base URL (optional)").setDesc("Override the derived CalDAV base URL").addText(
      (text) => text.setPlaceholder("https://cloud.example.com/remote.php/dav").setValue(this.plugin.settings.caldavBaseUrl).onChange(async (value) => {
        this.plugin.settings.caldavBaseUrl = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync tasks during file sync").setDesc("When syncing files, also sync checkbox tasks with Nextcloud").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.taskSyncOnFileSync).onChange(async (value) => {
        this.plugin.settings.taskSyncOnFileSync = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Task sync interval").setDesc("Sync tasks from Nextcloud on a fixed interval").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.taskSyncIntervalEnabled).onChange(async (value) => {
        this.plugin.settings.taskSyncIntervalEnabled = value;
        await this.plugin.savePluginData();
        this.plugin.setupTaskSyncInterval();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Task sync interval (minutes)").setDesc("How often to pull task updates from Nextcloud").addText(
      (text) => text.setPlaceholder("10").setValue(String(this.plugin.settings.taskSyncIntervalMinutes)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.taskSyncIntervalMinutes = Number.isFinite(parsed) ? Math.max(1, parsed) : 10;
        await this.plugin.savePluginData();
        this.plugin.setupTaskSyncInterval();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Task deletion prompt").setDesc("Ask what to do when a task is removed locally").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.taskDeletionPromptEnabled).onChange(async (value) => {
        this.plugin.settings.taskDeletionPromptEnabled = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Task deletion default action").setDesc("Used when the prompt is disabled").addDropdown(
      (dropdown) => dropdown.addOption("delete", "Delete on server").addOption("complete", "Mark completed on server").addOption("keep", "Keep on server").setValue(this.plugin.settings.taskDeletionDefaultAction).onChange(async (value) => {
        this.plugin.settings.taskDeletionDefaultAction = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote task inbox").setDesc("Append remote-only tasks to a local inbox note").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.taskInboxEnabled).onChange(async (value) => {
        this.plugin.settings.taskInboxEnabled = value;
        if (value) {
          const inboxPath = this.plugin.settings.taskInboxPath.trim() || "Task Inbox.md";
          this.plugin.state.noSync[inboxPath] = true;
          delete this.plugin.state.noTaskSync[inboxPath];
        }
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote task inbox path").setDesc("Note path to store remote-only tasks").addText(
      (text) => text.setPlaceholder("Task Inbox.md").setValue(this.plugin.settings.taskInboxPath).onChange(async (value) => {
        this.plugin.settings.taskInboxPath = value.trim() || "Task Inbox.md";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Task inbox archive path").setDesc("Note path to archive completed inbox tasks").addText(
      (text) => text.setPlaceholder("Task Inbox closed.md").setValue(this.plugin.settings.taskInboxArchivePath).onChange(async (value) => {
        this.plugin.settings.taskInboxArchivePath = value.trim() || "Task Inbox closed.md";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote task inbox query").setDesc("Tasks plugin query inserted into the inbox note").addTextArea(
      (text) => text.setPlaceholder("```tasks\nnot done\n```").setValue(this.plugin.settings.taskInboxQuery).onChange(async (value) => {
        this.plugin.settings.taskInboxQuery = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Auto-move tasks from inbox").setDesc("Move inbox tasks to their note when the note is downloaded").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.taskInboxAutoMove).onChange(async (value) => {
        this.plugin.settings.taskInboxAutoMove = value;
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Focus & Planning" });
    new import_obsidian2.Setting(containerEl).setName("Today Focus note").setDesc("Create/update a Today Focus note").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.todayNoteEnabled).onChange(async (value) => {
        this.plugin.settings.todayNoteEnabled = value;
        await this.plugin.savePluginData();
        if (value) {
          void this.plugin.refreshTodayNote();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Today Focus path").setDesc("Path for Today note (supports {{date}})").addText(
      (text) => text.setPlaceholder("Today.md").setValue(this.plugin.settings.todayNotePath).onChange(async (value) => {
        this.plugin.settings.todayNotePath = value.trim() || "Today.md";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Today Focus task limit").setDesc("Max tasks shown in Today Focus").addText(
      (text) => text.setPlaceholder("4").setValue(String(this.plugin.settings.todayNoteLimit)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.todayNoteLimit = Number.isFinite(parsed) ? Math.max(1, parsed) : 4;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Today Focus uses Tasks query").setDesc("Use Tasks plugin query block for Today Focus").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.todayNoteUseQuery).onChange(async (value) => {
        this.plugin.settings.todayNoteUseQuery = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Today Focus query").setDesc("Tasks query inserted into Today note (supports {{limit}})").addTextArea(
      (text) => text.setPlaceholder("```tasks\\nnot done\\nlimit {{limit}}\\nsort by due\\n```").setValue(this.plugin.settings.todayNoteQuery).onChange(async (value) => {
        this.plugin.settings.todayNoteQuery = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Task reminders").setDesc("Show gentle reminders for overdue or due-today tasks").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.remindersEnabled).onChange(async (value) => {
        this.plugin.settings.remindersEnabled = value;
        await this.plugin.savePluginData();
        this.plugin.setupReminders();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Reminder interval (minutes)").setDesc("How often to check for due tasks").addText(
      (text) => text.setPlaceholder("60").setValue(String(this.plugin.settings.remindersMinutes)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.remindersMinutes = Number.isFinite(parsed) ? Math.max(5, parsed) : 60;
        await this.plugin.savePluginData();
        this.plugin.setupReminders();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Reminder mode").setDesc("Which tasks to remind about").addDropdown(
      (dropdown) => dropdown.addOption("overdue", "Overdue only").addOption("today", "Due today only").addOption("both", "Overdue + due today").setValue(this.plugin.settings.remindersMode).onChange(async (value) => {
        this.plugin.settings.remindersMode = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Reminder max count").setDesc("Maximum tasks mentioned per reminder").addText(
      (text) => text.setPlaceholder("3").setValue(String(this.plugin.settings.remindersMaxCount)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.remindersMaxCount = Number.isFinite(parsed) ? Math.max(1, parsed) : 3;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Daily checklist").setDesc("Create/reset a daily checklist note").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.dailyChecklistEnabled).onChange(async (value) => {
        this.plugin.settings.dailyChecklistEnabled = value;
        await this.plugin.savePluginData();
        if (value) {
          void this.plugin.refreshDailyChecklist();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Daily checklist path").setDesc("Path for daily checklist (supports {{date}})").addText(
      (text) => text.setPlaceholder("Daily Checklist.md").setValue(this.plugin.settings.dailyChecklistPath).onChange(async (value) => {
        this.plugin.settings.dailyChecklistPath = value.trim() || "Daily Checklist.md";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Daily checklist template").setDesc("Content inserted when checklist resets").addTextArea(
      (text) => text.setPlaceholder("- [ ] Plan top 3 tasks").setValue(this.plugin.settings.dailyChecklistTemplate).onChange(async (value) => {
        this.plugin.settings.dailyChecklistTemplate = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Quick capture path").setDesc("Note to append quick-captured tasks").addText(
      (text) => text.setPlaceholder("Task Inbox.md").setValue(this.plugin.settings.quickCapturePath).onChange(async (value) => {
        this.plugin.settings.quickCapturePath = value.trim() || "Task Inbox.md";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Focus tag").setDesc("Optional tag used by focus workflows").addText(
      (text) => text.setPlaceholder("focus").setValue(this.plugin.settings.focusTag).onChange(async (value) => {
        this.plugin.settings.focusTag = value.trim() || "focus";
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Changelog & Debug" });
    new import_obsidian2.Setting(containerEl).setName("Local changelog").setDesc("Append sync entries to a local note").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableChangelog).onChange(async (value) => {
        this.plugin.settings.enableChangelog = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Changelog path").setDesc("Path for the local changelog note").addText(
      (text) => text.setPlaceholder("Sync Changelog.md").setValue(this.plugin.settings.changelogPath).onChange(async (value) => {
        this.plugin.settings.changelogPath = value.trim() || "Sync Changelog.md";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Debug logging").setDesc("Capture recent sync events for troubleshooting").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableDebug).onChange(async (value) => {
        this.plugin.settings.enableDebug = value;
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "Conflicts" });
    new import_obsidian2.Setting(containerEl).setName("Archive conflicts on resolve").setDesc("Move conflict copies to an archive folder and upload them to the server").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.archiveConflictsOnResolve).onChange(async (value) => {
        this.plugin.settings.archiveConflictsOnResolve = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Conflict archive folder").setDesc("Local folder to store resolved conflict copies").addText(
      (text) => text.setPlaceholder("Sync Conflicts").setValue(this.plugin.settings.conflictArchiveFolder).onChange(async (value) => {
        this.plugin.settings.conflictArchiveFolder = value.trim() || "Sync Conflicts";
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote conflict archive folder").setDesc("Remote folder (under WebDAV root) to store conflict copies").addText(
      (text) => text.setPlaceholder(".sync-conflicts").setValue(this.plugin.settings.conflictArchiveRemoteFolder).onChange(async (value) => {
        this.plugin.settings.conflictArchiveRemoteFolder = value.trim() || ".sync-conflicts";
        await this.plugin.savePluginData();
      })
    );
  }
};
var SyncQueueModal = class extends import_obsidian2.Modal {
  currentPath;
  queue;
  constructor(app, currentPath, queue) {
    super(app);
    this.currentPath = currentPath;
    this.queue = [...queue];
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Sync Queue" });
    if (this.currentPath) {
      contentEl.createEl("div", { text: `Syncing: ${this.currentPath}` });
    } else {
      contentEl.createEl("div", { text: "Syncing: (idle)" });
    }
    if (this.queue.length === 0) {
      contentEl.createEl("div", { text: "Queue is empty." });
      return;
    }
    const list = contentEl.createEl("ul");
    for (const item of this.queue) {
      list.createEl("li", { text: `${item.path} (${item.reason})` });
    }
  }
};
var SyncLogModal = class extends import_obsidian2.Modal {
  entries;
  constructor(app, entries) {
    super(app);
    this.entries = [...entries];
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Sync Log" });
    if (this.entries.length === 0) {
      contentEl.createEl("div", { text: "No log entries yet." });
      return;
    }
    const pre = contentEl.createEl("pre");
    pre.setText(this.entries.join("\n"));
  }
};
var TaskDeleteModal = class extends import_obsidian2.Modal {
  uid;
  summary;
  onChoice;
  constructor(app, uid, summary, onChoice) {
    super(app);
    this.uid = uid;
    this.summary = summary;
    this.onChoice = onChoice;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Task removed locally" });
    contentEl.createEl("p", { text: this.summary || this.uid });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const deleteButton = buttons.createEl("button", { text: "Delete on server" });
    deleteButton.addEventListener("click", () => {
      this.onChoice("delete");
      this.close();
    });
    const completeButton = buttons.createEl("button", { text: "Mark completed on server" });
    completeButton.addEventListener("click", () => {
      this.onChoice("complete");
      this.close();
    });
    const keepButton = buttons.createEl("button", { text: "Keep on server" });
    keepButton.addEventListener("click", () => {
      this.onChoice("keep");
      this.close();
    });
  }
};
var QuickCaptureModal = class extends import_obsidian2.Modal {
  onSubmit;
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Quick capture task" });
    const summaryLabel = contentEl.createEl("label", { text: "Summary" });
    summaryLabel.className = "nc-modal-label";
    const summaryInput = contentEl.createEl("textarea");
    summaryInput.className = "nc-modal-summary";
    summaryInput.placeholder = "Task summary";
    summaryInput.focus();
    const fieldWrap = contentEl.createDiv({ cls: "nc-modal-fields" });
    const checkedWrap = fieldWrap.createDiv();
    const checkedInput = checkedWrap.createEl("input", { type: "checkbox" });
    const checkedLabel = checkedWrap.createEl("label", { text: "Completed" });
    checkedLabel.className = "nc-modal-label";
    checkedLabel.style.marginLeft = "6px";
    const dueLabel = fieldWrap.createEl("label", { text: "Due date" });
    dueLabel.className = "nc-modal-label";
    const dueInput = fieldWrap.createEl("input", { type: "date" });
    dueInput.placeholder = "Due date";
    const schedLabel = fieldWrap.createEl("label", { text: "Scheduled date" });
    schedLabel.className = "nc-modal-label";
    const schedInput = fieldWrap.createEl("input", { type: "date" });
    schedInput.placeholder = "Scheduled date";
    const startLabel = fieldWrap.createEl("label", { text: "Start date" });
    startLabel.className = "nc-modal-label";
    const startInput = fieldWrap.createEl("input", { type: "date" });
    startInput.placeholder = "Start date";
    const priorityLabel = fieldWrap.createEl("label", { text: "Priority" });
    priorityLabel.className = "nc-modal-label";
    const prioritySelect = fieldWrap.createEl("select");
    ["None", "High", "Medium", "Low", "Lowest"].forEach((label) => {
      const option = prioritySelect.createEl("option");
      option.text = label;
      option.value = label.toLowerCase();
    });
    const tagsLabel = fieldWrap.createEl("label", { text: "Tags" });
    tagsLabel.className = "nc-modal-label";
    const tagsInput = fieldWrap.createEl("input", { type: "text" });
    tagsInput.placeholder = "Tags (comma or #tag)";
    const recurrenceLabel = fieldWrap.createEl("label", { text: "Recurrence" });
    recurrenceLabel.className = "nc-modal-label";
    const recurrenceInput = fieldWrap.createEl("input", { type: "text" });
    recurrenceInput.placeholder = "Recurrence (optional)";
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const addButton = buttons.createEl("button", { text: "Add" });
    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    const submit = () => {
      const meta = emptyTaskMeta();
      if (dueInput.value) meta.dueDate = dueInput.value;
      if (schedInput.value) meta.scheduledDate = schedInput.value;
      if (startInput.value) meta.startDate = startInput.value;
      if (recurrenceInput.value.trim()) meta.recurrenceText = recurrenceInput.value.trim();
      const checked = checkedInput.checked;
      if (checked) meta.doneDate = formatDateOnly(/* @__PURE__ */ new Date());
      const priorityMap = {
        none: null,
        high: 1,
        medium: 3,
        low: 7,
        lowest: 9
      };
      meta.priority = priorityMap[prioritySelect.value] ?? null;
      const tags = parseTagInput(tagsInput.value);
      this.onSubmit({
        summary: summaryInput.value,
        checked,
        tags,
        meta,
        statusSymbol: checked ? "x" : " "
      });
      this.close();
    };
    addButton.addEventListener("click", submit);
    cancelButton.addEventListener("click", () => {
      this.onSubmit(null);
      this.close();
    });
    summaryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.onSubmit(null);
        this.close();
      }
    });
  }
};
var RemoteHistoryModal = class extends import_obsidian2.Modal {
  file;
  versions;
  onSelect;
  constructor(app, file, versions, onSelect) {
    super(app);
    this.file = file;
    this.versions = versions;
    this.onSelect = onSelect;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Remote history: ${this.file.path}` });
    const list = contentEl.createEl("ul");
    for (const entry of this.versions) {
      const item = list.createEl("li");
      const label = formatVersionLabel(entry);
      item.createEl("span", { text: label });
      const openBtn = item.createEl("button", { text: "Open" });
      openBtn.onclick = () => {
        this.close();
        this.onSelect(entry);
      };
    }
  }
};
var RemoteDeleteModal = class extends import_obsidian2.Modal {
  path;
  onDecision;
  constructor(app, path, onDecision) {
    super(app);
    this.path = path;
    this.onDecision = onDecision;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Delete from server?" });
    contentEl.createEl("p", {
      text: `The file "${this.path}" was deleted locally. Delete it from Nextcloud too?`
    });
    const actions = contentEl.createEl("div");
    const yesBtn = actions.createEl("button", { text: "Delete on server" });
    const noBtn = actions.createEl("button", { text: "Keep on server" });
    yesBtn.onclick = () => {
      this.close();
      this.onDecision(true);
    };
    noBtn.onclick = () => {
      this.close();
      this.onDecision(false);
    };
  }
};
var TaskListModal = class extends import_obsidian2.Modal {
  lists;
  onSelect;
  constructor(app, lists, onSelect) {
    super(app);
    this.lists = lists;
    this.onSelect = onSelect;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Select task list" });
    const list = contentEl.createEl("ul");
    for (const entry of this.lists) {
      const item = list.createEl("li");
      item.createEl("span", { text: entry.name });
      const button = item.createEl("button", { text: "Use" });
      button.onclick = () => {
        this.close();
        this.onSelect(entry.url);
      };
    }
  }
};
var DeleteWithSyncModal = class extends import_obsidian2.Modal {
  path;
  synced;
  onDecision;
  constructor(app, path, synced, onDecision) {
    super(app);
    this.path = path;
    this.synced = synced;
    this.onDecision = onDecision;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Delete file" });
    contentEl.createEl("p", { text: `Delete "${this.path}"?` });
    const actions = contentEl.createEl("div");
    const localBtn = actions.createEl("button", { text: "Delete locally" });
    const remoteBtn = actions.createEl("button", { text: "Delete locally + server" });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    if (!this.synced) {
      remoteBtn.disabled = true;
      remoteBtn.setAttribute("aria-disabled", "true");
    }
    localBtn.onclick = () => {
      this.close();
      this.onDecision("delete-local");
    };
    remoteBtn.onclick = () => {
      this.close();
      this.onDecision("delete-remote");
    };
    cancelBtn.onclick = () => {
      this.close();
      this.onDecision("cancel");
    };
  }
};
var ConflictResolverModal = class extends import_obsidian2.Modal {
  plugin;
  conflict;
  constructor(app, plugin, conflict) {
    super(app);
    this.plugin = plugin;
    this.conflict = conflict;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Resolve Sync Conflict" });
    const info = contentEl.createEl("div", {
      text: `File: ${this.conflict.vaultPath}`
    });
    info.addClass("sync-conflict-info");
    const body = contentEl.createEl("div");
    body.addClass("sync-conflict-body");
    const left = body.createEl("div");
    left.addClass("sync-conflict-pane");
    left.createEl("h4", { text: "Local" });
    const localPre = left.createEl("pre", { text: "Loading local content..." });
    const right = body.createEl("div");
    right.addClass("sync-conflict-pane");
    right.createEl("h4", { text: "Remote" });
    const remotePre = right.createEl("pre", { text: "Loading remote content..." });
    const actions = contentEl.createEl("div");
    actions.addClass("sync-conflict-actions");
    const keepLocalBtn = actions.createEl("button", { text: "Keep local" });
    const keepRemoteBtn = actions.createEl("button", { text: "Keep remote" });
    const openBothBtn = actions.createEl("button", { text: "Open both files" });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    keepLocalBtn.onclick = async () => {
      try {
        await this.plugin.resolveConflictKeepLocal(this.conflict);
        this.close();
      } catch (error) {
        new import_obsidian2.Notice(`Nextcloud sync: ${this.plugin.describeError(error)}`);
      }
    };
    keepRemoteBtn.onclick = async () => {
      try {
        await this.plugin.resolveConflictKeepRemote(this.conflict);
        this.close();
      } catch (error) {
        new import_obsidian2.Notice(`Nextcloud sync: ${this.plugin.describeError(error)}`);
      }
    };
    openBothBtn.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(this.conflict.vaultPath);
      if (file instanceof import_obsidian2.TFile) {
        void this.app.workspace.getLeaf(false).openFile(file);
      }
      const conflictFile = this.app.vault.getAbstractFileByPath(this.conflict.conflictPath);
      if (conflictFile instanceof import_obsidian2.TFile) {
        void this.app.workspace.getLeaf(true).openFile(conflictFile);
      }
    };
    cancelBtn.onclick = () => this.close();
    const localFile = this.app.vault.getAbstractFileByPath(this.conflict.vaultPath);
    if (localFile instanceof import_obsidian2.TFile) {
      const localContent = await this.app.vault.read(localFile);
      localPre.setText(localContent);
    } else {
      localPre.setText("Local file not found.");
    }
    const client = this.plugin.getClientOrNotice();
    if (!client) {
      remotePre.setText("Missing credentials.");
      return;
    }
    const response = await client.get(this.conflict.remotePath);
    if (!response.ok) {
      remotePre.setText(`Failed to load remote (${response.status}).`);
      return;
    }
    const remoteContent = await response.text();
    remotePre.setText(remoteContent);
  }
};
var ConflictListModal = class extends import_obsidian2.Modal {
  plugin;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Conflicts" });
    const conflicts = Object.values(this.plugin.state.conflicts ?? {});
    if (conflicts.length === 0) {
      contentEl.createEl("div", { text: "No conflicts detected." });
      return;
    }
    const list = contentEl.createEl("ul");
    for (const conflict of conflicts) {
      const item = list.createEl("li");
      const label = item.createEl("span", { text: conflict.vaultPath });
      label.addClass("sync-conflict-label");
      const openBtn = item.createEl("button", { text: "Resolve" });
      openBtn.onclick = () => {
        this.close();
        this.plugin.openConflictResolver(conflict);
      };
    }
  }
};
function parsePatterns(value) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
function matchAnyGlob(path, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}
function globToRegExp(pattern) {
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        const after = pattern[i + 2];
        if (after === "/") {
          regex += "(?:.*/)?";
          i += 3;
          continue;
        }
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i += 1;
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      i += 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
    i += 1;
  }
  regex += "$";
  return new RegExp(regex);
}
function normalizeEtag(value) {
  if (!value) return null;
  let normalized = value.trim();
  if (normalized.startsWith("W/")) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized || null;
}
function getFileName(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
function parseVersionList(xml, metaUrl) {
  const responses = Array.from(xml.querySelectorAll("response"));
  const base = new URL(metaUrl);
  const entries = [];
  for (const response of responses) {
    const href = response.querySelector("href")?.textContent ?? "";
    if (!href) continue;
    const absoluteHref = href.startsWith("http") ? href : new URL(href, base).toString();
    if (absoluteHref.replace(/\/+$/, "") === base.toString().replace(/\/+$/, "")) {
      continue;
    }
    if (absoluteHref.endsWith("/v/")) continue;
    const lastModified = response.querySelector("getlastmodified")?.textContent ?? null;
    const etag = response.querySelector("getetag")?.textContent ?? null;
    const sizeText = response.querySelector("getcontentlength")?.textContent ?? null;
    const size = sizeText ? Number.parseInt(sizeText, 10) : null;
    entries.push({
      href: absoluteHref,
      lastModified,
      etag,
      size: Number.isFinite(size ?? NaN) ? size : null
    });
  }
  entries.sort((a, b) => {
    const aTime = a.lastModified ? Date.parse(a.lastModified) : 0;
    const bTime = b.lastModified ? Date.parse(b.lastModified) : 0;
    return bTime - aTime;
  });
  return entries;
}
function formatVersionLabel(entry) {
  const timeLabel = entry.lastModified ? new Date(entry.lastModified).toLocaleString() : "Unknown time";
  const sizeLabel = entry.size ? `${Math.round(entry.size / 1024)} KB` : "Unknown size";
  return `${timeLabel} | ${sizeLabel}`;
}
function formatTimestamp(value) {
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}
function formatDateOnly(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}
function parseTaskLines(lines, options) {
  const tasks = [];
  const pattern = /^(\s*-\s+)\[([^\]])\]\s+(.*)$/;
  const useTasksPlugin = options?.useTasksPlugin ?? false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(pattern);
    if (!match) continue;
    const prefix = match[1];
    const statusSymbol = match[2];
    const checked = statusSymbol.toLowerCase() === "x";
    let summary = match[3].trim();
    let uid = null;
    const uidMatch = summary.match(/^🆔\s*([A-Za-z0-9-]+)\s*/);
    if (uidMatch) {
      uid = uidMatch[1];
      summary = summary.replace(/^🆔\s*[A-Za-z0-9-]+\s*/, "").trim();
    } else {
      const legacyMatch = summary.match(/<!--\s*nc-task:([A-Za-z0-9-]+)\s*-->/);
      if (legacyMatch) {
        uid = legacyMatch[1];
        summary = summary.replace(/<!--\s*nc-task:[A-Za-z0-9-]+\s*-->/g, "").trim();
      }
    }
    let meta = emptyTaskMeta();
    let tags = [];
    if (useTasksPlugin) {
      const parsed = parseTasksPluginTask(summary);
      summary = parsed.summary;
      tags = parsed.tags;
      meta = parsed.meta;
    }
    tasks.push({
      lineIndex: i,
      raw: line,
      checked,
      summary,
      uid,
      prefix,
      statusSymbol,
      tags,
      meta
    });
  }
  return tasks;
}
function stripTaskUid(value) {
  return value.replace(/\s*🆔\s*[A-Za-z0-9-]+\s*/g, " ").replace(/\s*<!--\s*nc-task:[A-Za-z0-9-]+\s*-->\s*/g, " ").trim();
}
function stripTaskUidKeepWhitespace(value) {
  return value.replace(/\s*🆔\s*[A-Za-z0-9-]+\s*/g, " ").replace(/\s*<!--\s*nc-task:[A-Za-z0-9-]+\s*-->\s*/g, " ");
}
function normalizeTaskKey(summary, completed) {
  const normalized = summary.trim().toLowerCase().replace(/\s+/g, " ");
  return `${completed ? "1" : "0"}|${normalized}`;
}
function isTaskLine(line) {
  return /^\s*-\s+\[[^\]]\]\s+/.test(line);
}
function findFirstTaskIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (isTaskLine(lines[i])) return i;
  }
  return lines.length;
}
function compareTaskPriority(a, b) {
  const dateA = a.meta.dueDate ?? a.meta.scheduledDate ?? a.meta.startDate ?? "";
  const dateB = b.meta.dueDate ?? b.meta.scheduledDate ?? b.meta.startDate ?? "";
  if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
  if (dateA && !dateB) return -1;
  if (!dateA && dateB) return 1;
  const prioA = a.meta.priority ?? 99;
  const prioB = b.meta.priority ?? 99;
  if (prioA !== prioB) return prioA - prioB;
  return a.summary.localeCompare(b.summary);
}
function parseTagInput(value) {
  if (!value) return [];
  const parts = value.split(/[, ]+/).map((part) => part.trim()).filter(Boolean).map((part) => part.startsWith("#") ? part.slice(1) : part);
  return normalizeTags(parts);
}
function buildTaskLineNoUid(options) {
  const { summary, checked, tags, meta, statusSymbol, useTasksPlugin } = options;
  const prefix = "- ";
  if (!useTasksPlugin) {
    return `${prefix}${checked ? "[x]" : "[ ]"} ${summary}`.trimEnd();
  }
  const effectiveSymbol = checked ? "x" : statusSymbol === "x" || statusSymbol === "X" ? " " : statusSymbol;
  const tagTokens = normalizeTags(tags).map((tag) => `#${tag}`).join(" ");
  const metaTokens = formatTaskMetaTokens(meta);
  const body = [summary, tagTokens, metaTokens].filter((part) => part && part.length > 0).join(" ").trim();
  return `${prefix}[${effectiveSymbol}] ${body}`.trimEnd();
}
function buildRemoteTaskIndex(tasks) {
  const index = /* @__PURE__ */ new Map();
  for (const task of tasks.values()) {
    const key = normalizeTaskKey(task.summary, task.completed);
    const bucket = index.get(key);
    if (bucket) {
      bucket.push(task);
    } else {
      index.set(key, [task]);
    }
  }
  return index;
}
function popRemoteMatch(index, summary, completed) {
  if (!index) return null;
  const key = normalizeTaskKey(summary, completed);
  const bucket = index.get(key);
  if (!bucket || bucket.length === 0) return null;
  return bucket.shift() ?? null;
}
function formatTaskUid(uid) {
  return `\u{1F194} ${uid}`;
}
function generateUid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    const uuid = crypto.randomUUID().replace(/-/g, "");
    return uuid.slice(0, 6);
  }
  const random = Math.random().toString(36).slice(2);
  return random.slice(0, 6);
}
function buildVtodo(uid, summary, completed, task, useTasksPlugin) {
  const stamp = formatCalDate(/* @__PURE__ */ new Date());
  const meta = useTasksPlugin ? task.meta : emptyTaskMeta();
  const status = meta.cancelledDate && !completed ? "CANCELLED" : completed ? "COMPLETED" : "NEEDS-ACTION";
  const completedDate = completed ? meta.doneDate : null;
  const completedLine = completed ? completedDate ? `COMPLETED;VALUE=DATE:${formatCalDateOnly(completedDate)}\r
` : `COMPLETED:${stamp}\r
` : "";
  const categories = useTasksPlugin ? normalizeTags(task.tags) : [];
  const descriptionParts = [];
  if (meta.scheduledDate) descriptionParts.push(`Scheduled: ${meta.scheduledDate}`);
  if (meta.createdDate) descriptionParts.push(`Created: ${meta.createdDate}`);
  if (meta.cancelledDate && status !== "CANCELLED") descriptionParts.push(`Cancelled: ${meta.cancelledDate}`);
  const recurrenceRule = meta.recurrenceText?.trim() ?? "";
  const hasRrule = recurrenceRule.toUpperCase().includes("FREQ=");
  if (meta.recurrenceText && !hasRrule) {
    descriptionParts.push(`Recurrence: ${meta.recurrenceText}`);
  }
  const descriptionLine = descriptionParts.length > 0 ? `DESCRIPTION:${escapeCalText(descriptionParts.join("\\n"))}` : "";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nextcloud Sync Suite//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${escapeCalText(summary)}`,
    meta.startDate ? `DTSTART;VALUE=DATE:${formatCalDateOnly(meta.startDate)}` : "",
    meta.dueDate ? `DUE;VALUE=DATE:${formatCalDateOnly(meta.dueDate)}` : "",
    meta.priority ? `PRIORITY:${meta.priority}` : "",
    categories.length > 0 ? `CATEGORIES:${escapeCalText(categories.join(","))}` : "",
    descriptionLine,
    hasRrule ? `RRULE:${recurrenceRule.replace(/^RRULE:/i, "")}` : "",
    `STATUS:${status}`,
    completedLine.trimEnd(),
    "END:VTODO",
    "END:VCALENDAR"
  ].filter((line) => line.length > 0).join("\r\n");
}
function parseVtodo(data) {
  const lines = unfoldIcalLines(data);
  let inTodo = false;
  let uid = null;
  let summary = null;
  let status = null;
  let completedValue = null;
  let lastModified = null;
  let dueDate = null;
  let startDate = null;
  let completedDate = null;
  let priority = null;
  let percentComplete = null;
  let categories = [];
  let description = null;
  let recurrenceRule = null;
  for (const line of lines) {
    if (line === "BEGIN:VTODO") {
      inTodo = true;
      continue;
    }
    if (line === "END:VTODO") {
      inTodo = false;
      break;
    }
    if (!inTodo) continue;
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const value = rest.join(":");
    const parts = rawKey.split(";");
    const key = parts[0].toUpperCase();
    const params = parts.slice(1).map((param) => param.toUpperCase());
    const isDateValue = params.includes("VALUE=DATE");
    if (key === "UID") uid = value.trim();
    if (key === "SUMMARY") summary = unescapeCalText(value.trim());
    if (key === "STATUS") status = value.trim().toUpperCase();
    if (key === "COMPLETED") {
      completedValue = value.trim();
      completedDate = parseCalDateValue(completedValue, isDateValue);
    }
    if (key === "LAST-MODIFIED") lastModified = value.trim();
    if (key === "DUE") dueDate = parseCalDateValue(value.trim(), isDateValue);
    if (key === "DTSTART") startDate = parseCalDateValue(value.trim(), isDateValue);
    if (key === "PRIORITY") {
      const parsed = Number.parseInt(value.trim(), 10);
      priority = Number.isFinite(parsed) ? parsed : null;
    }
    if (key === "PERCENT-COMPLETE") {
      const parsed = Number.parseInt(value.trim(), 10);
      percentComplete = Number.isFinite(parsed) ? parsed : null;
    }
    if (key === "CATEGORIES") {
      const raw = unescapeCalText(value.trim());
      categories = raw.split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (key === "DESCRIPTION") description = unescapeCalText(value.trim());
    if (key === "RRULE") recurrenceRule = value.trim();
  }
  if (!uid) return null;
  const completed = status === "COMPLETED" || completedValue !== null || percentComplete === 100;
  return {
    uid,
    summary,
    completed,
    lastModified,
    dueDate,
    startDate,
    completedDate,
    status,
    priority,
    percentComplete,
    categories,
    description,
    recurrenceRule
  };
}
function emptyTaskMeta() {
  return {
    dueDate: null,
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    doneDate: null,
    cancelledDate: null,
    priority: null,
    recurrenceText: null
  };
}
function normalizeTags(tags) {
  return tags.map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.startsWith("#") ? tag.slice(1) : tag);
}
function parseTasksPluginTask(summary) {
  let working = summary;
  const tags = extractTags(working);
  working = removeTags(working).trim();
  const { cleaned, meta } = extractTasksPluginMeta(working);
  return { summary: cleaned, tags, meta };
}
function extractTags(text) {
  const tags = [];
  const pattern = /(^|\s)(#[A-Za-z0-9/_-]+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    tags.push(match[2].slice(1));
  }
  return Array.from(new Set(tags));
}
function removeTags(text) {
  return text.replace(/(^|\s)#[A-Za-z0-9/_-]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
function extractTasksPluginMeta(text) {
  let cleaned = text;
  const meta = emptyTaskMeta();
  const dateFields = [
    { emoji: "\u{1F4C5}", key: "dueDate" },
    { emoji: "\u23F3", key: "scheduledDate" },
    { emoji: "\u{1F6EB}", key: "startDate" },
    { emoji: "\u2795", key: "createdDate" },
    { emoji: "\u2705", key: "doneDate" },
    { emoji: "\u274C", key: "cancelledDate" }
  ];
  for (const field of dateFields) {
    const regex = new RegExp(`${field.emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const match = cleaned.match(regex);
    if (match) {
      meta[field.key] = match[1];
      cleaned = cleaned.replace(match[0], " ").trim();
    }
  }
  if (cleaned.includes("\u23EB")) {
    meta.priority = 1;
    cleaned = cleaned.replace("\u23EB", " ").trim();
  } else if (cleaned.includes("\u{1F53C}")) {
    meta.priority = 3;
    cleaned = cleaned.replace("\u{1F53C}", " ").trim();
  } else if (cleaned.includes("\u{1F53D}")) {
    meta.priority = 7;
    cleaned = cleaned.replace("\u{1F53D}", " ").trim();
  } else if (cleaned.includes("\u23EC")) {
    meta.priority = 9;
    cleaned = cleaned.replace("\u23EC", " ").trim();
  }
  const recurrenceIndex = cleaned.indexOf("\u{1F501}");
  if (recurrenceIndex !== -1) {
    const tokenList = ["\u{1F4C5}", "\u23F3", "\u{1F6EB}", "\u2795", "\u2705", "\u274C", "\u23EB", "\u{1F53C}", "\u{1F53D}", "\u23EC"];
    let endIndex = cleaned.length;
    for (const token of tokenList) {
      const idx = cleaned.indexOf(token, recurrenceIndex + 2);
      if (idx !== -1 && idx < endIndex) {
        endIndex = idx;
      }
    }
    const recurrenceText = cleaned.slice(recurrenceIndex + 2, endIndex).trim();
    meta.recurrenceText = recurrenceText || null;
    cleaned = cleaned.slice(0, recurrenceIndex).trim() + " " + cleaned.slice(endIndex).trim();
  }
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return { cleaned, meta };
}
function formatTaskMetaTokens(meta) {
  const parts = [];
  if (meta.priority) {
    const emoji = meta.priority <= 1 ? "\u23EB" : meta.priority <= 3 ? "\u{1F53C}" : meta.priority >= 9 ? "\u23EC" : "\u{1F53D}";
    parts.push(emoji);
  }
  if (meta.dueDate) parts.push(`\u{1F4C5} ${meta.dueDate}`);
  if (meta.scheduledDate) parts.push(`\u23F3 ${meta.scheduledDate}`);
  if (meta.startDate) parts.push(`\u{1F6EB} ${meta.startDate}`);
  if (meta.createdDate) parts.push(`\u2795 ${meta.createdDate}`);
  if (meta.doneDate) parts.push(`\u2705 ${meta.doneDate}`);
  if (meta.cancelledDate) parts.push(`\u274C ${meta.cancelledDate}`);
  if (meta.recurrenceText) parts.push(`\u{1F501} ${meta.recurrenceText}`);
  return parts.join(" ");
}
function buildTaskLine(options) {
  const { prefix, checked, summary, tags, meta, uid, statusSymbol, useTasksPlugin } = options;
  if (!useTasksPlugin) {
    return `${prefix}${checked ? "[x]" : "[ ]"} ${formatTaskUid(uid)} ${summary}`.trimEnd();
  }
  const effectiveSymbol = checked ? "x" : statusSymbol === "x" || statusSymbol === "X" ? " " : statusSymbol;
  const tagTokens = normalizeTags(tags).map((tag) => `#${tag}`).join(" ");
  const metaTokens = formatTaskMetaTokens(meta);
  const body = [summary, tagTokens, metaTokens].filter((part) => part && part.length > 0).join(" ").trim();
  return `${prefix}[${effectiveSymbol}] ${formatTaskUid(uid)} ${body}`.trimEnd();
}
function mapRemoteToTaskMeta(remote) {
  return {
    dueDate: remote.dueDate,
    scheduledDate: null,
    startDate: remote.startDate,
    createdDate: null,
    doneDate: remote.completedDate,
    cancelledDate: remote.status === "CANCELLED" ? remote.completedDate : null,
    priority: remote.priority,
    recurrenceText: remote.recurrenceRule
  };
}
function unfoldIcalLines(data) {
  const raw = data.split(/\r?\n/);
  const lines = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("	")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines.filter((line) => line.length > 0);
}
function formatCalDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}
function formatCalDateOnly(value) {
  if (!value) return formatCalDate(/* @__PURE__ */ new Date()).slice(0, 8);
  return value.replace(/-/g, "");
}
function parseCalDateValue(value, isDateValue) {
  if (!value) return null;
  const raw = value.trim();
  if (isDateValue || raw.length === 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  const datePart = raw.split("T")[0];
  if (datePart.length === 8) {
    return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  }
  return null;
}
function escapeCalText(value) {
  return value.replace(/\\\\/g, "\\\\\\\\").replace(/\\n/g, "\\\\n").replace(/,/g, "\\\\,").replace(/;/g, "\\\\;");
}
function unescapeCalText(value) {
  return value.replace(/\\\\n/g, "\\n").replace(/\\\\,/g, ",").replace(/\\\\;/g, ";").replace(/\\\\\\\\/g, "\\\\");
}
async function hashString(value) {
  if (window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const buffer = await window.crypto.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = hash * 33 ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
