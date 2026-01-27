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
  tasks: {}
};
var SyncPlugin = class extends import_obsidian2.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  state = { ...EMPTY_STATE };
  statusBarItem = null;
  queue = [];
  queuedPaths = /* @__PURE__ */ new Set();
  queueRunning = false;
  debounceTimers = /* @__PURE__ */ new Map();
  suppressModifyForPaths = /* @__PURE__ */ new Set();
  lastActiveFile = null;
  currentSyncPath = null;
  logEntries = [];
  logLimit = 200;
  lastFocusChecks = /* @__PURE__ */ new Map();
  previewFiles = /* @__PURE__ */ new Set();
  fileStatuses = /* @__PURE__ */ new Map();
  deletionSyncInFlight = false;
  suppressDeletePrompt = /* @__PURE__ */ new Set();
  credentialKeyPromise = null;
  periodicSyncTimer = null;
  async onload() {
    await this.loadPluginData();
    this.addSettingTab(new SyncSettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("idle");
    this.seedStatusesFromState();
    this.applyStatusStyles();
    void this.syncRemoteDeletions("startup");
    this.setupPeriodicRemoteCheck();
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
  }
  onunload() {
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.periodicSyncTimer) {
      window.clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
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
  }
  async runPeriodicRemoteCheck() {
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      return;
    }
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isFileInScope(file)) continue;
      this.enqueueRemoteCheck(file.path, "periodic");
    }
    await this.syncRemoteDeletions("periodic");
  }
  isTasksPluginEnabled() {
    const plugins = this.app?.plugins;
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
        tasks: data.state?.tasks ?? {}
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
        tasks: legacy?.tasks ?? {}
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
    this.fileStatuses.delete(file.path);
    this.updateFileExplorerIcon(file.path, null);
    if (this.state.conflicts[file.path]) {
      delete this.state.conflicts[file.path];
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
    const scopedFiles = this.app.vault.getMarkdownFiles().filter(
      (fileItem) => fileItem.path.startsWith(`${newPath}/`) && this.isFileInScope(fileItem)
    );
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
    if (this.settings.syncOnFileClose && previous && previous !== file && this.isFileInScope(previous)) {
      this.enqueueSync(previous.path, "file-close");
    }
    if (this.settings.checkRemoteOnOpen && file && this.isFileInScope(file)) {
      this.enqueueRemoteCheck(file.path, "file-open");
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
  enqueueSync(path, reason) {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "sync" });
      this.queuedPaths.add(path);
      this.logDebug(`Queued: ${path} (${reason})`);
    }
    void this.processQueue();
  }
  enqueueRemoteCheck(path, reason) {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "check" });
      this.queuedPaths.add(path);
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
        this.logDebug(`Processing: ${task.path} (${task.reason})`);
        if (task.kind === "check") {
          await this.checkRemoteForPath(task.path, task.reason);
        } else {
          await this.syncFileByPath(task.path, task.reason);
        }
      }
    } finally {
      this.queueRunning = false;
      if (this.queue.length === 0) {
        this.setStatus("idle");
      }
    }
  }
  async syncAllMarkdown() {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isFileInScope(file)) continue;
      this.enqueueSync(file.path, "manual-all");
    }
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
    if (!file.path.endsWith(".md")) return false;
    if (this.settings.enableChangelog && file.path === this.settings.changelogPath) {
      return false;
    }
    if (this.isInConflictArchive(file.path)) {
      return false;
    }
    if (this.isInPreviewFolder(file.path)) {
      return false;
    }
    if (this.isDeletionsLog(file.path)) {
      return false;
    }
    const includePatterns = parsePatterns(this.settings.includePatterns);
    const excludePatterns = parsePatterns(this.settings.excludePatterns);
    const path = file.path;
    if (includePatterns.length > 0 && !matchAnyGlob(path, includePatterns)) {
      return false;
    }
    if (excludePatterns.length > 0 && matchAnyGlob(path, excludePatterns)) {
      return false;
    }
    return true;
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
    this.statusBarItem.empty();
    const detail = this.currentSyncPath ? ` ${this.currentSyncPath}` : "";
    switch (status) {
      case "syncing":
        (0, import_obsidian2.setIcon)(this.statusBarItem, "sync");
        this.statusBarItem.appendText(` Syncing${detail}`);
        break;
      case "conflict":
        (0, import_obsidian2.setIcon)(this.statusBarItem, "alert-triangle");
        this.statusBarItem.appendText(` Conflict${detail}`);
        break;
      case "error":
        (0, import_obsidian2.setIcon)(this.statusBarItem, "x-circle");
        this.statusBarItem.appendText(` Error${detail}`);
        break;
      default:
        (0, import_obsidian2.setIcon)(this.statusBarItem, "check-circle");
        this.statusBarItem.appendText(` Idle${detail}`);
        break;
    }
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
    this.currentSyncPath = path;
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
      lastKnownRemoteMtime: null
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
        await this.updateStateAfterUpload(client, file.path, remotePath, localHash, state);
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
        state.lastSyncedHash = await hashString(remoteContent);
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
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
      await this.updateStateAfterUpload(client, file.path, remotePath, localHash, state);
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
      this.currentSyncPath = null;
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
    this.currentSyncPath = path;
    this.setStatus("syncing");
    const client = this.getClientOrNotice();
    if (!client) return;
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
      lastKnownRemoteMtime: null
    };
    const checkAttempt = async () => {
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
      if (!state.lastSyncedHash) {
        const response2 = await client.get(remotePath);
        if (!response2.ok) {
          throw await this.handleWebDavError(response2, file.path);
        }
        const remoteContent2 = await response2.text();
        const remoteHash = await hashString(remoteContent2);
        if (remoteHash !== localHash) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          new import_obsidian2.Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
          this.logDebug(`Conflict (check initial): ${file.path}`);
          return;
        }
        state.lastSyncedHash = localHash;
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
        this.state.files[file.path] = state;
        await this.savePluginData();
        return;
      }
      const lastEtag = normalizeEtag(state.lastKnownEtag);
      const remoteEtag = normalizeEtag(remoteInfo.etag);
      const remoteChanged = !!lastEtag && !!remoteEtag && lastEtag !== remoteEtag;
      if (!remoteChanged) return;
      const localChanged = state.lastSyncedHash !== localHash;
      if (localChanged) {
        const conflictPath = await this.createConflictCopy(file, localContent);
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
      state.lastSyncedHash = await hashString(remoteContent);
      state.lastKnownEtag = remoteInfo.etag;
      state.lastKnownRemoteMtime = remoteInfo.lastModified;
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
      this.currentSyncPath = null;
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
  async syncTasksForFile(file, content) {
    if (!this.settings.enableTaskSync || !this.settings.taskSyncOnFileSync) {
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
    const useTasksPlugin = this.isTasksPluginEnabled();
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    if (tasks.length === 0) return { content, changed: false };
    let changed = false;
    const seenUids = /* @__PURE__ */ new Set();
    for (const task of tasks) {
      let uid = task.uid;
      const summary = task.summary;
      const checked = task.checked;
      if (!uid) {
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
          new import_obsidian2.Notice(`Task conflict for ${uid}. Keeping local.`);
        }
        await this.updateRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin, remote.etag);
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: localLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag
        };
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
      if (state.filePath === file.path && !seenUids.has(uid)) {
        delete this.state.tasks[uid];
      }
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
  async updateStateAfterUpload(client, vaultPath, remotePath, localHash, state) {
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
    state.lastSyncTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    this.state.files[vaultPath] = state;
    await this.savePluginData();
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
      lastKnownRemoteMtime: null
    };
    await this.updateStateAfterUpload(client, file.path, conflict.remotePath, localHash, state);
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
      lastKnownRemoteMtime: null
    };
    state.lastSyncedHash = await hashString(remoteContent);
    state.lastKnownEtag = etag;
    state.lastKnownRemoteMtime = mtime;
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
    const archiveFolder = this.settings.conflictArchiveFolder.trim();
    const archiveRoot = archiveFolder.replace(/\/+$/, "");
    if (!archiveRoot) return;
    const fileName = conflictFile.name;
    const archivePath = await this.getUniqueArchivePath(archiveRoot, fileName);
    await this.ensureLocalFolder(archiveRoot);
    const conflictContent = await this.app.vault.read(conflictFile);
    await this.app.vault.rename(conflictFile, archivePath);
    const remoteArchiveRoot = this.settings.conflictArchiveRemoteFolder.replace(/^\/+|\/+$/g, "");
    if (!remoteArchiveRoot) return;
    const remoteArchivePath = `${remoteArchiveRoot}/${getFileName(archivePath)}`;
    await this.ensureRemoteFolders(client, remoteArchivePath);
    const response = await client.put(remoteArchivePath, conflictContent, {
      "If-None-Match": "*"
    });
    if (!response.ok && response.status !== 405 && response.status !== 409) {
      this.logDebug(`Archive upload failed: ${remoteArchivePath} (${response.status})`);
    }
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
`;
    document.head.appendChild(style);
    this.register(() => style.remove());
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
    new import_obsidian2.Setting(containerEl).setName("Focus check throttle (ms)").setDesc("Minimum delay between focus-triggered checks per file").addText(
      (text) => text.setPlaceholder("2000").setValue(String(this.plugin.settings.focusCheckThrottleMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.focusCheckThrottleMs = Number.isFinite(parsed) ? parsed : 2e3;
        await this.plugin.savePluginData();
      })
    );
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
    const uidMatch = summary.match(/<!--\s*nc-task:([A-Za-z0-9-]+)\s*-->$/);
    if (uidMatch) {
      uid = uidMatch[1];
      summary = summary.replace(uidMatch[0], "").trim();
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
function formatTaskUid(uid) {
  return `<!-- nc-task:${uid} -->`;
}
function generateUid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(16).slice(2);
  const now = Date.now().toString(16);
  return `${now}-${random}`;
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
    { emoji: "📅", key: "dueDate" },
    { emoji: "⏳", key: "scheduledDate" },
    { emoji: "🛫", key: "startDate" },
    { emoji: "➕", key: "createdDate" },
    { emoji: "✅", key: "doneDate" },
    { emoji: "❌", key: "cancelledDate" }
  ];
  for (const field of dateFields) {
    const regex = new RegExp(`${field.emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const match = cleaned.match(regex);
    if (match) {
      meta[field.key] = match[1];
      cleaned = cleaned.replace(match[0], " ").trim();
    }
  }
  if (cleaned.includes("⏫")) {
    meta.priority = 1;
    cleaned = cleaned.replace("⏫", " ").trim();
  } else if (cleaned.includes("🔼")) {
    meta.priority = 3;
    cleaned = cleaned.replace("🔼", " ").trim();
  } else if (cleaned.includes("🔽")) {
    meta.priority = 7;
    cleaned = cleaned.replace("🔽", " ").trim();
  } else if (cleaned.includes("⏬")) {
    meta.priority = 9;
    cleaned = cleaned.replace("⏬", " ").trim();
  }
  const recurrenceIndex = cleaned.indexOf("🔁");
  if (recurrenceIndex !== -1) {
    const tokenList = ["📅", "⏳", "🛫", "➕", "✅", "❌", "⏫", "🔼", "🔽", "⏬"];
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
    const emoji = meta.priority <= 1 ? "⏫" : meta.priority <= 3 ? "🔼" : meta.priority >= 9 ? "⏬" : "🔽";
    parts.push(emoji);
  }
  if (meta.dueDate) parts.push(`📅 ${meta.dueDate}`);
  if (meta.scheduledDate) parts.push(`⏳ ${meta.scheduledDate}`);
  if (meta.startDate) parts.push(`🛫 ${meta.startDate}`);
  if (meta.createdDate) parts.push(`➕ ${meta.createdDate}`);
  if (meta.doneDate) parts.push(`✅ ${meta.doneDate}`);
  if (meta.cancelledDate) parts.push(`❌ ${meta.cancelledDate}`);
  if (meta.recurrenceText) parts.push(`🔁 ${meta.recurrenceText}`);
  return parts.join(" ");
}
function buildTaskLine(options) {
  const { prefix, checked, summary, tags, meta, uid, statusSymbol, useTasksPlugin } = options;
  if (!useTasksPlugin) {
    return `${prefix}${checked ? "[x]" : "[ ]"} ${summary} ${formatTaskUid(uid)}`.trimEnd();
  }
  const effectiveSymbol = checked ? "x" : statusSymbol === "x" || statusSymbol === "X" ? " " : statusSymbol;
  const tagTokens = normalizeTags(tags).map((tag) => `#${tag}`).join(" ");
  const metaTokens = formatTaskMetaTokens(meta);
  const body = [summary, tagTokens, metaTokens].filter((part) => part && part.length > 0).join(" ").trim();
  return `${prefix}[${effectiveSymbol}] ${body} ${formatTaskUid(uid)}`.trimEnd();
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
