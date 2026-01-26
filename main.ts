import {
  App,
  Modal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  setIcon,
} from "obsidian";
import { WebDavClient, WebDavRequestError, WebDavResponse } from "./webdav";

type FileSyncState = {
  vaultPath: string;
  lastSyncedHash: string | null;
  lastKnownEtag: string | null;
  lastSyncTimestamp: string | null;
  lastKnownRemoteMtime: string | null;
};

type ConflictState = {
  vaultPath: string;
  conflictPath: string;
  remotePath: string;
  remoteEtag: string | null;
  timestamp: string;
};

type PluginState = {
  files: Record<string, FileSyncState>;
  conflicts: Record<string, ConflictState>;
  deletionsApplied: Record<string, string>;
  tasks: Record<string, TaskSyncState>;
};

type PluginSettings = {
  nextcloudBaseUrl: string;
  username: string;
  appPassword: string;
  remoteRoot: string;
  debounceMs: number;
  includePatterns: string;
  excludePatterns: string;
  syncOnModify: boolean;
  syncOnFileClose: boolean;
  checkRemoteOnOpen: boolean;
  checkRemoteOnFocus: boolean;
  focusCheckThrottleMs: number;
  promptRemoteDelete: boolean;
  applyRemoteDeletions: boolean;
  remoteDeletionsPath: string;
  enableTaskSync: boolean;
  taskListUrl: string;
  caldavBaseUrl: string;
  taskSyncOnFileSync: boolean;
  enableChangelog: boolean;
  changelogPath: string;
  enableDebug: boolean;
  archiveConflictsOnResolve: boolean;
  conflictArchiveFolder: string;
  conflictArchiveRemoteFolder: string;
};

type StoredData = {
  settings: PluginSettings;
  state: PluginState;
};

type SyncStatus = "idle" | "syncing" | "conflict" | "error";

type SyncTask = {
  path: string;
  reason: string;
  kind: "sync" | "check";
};

type FileStatus = "synced" | "dirty" | "conflict" | "error";

type RemoteVersionEntry = {
  href: string;
  lastModified: string | null;
  etag: string | null;
  size: number | null;
};

type DeletionEntry = {
  path: string;
  timestamp: string;
};

type TaskListEntry = {
  name: string;
  url: string;
};

type TaskSyncState = {
  uid: string;
  filePath: string;
  lastSyncedLine: string;
  lastRemoteModified: string | null;
  lastRemoteEtag: string | null;
};

type TaskLine = {
  lineIndex: number;
  raw: string;
  checked: boolean;
  summary: string;
  uid: string | null;
  prefix: string;
};

type TaskRemoteEntry = {
  uid: string;
  summary: string;
  completed: boolean;
  lastModified: string | null;
  etag: string | null;
  href: string;
};

const DEFAULT_SETTINGS: PluginSettings = {
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
  focusCheckThrottleMs: 2000,
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
  conflictArchiveRemoteFolder: ".sync-conflicts",
};

const CREDENTIAL_PREFIX = "enc:v1:";
const CREDENTIAL_KEY_STORAGE = "sync-plugin-cred-key";

const EMPTY_STATE: PluginState = {
  files: {},
  conflicts: {},
  deletionsApplied: {},
  tasks: {},
};

export default class SyncPlugin extends Plugin {
  private settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private state: PluginState = { ...EMPTY_STATE };
  private statusBarItem: HTMLElement | null = null;
  private queue: SyncTask[] = [];
  private queuedPaths = new Set<string>();
  private queueRunning = false;
  private debounceTimers = new Map<string, number>();
  private suppressModifyForPaths = new Set<string>();
  private lastActiveFile: TFile | null = null;
  private currentSyncPath: string | null = null;
  private logEntries: string[] = [];
  private logLimit = 200;
  private lastFocusChecks = new Map<string, number>();
  private previewFiles = new Set<string>();
  private fileStatuses = new Map<string, FileStatus>();
  private deletionSyncInFlight = false;
  private suppressDeletePrompt = new Set<string>();
  private credentialKeyPromise: Promise<CryptoKey | null> | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.addSettingTab(new SyncSettingTab(this.app, this));

    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("idle");
    this.seedStatusesFromState();
    this.applyStatusStyles();
    void this.syncRemoteDeletions("startup");

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
        if (!(file instanceof TFile)) return;
        menu.addItem((item) => {
          item
            .setTitle("Open remote version history")
            .setIcon("history")
            .onClick(() => void this.openRemoteHistory(file));
        });
        menu.addItem((item) => {
          item
            .setTitle("Delete (sync)")
            .setIcon("trash")
            .onClick(() => void this.promptDeleteWithSync(file));
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
      },
    });

    this.addCommand({
      id: "sync-all-files",
      name: "Sync all",
      callback: () => this.syncAllMarkdown(),
    });

    this.addCommand({
      id: "sync-show-queue",
      name: "Show sync queue",
      callback: () => this.showSyncQueue(),
    });

    this.addCommand({
      id: "sync-show-log",
      name: "Show sync log",
      callback: () => this.showSyncLog(),
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
      },
    });

    this.addCommand({
      id: "sync-show-conflicts",
      name: "Show conflicts",
      callback: () => this.showConflicts(),
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
      },
    });
  }

  onunload(): void {
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private isEncryptedCredential(value: string): boolean {
    return Boolean(value) && value.startsWith(CREDENTIAL_PREFIX);
  }

  private encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  private decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private async getCredentialKey(): Promise<CryptoKey | null> {
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

  private async encryptCredential(value: string): Promise<string> {
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

  private async decryptCredential(value: string): Promise<string> {
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

  private async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as StoredData | null;
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
        caldavBaseUrl: await this.decryptCredential(storedSettings.caldavBaseUrl),
      };
      this.state = {
        files: data.state?.files ?? {},
        conflicts: data.state?.conflicts ?? {},
        deletionsApplied: data.state?.deletionsApplied ?? {},
        tasks: data.state?.tasks ?? {},
      };
      if (
        !wasUsernameEncrypted ||
        !wasPasswordEncrypted ||
        !wasNextcloudEncrypted ||
        !wasTaskListEncrypted ||
        !wasCaldavEncrypted
      ) {
        await this.savePluginData();
      }
      return;
    }
    if (data && !data.settings) {
      const legacy = data as PluginState;
      this.state = {
        files: legacy?.files ?? {},
        conflicts: legacy?.conflicts ?? {},
        deletionsApplied: legacy?.deletionsApplied ?? {},
        tasks: legacy?.tasks ?? {},
      };
    }
  }

  private async savePluginData(): Promise<void> {
    const settings = {
      ...this.settings,
      nextcloudBaseUrl: await this.encryptCredential(this.settings.nextcloudBaseUrl),
      username: await this.encryptCredential(this.settings.username),
      appPassword: await this.encryptCredential(this.settings.appPassword),
      taskListUrl: await this.encryptCredential(this.settings.taskListUrl),
      caldavBaseUrl: await this.encryptCredential(this.settings.caldavBaseUrl),
    };
    const data: StoredData = {
      settings,
      state: this.state,
    };
    await this.saveData(data);
  }

  private onVaultModify(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (!this.isFileInScope(file)) return;
    if (this.suppressModifyForPaths.has(file.path)) {
      this.suppressModifyForPaths.delete(file.path);
      return;
    }
    this.setFileStatus(file.path, "dirty");
    if (!this.settings.syncOnModify) return;
    this.scheduleDebouncedSync(file.path, "modify");
  }

  private onVaultDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
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
        new Notice(`Nextcloud sync delete error: ${message}`);
      }
    }).open();
  }

  private async onVaultRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file.path === oldPath) return;
    if (file instanceof TFile) {
      await this.handleFileRename(file, oldPath);
      return;
    }
    if (file instanceof TFolder) {
      await this.handleFolderRename(file, oldPath);
    }
  }

  private renameStatusEntries(oldPrefix: string, newPrefix: string): void {
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

  private renamePrefixInSet(set: Set<string>, oldPrefix: string, newPrefix: string): void {
    for (const path of Array.from(set.values())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      set.delete(path);
      const newPath = newPrefix + path.slice(oldPrefix.length);
      set.add(newPath);
    }
  }

  private renamePrefixInMap<T>(map: Map<string, T>, oldPrefix: string, newPrefix: string): void {
    for (const [path, value] of Array.from(map.entries())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      map.delete(path);
      const newPath = newPrefix + path.slice(oldPrefix.length);
      map.set(newPath, value);
    }
  }

  private clearDebounceTimersForPrefix(oldPrefix: string): void {
    for (const [path, timer] of Array.from(this.debounceTimers.entries())) {
      if (path !== oldPrefix && !path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      window.clearTimeout(timer);
      this.debounceTimers.delete(path);
    }
  }

  private renamePrefixInQueue(oldPrefix: string, newPrefix: string): void {
    for (const task of this.queue) {
      if (task.path !== oldPrefix && !task.path.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      task.path = newPrefix + task.path.slice(oldPrefix.length);
    }
    this.renamePrefixInSet(this.queuedPaths, oldPrefix, newPrefix);
  }

  private renamePrefixInRecord<T>(
    record: Record<string, T>,
    oldPrefix: string,
    newPrefix: string,
    transform?: (value: T, newPath: string) => T
  ): string[] {
    const moved: string[] = [];
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

  private updateTaskPathsForRename(oldPrefix: string, newPrefix: string): void {
    for (const task of Object.values(this.state.tasks)) {
      if (task.filePath !== oldPrefix && !task.filePath.startsWith(`${oldPrefix}/`)) {
        continue;
      }
      task.filePath = newPrefix + task.filePath.slice(oldPrefix.length);
    }
  }

  private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
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
        remotePath: this.buildRemotePath(newPath),
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

  private async handleFolderRename(folder: TFolder, oldPath: string): Promise<void> {
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
      if (!(fileItem instanceof TFile) || !this.isFileInScope(fileItem)) {
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

    const scopedFiles = this.app.vault
      .getMarkdownFiles()
      .filter((fileItem) => fileItem.path.startsWith(`${newPath}/`) && this.isFileInScope(fileItem));

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

  private async promptDeleteWithSync(file: TFile): Promise<void> {
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
          new Notice(`Nextcloud sync delete error: ${message}`);
        }
      }
    }).open();
  }

  private onFileOpen(file: TFile | null): void {
    const previous = this.lastActiveFile;
    this.lastActiveFile = file;
    if (this.settings.syncOnFileClose && previous && previous !== file && this.isFileInScope(previous)) {
      this.enqueueSync(previous.path, "file-close");
    }
    if (this.settings.checkRemoteOnOpen && file && this.isFileInScope(file)) {
      this.enqueueRemoteCheck(file.path, "file-open");
    }
  }

  private onWindowFocus(): void {
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

  private scheduleDebouncedSync(path: string, reason: string): void {
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

  private enqueueSync(path: string, reason: string): void {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "sync" });
      this.queuedPaths.add(path);
      this.logDebug(`Queued: ${path} (${reason})`);
    }
    void this.processQueue();
  }

  private enqueueRemoteCheck(path: string, reason: string): void {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "check" });
      this.queuedPaths.add(path);
      this.logDebug(`Queued (check): ${path} (${reason})`);
    }
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
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

  private async syncAllMarkdown(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isFileInScope(file)) continue;
      this.enqueueSync(file.path, "manual-all");
    }
  }

  private getRemoteBaseUrl(): string {
    const base = this.settings.nextcloudBaseUrl.replace(/\/+$/, "");
    const user = encodeURIComponent(this.settings.username);
    return `${base}/remote.php/dav/files/${user}/`;
  }

  private buildRemotePath(localPath: string): string {
    const root = this.settings.remoteRoot.replace(/^\/+|\/+$/g, "");
    if (!root) return localPath;
    return `${root}/${localPath}`;
  }

  private isFileInScope(file: TFile): boolean {
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

  private isInConflictArchive(path: string): boolean {
    const folder = this.settings.conflictArchiveFolder.trim();
    if (!folder) return false;
    const normalized = folder.replace(/\/+$/, "");
    return path === normalized || path.startsWith(`${normalized}/`);
  }

  private isInPreviewFolder(path: string): boolean {
    const folder = ".sync-previews";
    return path === folder || path.startsWith(`${folder}/`);
  }

  private isDeletionsLog(path: string): boolean {
    const logPath = this.settings.remoteDeletionsPath.replace(/^\/+/, "");
    return path === logPath;
  }

  private setStatus(status: SyncStatus): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.empty();
    const detail = this.currentSyncPath ? ` ${this.currentSyncPath}` : "";
    switch (status) {
      case "syncing":
        setIcon(this.statusBarItem, "sync");
        this.statusBarItem.appendText(` Syncing${detail}`);
        break;
      case "conflict":
        setIcon(this.statusBarItem, "alert-triangle");
        this.statusBarItem.appendText(` Conflict${detail}`);
        break;
      case "error":
        setIcon(this.statusBarItem, "x-circle");
        this.statusBarItem.appendText(` Error${detail}`);
        break;
      default:
        setIcon(this.statusBarItem, "check-circle");
        this.statusBarItem.appendText(` Idle${detail}`);
        break;
    }
  }

  private async syncFileByPath(path: string, reason: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.logDebug(`Skip (not file): ${path}`);
      return;
    }
    if (this.state.conflicts[file.path]) {
      this.logDebug(`Skip (conflict exists): ${file.path}`);
      new Notice(`Nextcloud sync: conflict pending for ${file.path}. Resolve it first.`);
      this.setStatus("conflict");
      return;
    }
    if (!this.isFileInScope(file)) {
      this.logDebug(`Skip (out of scope): ${path}`);
      if (reason.startsWith("manual")) {
        new Notice(`Nextcloud sync skipped: ${path} not in scope.`);
      }
      return;
    }

    this.currentSyncPath = path;
    this.setStatus("syncing");

    const baseUrl = this.getRemoteBaseUrl();
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      this.setStatus("error");
      this.logDebug("Error: missing credentials or base URL.");
      new Notice("Nextcloud sync: missing credentials or base URL.");
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
    };

    const syncAttempt = async () => {
      let remoteInfo: { etag: string | null; lastModified: string | null } | null = null;
      try {
        remoteInfo = await client.propfind(remotePath);
      } catch (error) {
        const status = (error as WebDavRequestError).status;
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
        const response = await client.put(remotePath, localContent, {
          "If-None-Match": "*",
        });
        if (!response.ok) {
          this.logDebug(`PUT failed: ${remotePath} (${response.status})`);
          throw await this.handleWebDavError(response, file.path);
        }
        this.logDebug(`Uploaded (new): ${remotePath}`);
        await this.updateStateAfterUpload(client, file.path, remotePath, localHash, state);
        this.setFileStatus(file.path, "synced");
        await this.appendChangelogEntry(file.path, reason);
        return;
      }

      if (!state.lastSyncedHash) {
        const response = await client.get(remotePath);
        if (!response.ok) {
          throw await this.handleWebDavError(response, file.path);
        }
        const remoteContent = await response.text();
        const remoteHash = await hashString(remoteContent);
        if (remoteHash !== localHash) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          this.setFileStatus(file.path, "conflict");
          new Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
          this.logDebug(`Conflict (initial): ${file.path}`);
          return;
        }
        state.lastSyncedHash = localHash;
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastSyncTimestamp = new Date().toISOString();
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
        new Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
        this.logDebug(`Conflict: ${file.path}`);
        return;
      }

      if (remoteChanged && !localChanged) {
        const response = await client.get(remotePath);
        if (!response.ok) {
          this.logDebug(`GET failed: ${remotePath} (${response.status})`);
          throw await this.handleWebDavError(response, file.path);
        }
        const remoteContent = await response.text();
        this.suppressModifyForPaths.add(file.path);
        await this.app.vault.modify(file, remoteContent);
        state.lastSyncedHash = await hashString(remoteContent);
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastSyncTimestamp = new Date().toISOString();
        this.state.files[file.path] = state;
        await this.savePluginData();
        this.logDebug(`Downloaded: ${remotePath}`);
        this.setFileStatus(file.path, "synced");
        return;
      }

      if (!localChanged) {
        if (reason.startsWith("manual")) {
          new Notice(`Nextcloud sync: ${file.path} has no changes to upload.`);
        }
        this.logDebug(`No changes: ${file.path}`);
        return;
      }

      const response = await client.put(remotePath, localContent, {
        "If-Match": remoteInfo.etag ?? "*",
      });
      if (!response.ok) {
        if (response.status === 412) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          this.setFileStatus(file.path, "conflict");
          new Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
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
      new Notice(`Nextcloud sync error: ${message}`);
    } finally {
      this.currentSyncPath = null;
    }
  }

  private async checkRemoteForPath(path: string, reason: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
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
      lastKnownRemoteMtime: null,
    };

    const checkAttempt = async () => {
      let remoteInfo: { etag: string | null; lastModified: string | null } | null = null;
      try {
        remoteInfo = await client.propfind(remotePath);
      } catch (error) {
        const status = (error as WebDavRequestError).status;
        if (status === 404) {
          this.logDebug(`Remote missing (check): ${remotePath}`);
          return;
        }
        throw error;
      }

      if (!remoteInfo) return;

      if (!state.lastSyncedHash) {
        const response = await client.get(remotePath);
        if (!response.ok) {
          throw await this.handleWebDavError(response, file.path);
        }
        const remoteContent = await response.text();
        const remoteHash = await hashString(remoteContent);
        if (remoteHash !== localHash) {
          const conflictPath = await this.createConflictCopy(file, localContent);
          await this.storeConflict(file.path, conflictPath, remotePath, remoteInfo.etag);
          this.setStatus("conflict");
          new Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
          this.logDebug(`Conflict (check initial): ${file.path}`);
          return;
        }
        state.lastSyncedHash = localHash;
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastSyncTimestamp = new Date().toISOString();
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
        new Notice(`Nextcloud sync conflict: created conflict copy for ${file.path}`);
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
      state.lastSyncTimestamp = new Date().toISOString();
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
      new Notice(`Nextcloud sync error: ${message}`);
    } finally {
      this.currentSyncPath = null;
    }
  }

  private showSyncQueue(): void {
    new SyncQueueModal(this.app, this.currentSyncPath, this.queue).open();
  }

  private showSyncLog(): void {
    new SyncLogModal(this.app, this.logEntries).open();
  }

  private showConflicts(): void {
    new ConflictListModal(this.app, this).open();
  }

  private async deleteRemoteAndRecord(path: string, lastKnownEtag: string | null): Promise<void> {
    const client = this.getClientOrNotice();
    if (!client) return;

    const remotePath = this.buildRemotePath(path);
    const headers: Record<string, string> = {};
    if (lastKnownEtag) {
      headers["If-Match"] = lastKnownEtag;
    }
    const response = await client.delete(remotePath, headers);
    if (!response.ok && response.status !== 404) {
      throw await this.handleWebDavError(response, path);
    }

    await this.appendDeletionRecord(client, path);
    new Notice(`Nextcloud sync: deleted ${path} on server.`);
  }

  private async moveRemotePath(oldPath: string, newPath: string): Promise<boolean> {
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

  private async syncRemoteDeletions(reason: string): Promise<void> {
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
        if (localFile instanceof TFile) {
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

  private async appendDeletionRecord(client: WebDavClient, path: string): Promise<void> {
    const logPath = this.settings.remoteDeletionsPath.replace(/^\/+/, "");
    if (!logPath) return;
    const remoteLogPath = this.buildRemotePath(logPath);
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { deletions, etag, exists } = await this.fetchDeletionLog(client, remoteLogPath);
      deletions.push({ path, timestamp: new Date().toISOString() });
      const body = JSON.stringify({ deletions }, null, 2);
      const headers: Record<string, string> = {};
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

  private async fetchDeletionLog(
    client: WebDavClient,
    remoteLogPath: string
  ): Promise<{ deletions: DeletionEntry[]; etag: string | null; exists: boolean }> {
    let etag: string | null = null;
    let exists = true;
    try {
      const info = await client.propfind(remoteLogPath);
      etag = info.etag;
    } catch (error) {
      const status = (error as WebDavRequestError).status;
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

  private async openRemoteHistory(file: TFile): Promise<void> {
    if (this.state.conflicts[file.path]) {
      new Notice(`Nextcloud sync: conflict pending for ${file.path}. Resolve it first.`);
      this.setStatus("conflict");
      return;
    }
    if (!this.isFileInScope(file)) {
      new Notice(`Nextcloud sync skipped: ${file.path} not in scope.`);
      return;
    }

    const client = this.getClientOrNotice();
    if (!client) return;

    const remotePath = this.buildRemotePath(file.path);
    this.setStatus("syncing");

    try {
      const fileId = await client.propfindFileId(remotePath);
      if (!fileId) {
        new Notice("Nextcloud sync: could not find remote file id.");
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
        new Notice("Nextcloud sync: no remote versions found.");
        return;
      }
      new RemoteHistoryModal(this.app, file, versions, (entry) =>
        this.openRemoteVersionPreview(file, entry)
      ).open();
    } catch (error) {
      const message = this.describeError(error);
      this.logDebug(`Error (history): ${message}`);
      new Notice(`Nextcloud sync error: ${message}`);
    } finally {
      this.setStatus("idle");
    }
  }

  private getCalDavBaseUrl(): string {
    if (this.settings.caldavBaseUrl.trim()) {
      return this.settings.caldavBaseUrl.replace(/\/+$/, "");
    }
    const base = this.settings.nextcloudBaseUrl.replace(/\/+$/, "");
    return `${base}/remote.php/dav`;
  }

  private getCalendarHomeUrl(): string {
    const base = this.getCalDavBaseUrl();
    const user = encodeURIComponent(this.settings.username);
    return `${base}/calendars/${user}/`;
  }

  private async syncTasksForFile(
    file: TFile,
    content: string
  ): Promise<{ content: string; changed: boolean }> {
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

    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines);
    if (tasks.length === 0) return { content, changed: false };

    let changed = false;
    const seenUids = new Set<string>();

    for (const task of tasks) {
      let uid = task.uid;
      const summary = task.summary;
      const checked = task.checked;
      if (!uid) {
        uid = generateUid();
        const newLine = `${task.prefix}${checked ? "[x]" : "[ ]"} ${summary} ${formatTaskUid(uid)}`.trimEnd();
        lines[task.lineIndex] = newLine;
        await this.createRemoteTask(client, calendarUrl, uid, summary, checked);
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: newLine,
          lastRemoteModified: null,
          lastRemoteEtag: null,
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
      const remoteChanged =
        !!remote &&
        (!!state?.lastRemoteModified || !!state?.lastRemoteEtag) &&
        ((state?.lastRemoteModified && remote.lastModified !== state.lastRemoteModified) ||
          (state?.lastRemoteEtag && remote.etag !== state.lastRemoteEtag));

      if (remote && remoteChanged && !localChanged) {
        const updatedLine = `${task.prefix}${remote.completed ? "[x]" : "[ ]"} ${remote.summary} ${formatTaskUid(uid)}`.trimEnd();
        lines[task.lineIndex] = updatedLine;
        changed = true;
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: updatedLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag,
        };
        continue;
      }

      if (!remote) {
        await this.createRemoteTask(client, calendarUrl, uid, summary, checked);
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: localLine,
          lastRemoteModified: null,
          lastRemoteEtag: null,
        };
        continue;
      }

      if (localChanged) {
        if (remoteChanged) {
          new Notice(`Task conflict for ${uid}. Keeping local.`);
        }
        await this.updateRemoteTask(client, calendarUrl, uid, summary, checked, remote.etag);
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: localLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag,
        };
      } else if (!remoteChanged) {
        this.state.tasks[uid] = {
          uid,
          filePath: file.path,
          lastSyncedLine: localLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag,
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

  private normalizeCalendarUrl(url: string): string {
    if (url.startsWith("http")) {
      return url.replace(/\/+$/, "/");
    }
    const home = this.getCalendarHomeUrl();
    return `${home}${url.replace(/^\/+/, "")}`;
  }

  private async fetchRemoteTasks(
    client: WebDavClient,
    calendarUrl: string
  ): Promise<Map<string, TaskRemoteEntry>> {
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
    const tasks = new Map<string, TaskRemoteEntry>();
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
      });
    }
    return tasks;
  }

  private async createRemoteTask(
    client: WebDavClient,
    calendarUrl: string,
    uid: string,
    summary: string,
    completed: boolean
  ): Promise<void> {
    const url = `${calendarUrl.replace(/\/+$/, "/")}${uid}.ics`;
    const body = buildVtodo(uid, summary, completed);
    const response = await client.putAbsolute(url, body, { "If-None-Match": "*" });
    if (!response.ok) {
      throw await this.handleWebDavError(response, uid);
    }
  }

  private async updateRemoteTask(
    client: WebDavClient,
    calendarUrl: string,
    uid: string,
    summary: string,
    completed: boolean,
    etag: string | null
  ): Promise<void> {
    const url = `${calendarUrl.replace(/\/+$/, "/")}${uid}.ics`;
    const body = buildVtodo(uid, summary, completed);
    const headers: Record<string, string> = {};
    if (etag) {
      headers["If-Match"] = etag;
    }
    const response = await client.putAbsolute(url, body, headers);
    if (!response.ok) {
      throw await this.handleWebDavError(response, uid);
    }
  }

  async openTaskListPicker(): Promise<string | null> {
    const client = this.getClientOrNotice();
    if (!client) return null;
    const homeUrl = this.getCalendarHomeUrl();
    const lists = await this.fetchTaskLists(client, homeUrl);
    if (lists.length === 0) {
      new Notice("Nextcloud sync: no task lists found.");
      return null;
    }
    return await new Promise((resolve) => {
      new TaskListModal(this.app, lists, (url) => resolve(url)).open();
    });
  }

  private async fetchTaskLists(client: WebDavClient, homeUrl: string): Promise<TaskListEntry[]> {
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
    const lists: TaskListEntry[] = [];
    for (const response of responses) {
      const href = response.querySelector("href")?.textContent ?? "";
      const display = response.querySelector("displayname")?.textContent ?? "Tasks";
      const components = Array.from(response.querySelectorAll("supported-calendar-component-set comp"))
        .map((node) => node.getAttribute("name"))
        .filter(Boolean) as string[];
      if (!components.includes("VTODO")) continue;
      if (!href) continue;
      const url = href.startsWith("http") ? href : new URL(href, homeUrl).toString();
      lists.push({ name: display, url });
    }
    return lists;
  }

  private async openRemoteVersionPreview(file: TFile, entry: RemoteVersionEntry): Promise<void> {
    const client = this.getClientOrNotice();
    if (!client) return;

    const response = await client.getAbsolute(entry.href);
    if (!response.ok) {
      throw await this.handleWebDavError(response, file.path);
    }
    const content = await response.text();

    const previewFolder = ".sync-previews";
    await this.ensureLocalFolder(previewFolder);
    const timestamp = entry.lastModified
      ? formatTimestamp(entry.lastModified)
      : formatTimestamp(new Date().toISOString());
    const fileName = `${file.basename} (remote ${timestamp}).${file.extension || "md"}`;
    const previewPath = await this.getUniquePreviewPath(previewFolder, fileName);

    const previewFile = await this.app.vault.create(previewPath, content);
    this.previewFiles.add(previewFile.path);

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(previewFile, { state: { mode: "source" } });
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      // Make the preview read-only.
      view.editor?.setOption?.("readOnly", true);
      (view as unknown as { setEditable?: (value: boolean) => void }).setEditable?.(false);
    }
  }

  private async getUniquePreviewPath(folder: string, fileName: string): Promise<string> {
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

  private async cleanupPreviewFiles(): Promise<void> {
    const openPaths = new Set<string>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as { file?: TFile | null };
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

  private logDebug(message: string): void {
    if (!this.settings.enableDebug) return;
    const entry = `${new Date().toISOString()} ${message}`;
    this.logEntries.push(entry);
    if (this.logEntries.length > this.logLimit) {
      this.logEntries.shift();
    }
    console.debug("[YAA Nextcloud Sync]", message);
  }

  private async ensureRemoteFolders(client: WebDavClient, remotePath: string): Promise<void> {
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

  private async updateStateAfterUpload(
    client: WebDavClient,
    vaultPath: string,
    remotePath: string,
    localHash: string,
    state: FileSyncState
  ): Promise<void> {
    let updatedEtag = state.lastKnownEtag;
    let updatedMtime = state.lastKnownRemoteMtime;
    try {
      const info = await client.propfind(remotePath);
      updatedEtag = info.etag;
      updatedMtime = info.lastModified;
    } catch (error) {
      // Keep previous values if we cannot refresh.
    }

    state.lastSyncedHash = localHash;
    state.lastKnownEtag = updatedEtag;
    state.lastKnownRemoteMtime = updatedMtime;
    state.lastSyncTimestamp = new Date().toISOString();
    this.state.files[vaultPath] = state;
    await this.savePluginData();
  }

  private async handleWebDavError(response: WebDavResponse, target: string): Promise<WebDavRequestError> {
    const message = response.status === 401 || response.status === 403
      ? "Authentication failed. Check username/app password."
      : `Request failed for ${target} (${response.status} ${response.statusText})`;
    return { status: response.status, message };
  }

  describeError(error: unknown): string {
    if (typeof error === "string") return error;
    if (!error) return "Unknown error.";
    if ((error as WebDavRequestError).message) {
      return (error as WebDavRequestError).message;
    }
    if (error instanceof Error) return error.message;
    return "Unexpected error.";
  }

  private async retryWithBackoff(task: () => Promise<void>): Promise<void> {
    const delays = [500, 1500, 3500];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      try {
        await task();
        return;
      } catch (error) {
        const status = (error as WebDavRequestError).status;
        const transient = !status || status === 408 || status === 429 || status >= 500;
        if (!transient || attempt === delays.length - 1) {
          throw error;
        }
        await sleep(delays[attempt]);
      }
    }
  }

  private async createConflictCopy(file: TFile, content: string): Promise<string> {
    const timestamp = new Date();
    const date = timestamp.toISOString().slice(0, 10);
    const time = `${timestamp.getHours().toString().padStart(2, "0")}${timestamp
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
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

  private async appendChangelogEntry(path: string, reason: string): Promise<void> {
    if (!this.settings.enableChangelog) return;
    const entry = `- ${new Date().toISOString()} | ${path} | ${reason}\n`;
    const existing = this.app.vault.getAbstractFileByPath(this.settings.changelogPath);
    if (existing instanceof TFile) {
      await this.app.vault.append(existing, entry);
      return;
    }
    await this.app.vault.create(this.settings.changelogPath, `# Sync Changelog\n${entry}`);
  }

  private async storeConflict(
    vaultPath: string,
    conflictPath: string,
    remotePath: string,
    remoteEtag: string | null
  ): Promise<void> {
    this.state.conflicts[vaultPath] = {
      vaultPath,
      conflictPath,
      remotePath,
      remoteEtag,
      timestamp: new Date().toISOString(),
    };
    await this.savePluginData();
  }

  openConflictResolver(conflict: ConflictState): void {
    new ConflictResolverModal(this.app, this, conflict).open();
  }

  getClientOrNotice(): WebDavClient | null {
    const baseUrl = this.getRemoteBaseUrl();
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      this.setStatus("error");
      this.logDebug("Error: missing credentials or base URL.");
      new Notice("Nextcloud sync: missing credentials or base URL.");
      return null;
    }
    return new WebDavClient(baseUrl, this.settings.username, this.settings.appPassword);
  }

  async resolveConflictKeepLocal(conflict: ConflictState): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(conflict.vaultPath);
    if (!(file instanceof TFile)) {
      new Notice("Nextcloud sync: file no longer exists.");
      return;
    }
    const client = this.getClientOrNotice();
    if (!client) return;

    const localContent = await this.app.vault.read(file);
    const localHash = await hashString(localContent);
    const response = await client.put(conflict.remotePath, localContent, {
      "If-Match": conflict.remoteEtag ?? "*",
    });
    if (!response.ok) {
      if (response.status === 412) {
        new Notice("Nextcloud sync: conflict still exists. Remote changed again.");
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
    new Notice(`Nextcloud sync: kept local for ${file.path}`);
  }

  async resolveConflictKeepRemote(conflict: ConflictState): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(conflict.vaultPath);
    if (!(file instanceof TFile)) {
      new Notice("Nextcloud sync: file no longer exists.");
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
    let mtime: string | null = null;
    try {
      const info = await client.propfind(conflict.remotePath);
      etag = info.etag;
      mtime = info.lastModified;
    } catch (error) {
      // Use the stored ETag if we cannot refresh.
    }

    const state = this.state.files[file.path] ?? {
      vaultPath: file.path,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
    };
    state.lastSyncedHash = await hashString(remoteContent);
    state.lastKnownEtag = etag;
    state.lastKnownRemoteMtime = mtime;
    state.lastSyncTimestamp = new Date().toISOString();
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
    new Notice(`Nextcloud sync: kept remote for ${file.path}`);
  }

  private async archiveConflictCopy(conflict: ConflictState, client: WebDavClient): Promise<void> {
    const conflictFile = this.app.vault.getAbstractFileByPath(conflict.conflictPath);
    if (!(conflictFile instanceof TFile)) {
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
      "If-None-Match": "*",
    });
    if (!response.ok && response.status !== 405 && response.status !== 409) {
      this.logDebug(`Archive upload failed: ${remoteArchivePath} (${response.status})`);
    }
  }

  private async getUniqueArchivePath(folder: string, fileName: string): Promise<string> {
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

  private async ensureLocalFolder(path: string): Promise<void> {
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

  private async deleteConflictFile(conflictPath: string): Promise<void> {
    const conflictFile = this.app.vault.getAbstractFileByPath(conflictPath);
    if (conflictFile instanceof TFile) {
      await this.app.vault.delete(conflictFile);
      return;
    }
    const abstract = this.app.vault.getAbstractFileByPath(conflictPath);
    if (abstract) {
      await this.app.vault.delete(abstract);
    }
  }

  private seedStatusesFromState(): void {
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

  private setFileStatus(path: string, status: FileStatus): void {
    this.fileStatuses.set(path, status);
    this.updateFileExplorerIcon(path, status);
  }

  private refreshFileExplorerIcons(): void {
    for (const [path, status] of this.fileStatuses.entries()) {
      this.updateFileExplorerIcon(path, status);
    }
  }

  private updateFileExplorerIcon(path: string, status: FileStatus | null): void {
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of leaves) {
      const view = leaf.view as unknown as { fileItems?: Record<string, { el?: HTMLElement; titleEl?: HTMLElement }> };
      const item = view.fileItems?.[path];
      const container = item?.titleEl ?? item?.el;
      if (!container) continue;

      let iconEl = container.querySelector(".sync-status-icon") as HTMLElement | null;
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

      const icon = status === "synced"
        ? "check-circle"
        : status === "dirty"
          ? "circle"
          : status === "conflict"
            ? "alert-triangle"
            : "x-circle";
      setIcon(iconEl, icon);
      iconEl.setAttr("aria-label", `Sync status: ${status}`);
      iconEl.setAttr("title", `Sync status: ${status}`);
    }
  }

  private applyStatusStyles(): void {
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
}

class SyncSettingTab extends PluginSettingTab {
  private plugin: SyncPlugin;

  constructor(app: App, plugin: SyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Nextcloud Sync Suite" });

    new Setting(containerEl)
      .setName("Nextcloud base URL")
      .setDesc("Base URL of your Nextcloud (e.g., https://cloud.example.com)")
      .addText((text) =>
        text
          .setPlaceholder("https://cloud.example.com")
          .setValue(this.plugin.settings.nextcloudBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.nextcloudBaseUrl = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Username")
      .setDesc("Nextcloud username")
      .addText((text) =>
        text
          .setPlaceholder("username")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("App password")
      .setDesc("Nextcloud app password (stored locally)")
      .addText((text) =>
        text
          .setPlaceholder("app password")
          .setValue(this.plugin.settings.appPassword)
          .onChange(async (value) => {
            this.plugin.settings.appPassword = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Remote root folder")
      .setDesc("Folder under your WebDAV root where files are stored")
      .addText((text) =>
        text
          .setPlaceholder("Obsidian")
          .setValue(this.plugin.settings.remoteRoot)
          .onChange(async (value) => {
            this.plugin.settings.remoteRoot = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Debounce (ms)")
      .setDesc("Delay before syncing after edits")
      .addText((text) =>
        text
          .setPlaceholder("900")
          .setValue(String(this.plugin.settings.debounceMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.debounceMs = Number.isFinite(parsed) ? parsed : 900;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Include patterns")
      .setDesc("Glob patterns (one per line). Default: **/*.md")
      .addTextArea((text) =>
        text
          .setPlaceholder("**/*.md")
          .setValue(this.plugin.settings.includePatterns)
          .onChange(async (value) => {
            this.plugin.settings.includePatterns = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Exclude patterns")
      .setDesc("Glob patterns to skip (one per line)")
      .addTextArea((text) =>
        text
          .setPlaceholder("Templates/**")
          .setValue(this.plugin.settings.excludePatterns)
          .onChange(async (value) => {
            this.plugin.settings.excludePatterns = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Sync on modify")
      .setDesc("Automatically sync after edits")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnModify).onChange(async (value) => {
          this.plugin.settings.syncOnModify = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Sync on file close")
      .setDesc("Sync file when switching away from it")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnFileClose).onChange(async (value) => {
          this.plugin.settings.syncOnFileClose = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Check remote on open")
      .setDesc("When opening a note, fetch remote changes and sync down if newer")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.checkRemoteOnOpen).onChange(async (value) => {
          this.plugin.settings.checkRemoteOnOpen = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Check remote on focus")
      .setDesc("When Obsidian regains focus, check the active note for remote changes")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.checkRemoteOnFocus).onChange(async (value) => {
          this.plugin.settings.checkRemoteOnFocus = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Focus check throttle (ms)")
      .setDesc("Minimum delay between focus-triggered checks per file")
      .addText((text) =>
        text
          .setPlaceholder("2000")
          .setValue(String(this.plugin.settings.focusCheckThrottleMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.focusCheckThrottleMs = Number.isFinite(parsed) ? parsed : 2000;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Prompt to delete remote file")
      .setDesc("When deleting a synced file locally, ask to delete it on the server too")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.promptRemoteDelete).onChange(async (value) => {
          this.plugin.settings.promptRemoteDelete = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Apply remote deletions")
      .setDesc("Delete locally when a synced file was deleted on another device")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.applyRemoteDeletions).onChange(async (value) => {
          this.plugin.settings.applyRemoteDeletions = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Remote deletions log path")
      .setDesc("Remote JSON file used to broadcast deletions across devices")
      .addText((text) =>
        text
          .setPlaceholder(".sync-deletions.json")
          .setValue(this.plugin.settings.remoteDeletionsPath)
          .onChange(async (value) => {
            this.plugin.settings.remoteDeletionsPath = value.trim() || ".sync-deletions.json";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Task sync")
      .setDesc("Sync Markdown checkboxes with Nextcloud Tasks")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableTaskSync).onChange(async (value) => {
          this.plugin.settings.enableTaskSync = value;
          await this.plugin.savePluginData();
        })
      );

    let taskListText: { setValue: (value: string) => void } | null = null;
    new Setting(containerEl)
      .setName("Task list URL")
      .setDesc("Nextcloud task list (CalDAV) URL")
      .addText((text) => {
        taskListText = text;
        return text
          .setPlaceholder("https://cloud.example.com/remote.php/dav/calendars/user/tasks/")
          .setValue(this.plugin.settings.taskListUrl)
          .onChange(async (value) => {
            this.plugin.settings.taskListUrl = value.trim();
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Select task list")
      .setDesc("Pick from your Nextcloud task lists")
      .addButton((button) =>
        button.setButtonText("Select").onClick(() => {
          void this.plugin.openTaskListPicker().then((selectedUrl) => {
            if (!selectedUrl) return;
            this.plugin.settings.taskListUrl = selectedUrl;
            taskListText?.setValue(selectedUrl);
            void this.plugin.savePluginData();
          });
        })
      );

    new Setting(containerEl)
      .setName("CalDAV base URL (optional)")
      .setDesc("Override the derived CalDAV base URL")
      .addText((text) =>
        text
          .setPlaceholder("https://cloud.example.com/remote.php/dav")
          .setValue(this.plugin.settings.caldavBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.caldavBaseUrl = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Sync tasks during file sync")
      .setDesc("When syncing files, also sync checkbox tasks with Nextcloud")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.taskSyncOnFileSync).onChange(async (value) => {
          this.plugin.settings.taskSyncOnFileSync = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Local changelog")
      .setDesc("Append sync entries to a local note")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableChangelog).onChange(async (value) => {
          this.plugin.settings.enableChangelog = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Changelog path")
      .setDesc("Path for the local changelog note")
      .addText((text) =>
        text
          .setPlaceholder("Sync Changelog.md")
          .setValue(this.plugin.settings.changelogPath)
          .onChange(async (value) => {
            this.plugin.settings.changelogPath = value.trim() || "Sync Changelog.md";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Capture recent sync events for troubleshooting")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableDebug).onChange(async (value) => {
          this.plugin.settings.enableDebug = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Archive conflicts on resolve")
      .setDesc("Move conflict copies to an archive folder and upload them to the server")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.archiveConflictsOnResolve).onChange(async (value) => {
          this.plugin.settings.archiveConflictsOnResolve = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Conflict archive folder")
      .setDesc("Local folder to store resolved conflict copies")
      .addText((text) =>
        text
          .setPlaceholder("Sync Conflicts")
          .setValue(this.plugin.settings.conflictArchiveFolder)
          .onChange(async (value) => {
            this.plugin.settings.conflictArchiveFolder = value.trim() || "Sync Conflicts";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Remote conflict archive folder")
      .setDesc("Remote folder (under WebDAV root) to store conflict copies")
      .addText((text) =>
        text
          .setPlaceholder(".sync-conflicts")
          .setValue(this.plugin.settings.conflictArchiveRemoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.conflictArchiveRemoteFolder = value.trim() || ".sync-conflicts";
            await this.plugin.savePluginData();
          })
      );
  }
}

class SyncQueueModal extends Modal {
  private currentPath: string | null;
  private queue: SyncTask[];

  constructor(app: App, currentPath: string | null, queue: SyncTask[]) {
    super(app);
    this.currentPath = currentPath;
    this.queue = [...queue];
  }

  onOpen(): void {
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
}

class SyncLogModal extends Modal {
  private entries: string[];

  constructor(app: App, entries: string[]) {
    super(app);
    this.entries = [...entries];
  }

  onOpen(): void {
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
}

class RemoteHistoryModal extends Modal {
  private file: TFile;
  private versions: RemoteVersionEntry[];
  private onSelect: (entry: RemoteVersionEntry) => void;

  constructor(
    app: App,
    file: TFile,
    versions: RemoteVersionEntry[],
    onSelect: (entry: RemoteVersionEntry) => void
  ) {
    super(app);
    this.file = file;
    this.versions = versions;
    this.onSelect = onSelect;
  }

  onOpen(): void {
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
}

class RemoteDeleteModal extends Modal {
  private path: string;
  private onDecision: (shouldDelete: boolean) => void;

  constructor(app: App, path: string, onDecision: (shouldDelete: boolean) => void) {
    super(app);
    this.path = path;
    this.onDecision = onDecision;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Delete from server?" });
    contentEl.createEl("p", {
      text: `The file "${this.path}" was deleted locally. Delete it from Nextcloud too?`,
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
}

class TaskListModal extends Modal {
  private lists: TaskListEntry[];
  private onSelect: (url: string) => void;

  constructor(app: App, lists: TaskListEntry[], onSelect: (url: string) => void) {
    super(app);
    this.lists = lists;
    this.onSelect = onSelect;
  }

  onOpen(): void {
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
}

class DeleteWithSyncModal extends Modal {
  private path: string;
  private synced: boolean;
  private onDecision: (action: "delete-local" | "delete-remote" | "cancel") => void;

  constructor(
    app: App,
    path: string,
    synced: boolean,
    onDecision: (action: "delete-local" | "delete-remote" | "cancel") => void
  ) {
    super(app);
    this.path = path;
    this.synced = synced;
    this.onDecision = onDecision;
  }

  onOpen(): void {
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
}

class ConflictResolverModal extends Modal {
  private plugin: SyncPlugin;
  private conflict: ConflictState;

  constructor(app: App, plugin: SyncPlugin, conflict: ConflictState) {
    super(app);
    this.plugin = plugin;
    this.conflict = conflict;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Resolve Sync Conflict" });

    const info = contentEl.createEl("div", {
      text: `File: ${this.conflict.vaultPath}`,
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
        new Notice(`Nextcloud sync: ${this.plugin.describeError(error)}`);
      }
    };

    keepRemoteBtn.onclick = async () => {
      try {
        await this.plugin.resolveConflictKeepRemote(this.conflict);
        this.close();
      } catch (error) {
        new Notice(`Nextcloud sync: ${this.plugin.describeError(error)}`);
      }
    };

    openBothBtn.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(this.conflict.vaultPath);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf(false).openFile(file);
      }
      const conflictFile = this.app.vault.getAbstractFileByPath(this.conflict.conflictPath);
      if (conflictFile instanceof TFile) {
        void this.app.workspace.getLeaf(true).openFile(conflictFile);
      }
    };

    cancelBtn.onclick = () => this.close();

    const localFile = this.app.vault.getAbstractFileByPath(this.conflict.vaultPath);
    if (localFile instanceof TFile) {
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
}

class ConflictListModal extends Modal {
  private plugin: SyncPlugin;

  constructor(app: App, plugin: SyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
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
}

function parsePatterns(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function matchAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function globToRegExp(pattern: string): RegExp {
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

function normalizeEtag(value: string | null): string | null {
  if (!value) return null;
  let normalized = value.trim();
  if (normalized.startsWith("W/")) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith("\"") && normalized.endsWith("\"")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized || null;
}

function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function parseVersionList(xml: Document, metaUrl: string): RemoteVersionEntry[] {
  const responses = Array.from(xml.querySelectorAll("response"));
  const base = new URL(metaUrl);
  const entries: RemoteVersionEntry[] = [];

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
      size: Number.isFinite(size ?? NaN) ? size : null,
    });
  }

  entries.sort((a, b) => {
    const aTime = a.lastModified ? Date.parse(a.lastModified) : 0;
    const bTime = b.lastModified ? Date.parse(b.lastModified) : 0;
    return bTime - aTime;
  });

  return entries;
}

function formatVersionLabel(entry: RemoteVersionEntry): string {
  const timeLabel = entry.lastModified ? new Date(entry.lastModified).toLocaleString() : "Unknown time";
  const sizeLabel = entry.size ? `${Math.round(entry.size / 1024)} KB` : "Unknown size";
  return `${timeLabel} | ${sizeLabel}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    return null;
  }
}

function parseTaskLines(lines: string[]): TaskLine[] {
  const tasks: TaskLine[] = [];
  const pattern = /^(\s*-\s+)\[( |x|X)\]\s+(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(pattern);
    if (!match) continue;
    const prefix = match[1];
    const checked = match[2].toLowerCase() === "x";
    let summary = match[3].trim();
    let uid: string | null = null;
    const uidMatch = summary.match(/<!--\s*nc-task:([A-Za-z0-9-]+)\s*-->$/);
    if (uidMatch) {
      uid = uidMatch[1];
      summary = summary.replace(uidMatch[0], "").trim();
    }
    tasks.push({
      lineIndex: i,
      raw: line,
      checked,
      summary,
      uid,
      prefix,
    });
  }
  return tasks;
}

function formatTaskUid(uid: string): string {
  return `<!-- nc-task:${uid} -->`;
}

function generateUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(16).slice(2);
  const now = Date.now().toString(16);
  return `${now}-${random}`;
}

function buildVtodo(uid: string, summary: string, completed: boolean): string {
  const stamp = formatCalDate(new Date());
  const status = completed ? "COMPLETED" : "NEEDS-ACTION";
  const completedLine = completed ? `COMPLETED:${stamp}\r\n` : "";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nextcloud Sync Suite//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${escapeCalText(summary)}`,
    `STATUS:${status}`,
    completedLine.trimEnd(),
    "END:VTODO",
    "END:VCALENDAR",
  ]
    .filter((line) => line.length > 0)
    .join("\r\n");
}

function parseVtodo(data: string): {
  uid: string | null;
  summary: string | null;
  completed: boolean;
  lastModified: string | null;
} | null {
  const lines = unfoldIcalLines(data);
  let inTodo = false;
  let uid: string | null = null;
  let summary: string | null = null;
  let status: string | null = null;
  let completedValue: string | null = null;
  let lastModified: string | null = null;

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
    const key = rawKey.split(";")[0].toUpperCase();
    const value = rest.join(":");
    if (key === "UID") uid = value.trim();
    if (key === "SUMMARY") summary = unescapeCalText(value.trim());
    if (key === "STATUS") status = value.trim().toUpperCase();
    if (key === "COMPLETED") completedValue = value.trim();
    if (key === "LAST-MODIFIED") lastModified = value.trim();
  }

  if (!uid) return null;
  const completed = status === "COMPLETED" || completedValue !== null;
  return { uid, summary, completed, lastModified };
}

function unfoldIcalLines(data: string): string[] {
  const raw = data.split(/\r?\n/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines.filter((line) => line.length > 0);
}

function formatCalDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

function escapeCalText(value: string): string {
  return value.replace(/\\\\/g, "\\\\\\\\").replace(/\\n/g, "\\\\n").replace(/,/g, "\\\\,").replace(/;/g, "\\\\;");
}

function unescapeCalText(value: string): string {
  return value.replace(/\\\\n/g, "\\n").replace(/\\\\,/g, ",").replace(/\\\\;/g, ";").replace(/\\\\\\\\/g, "\\\\");
}

async function hashString(value: string): Promise<string> {
  if (window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const buffer = await window.crypto.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
