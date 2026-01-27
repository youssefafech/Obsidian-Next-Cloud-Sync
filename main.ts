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
import { WebDavClient, WebDavListEntry, WebDavRequestError, WebDavResponse } from "./webdav";

type FileSyncState = {
  vaultPath: string;
  lastSyncedHash: string | null;
  lastKnownEtag: string | null;
  lastSyncTimestamp: string | null;
  lastKnownRemoteMtime: string | null;
  lastKnownLocalMtime: number | null;
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
  noSync: Record<string, boolean>;
  noTaskSync: Record<string, boolean>;
  lastChecklistDate: string | null;
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
  periodicRemoteCheckEnabled: boolean;
  periodicRemoteCheckMinutes: number;
  periodicRemoteCheckNotices: boolean;
  taskSyncIntervalEnabled: boolean;
  taskSyncIntervalMinutes: number;
  taskInboxEnabled: boolean;
  taskInboxPath: string;
  taskInboxQuery: string;
  taskInboxAutoMove: boolean;
  taskInboxArchivePath: string;
  taskDeletionPromptEnabled: boolean;
  taskDeletionDefaultAction: "delete" | "complete" | "keep";
  todayNoteEnabled: boolean;
  todayNotePath: string;
  todayNoteLimit: number;
  todayNoteUseQuery: boolean;
  todayNoteQuery: string;
  remindersEnabled: boolean;
  remindersMinutes: number;
  remindersMode: "overdue" | "today" | "both";
  remindersMaxCount: number;
  dailyChecklistEnabled: boolean;
  dailyChecklistPath: string;
  dailyChecklistTemplate: string;
  quickCapturePath: string;
  focusTag: string;
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

type TaskLineMeta = {
  dueDate: string | null;
  scheduledDate: string | null;
  startDate: string | null;
  createdDate: string | null;
  doneDate: string | null;
  cancelledDate: string | null;
  priority: number | null;
  recurrenceText: string | null;
};

type TaskLine = {
  lineIndex: number;
  raw: string;
  checked: boolean;
  summary: string;
  uid: string | null;
  prefix: string;
  statusSymbol: string;
  tags: string[];
  meta: TaskLineMeta;
};

type QuickCaptureResult = {
  summary: string;
  checked: boolean;
  tags: string[];
  meta: TaskLineMeta;
  statusSymbol: string;
};

type TaskRemoteEntry = {
  uid: string;
  summary: string;
  completed: boolean;
  lastModified: string | null;
  etag: string | null;
  href: string;
  dueDate: string | null;
  startDate: string | null;
  completedDate: string | null;
  status: string | null;
  priority: number | null;
  percentComplete: number | null;
  categories: string[];
  description: string | null;
  recurrenceRule: string | null;
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
  conflictArchiveRemoteFolder: ".sync-conflicts",
};

const CREDENTIAL_PREFIX = "enc:v1:";
const CREDENTIAL_KEY_STORAGE = "sync-plugin-cred-key";

const EMPTY_STATE: PluginState = {
  files: {},
  conflicts: {},
  deletionsApplied: {},
  tasks: {},
  noSync: {},
  noTaskSync: {},
  lastChecklistDate: null,
};

export default class SyncPlugin extends Plugin {
  private settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private state: PluginState = { ...EMPTY_STATE };
  private statusBarItem: HTMLElement | null = null;
  private currentStatus: SyncStatus = "idle";
  private queue: SyncTask[] = [];
  private queuedPaths = new Set<string>();
  private queueRunning = false;
  private debounceTimers = new Map<string, number>();
  private taskDebounceTimers = new Map<string, number>();
  private suppressModifyForPaths = new Set<string>();
  private lastActiveFile: TFile | null = null;
  private currentSyncPath: string | null = null;
  private progressActive = false;
  private progressTotal = 0;
  private progressDone = 0;
  private logEntries: string[] = [];
  private logLimit = 200;
  private lastFocusChecks = new Map<string, number>();
  private previewFiles = new Set<string>();
  private fileStatuses = new Map<string, FileStatus>();
  private deletionSyncInFlight = false;
  private periodicSyncInFlight = false;
  private lockStatusPath = false;
  private pausePeriodic = false;
  private suppressDeletePrompt = new Set<string>();
  private suppressTaskDeletePrompt = new Set<string>();
  private credentialKeyPromise: Promise<CryptoKey | null> | null = null;
  private periodicSyncTimer: number | null = null;
  private taskSyncTimer: number | null = null;
  private reminderTimer: number | null = null;

  async onload(): Promise<void> {
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
        if (!(file instanceof TFile)) return;
        menu.addItem((item) => {
          const isDisabled = this.isNoSync(file.path);
          item
            .setTitle(isDisabled ? "Enable sync for this note" : "Disable sync for this note")
            .setIcon(isDisabled ? "toggle-right" : "toggle-left")
            .onClick(() => void this.toggleNoSync(file));
        });
        menu.addItem((item) => {
          const isDisabled = this.isNoTaskSync(file.path);
          item
            .setTitle(isDisabled ? "Enable task sync for this note" : "Disable task sync for this note")
            .setIcon(isDisabled ? "check-square" : "square")
            .onClick(() => void this.toggleNoTaskSync(file));
        });
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

    this.addCommand({
      id: "sync-task-id-cleanup",
      name: "Task ID cleanup (redownload IDs)",
      callback: () => void this.cleanupTaskIds(),
    });

    this.addCommand({
      id: "sync-refresh-today",
      name: "Refresh Today Focus note",
      callback: () => void this.refreshTodayNote(),
    });

    this.addCommand({
      id: "sync-quick-capture",
      name: "Quick capture task",
      callback: () => void this.quickCaptureTask(),
    });

    this.addCommand({
      id: "sync-start-task",
      name: "Start task (mark in progress)",
      callback: () => void this.startTaskAtCursor(),
    });

    this.addCommand({
      id: "sync-snooze-task",
      name: "Snooze task to tomorrow",
      callback: () => void this.snoozeTaskToTomorrow(),
    });

    this.addCommand({
      id: "sync-timeblock-task",
      name: "Add time block to task",
      callback: () => void this.addTimeBlockToTask(),
    });

    this.addCommand({
      id: "sync-sort-tasks",
      name: "Sort tasks in current note",
      callback: () => void this.sortTasksInActiveFile(),
    });

    this.addCommand({
      id: "sync-update-progress",
      name: "Update task progress line",
      callback: () => void this.updateProgressLineInActiveFile(),
    });

    this.addCommand({
      id: "sync-refresh-daily-checklist",
      name: "Refresh daily checklist",
      callback: () => void this.refreshDailyChecklist(),
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

  onunload(): void {
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

  setupPeriodicRemoteCheck(): void {
    if (this.periodicSyncTimer) {
      window.clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
    if (!this.settings.periodicRemoteCheckEnabled) return;
    const rawMinutes = Number.isFinite(this.settings.periodicRemoteCheckMinutes)
      ? this.settings.periodicRemoteCheckMinutes
      : 15;
    const minutes = Math.max(1, Math.floor(rawMinutes));
    const intervalMs = minutes * 60 * 1000;
    this.periodicSyncTimer = window.setInterval(() => {
      void this.runPeriodicRemoteCheck();
    }, intervalMs);
    this.logDebug(`Periodic remote check enabled (${minutes}m).`);
    void this.runPeriodicRemoteCheck();
  }

  setupTaskSyncInterval(): void {
    if (this.taskSyncTimer) {
      window.clearInterval(this.taskSyncTimer);
      this.taskSyncTimer = null;
    }
    if (!this.settings.taskSyncIntervalEnabled) return;
    const rawMinutes = Number.isFinite(this.settings.taskSyncIntervalMinutes)
      ? this.settings.taskSyncIntervalMinutes
      : 10;
    const minutes = Math.max(1, Math.floor(rawMinutes));
    const intervalMs = minutes * 60 * 1000;
    this.taskSyncTimer = window.setInterval(() => {
      void this.runPeriodicTaskSync();
    }, intervalMs);
    this.logDebug(`Task sync interval enabled (${minutes}m).`);
    void this.runPeriodicTaskSync();
  }

  setupReminders(): void {
    if (this.reminderTimer) {
      window.clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
    if (!this.settings.remindersEnabled) return;
    const rawMinutes = Number.isFinite(this.settings.remindersMinutes)
      ? this.settings.remindersMinutes
      : 60;
    const minutes = Math.max(5, Math.floor(rawMinutes));
    const intervalMs = minutes * 60 * 1000;
    this.reminderTimer = window.setInterval(() => {
      void this.runReminderCheck();
    }, intervalMs);
    this.logDebug(`Task reminders enabled (${minutes}m).`);
    void this.runReminderCheck();
  }

  private async runPeriodicRemoteCheck(): Promise<void> {
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      return;
    }
    if (this.periodicSyncInFlight) return;
    this.periodicSyncInFlight = true;
    this.startProgress();
    this.updatePeriodicLock();
    this.setStatus("syncing");
    if (this.settings.periodicRemoteCheckNotices) {
      new Notice("Nextcloud sync: periodic check started.");
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
        if (!(file instanceof TFile)) continue;
        if (!this.isFileInScope(file)) continue;
        this.enqueueRemoteCheck(file.path, "periodic");
      }
      await this.syncRemoteNewFiles("periodic");
      await this.syncRemoteDeletions("periodic");
      if (this.settings.periodicRemoteCheckNotices) {
        new Notice("Nextcloud sync: periodic check finished.");
      }
    } finally {
      this.periodicSyncInFlight = false;
      this.updatePeriodicLock();
      this.updateIdleStatus();
    }
  }

  private async runPeriodicTaskSync(): Promise<void> {
    if (!this.settings.enableTaskSync) return;
    if (!this.settings.taskListUrl) return;
    if (!this.settings.username || !this.settings.appPassword || !this.settings.nextcloudBaseUrl) {
      return;
    }
    if (this.hasDirtyFiles()) return;

    const client = this.getClientOrNotice();
    if (!client) return;
    const calendarUrl = this.normalizeCalendarUrl(this.settings.taskListUrl);
    let remoteTasks: Map<string, TaskRemoteEntry>;
    try {
      remoteTasks = await this.fetchRemoteTasks(client, calendarUrl);
    } catch (error) {
      const message = this.describeError(error);
      this.logDebug(`Error (task interval): ${message}`);
      return;
    }

    const useTasksPlugin = this.isTasksPluginEnabled();
    const filesToUpdate = new Map<string, TFile>();
    for (const state of Object.values(this.state.tasks)) {
      if (this.isNoTaskSync(state.filePath)) continue;
      const file = this.app.vault.getAbstractFileByPath(state.filePath);
      if (!(file instanceof TFile)) continue;
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
        const remoteChanged =
          (!!state.lastRemoteModified && remote.lastModified !== state.lastRemoteModified) ||
          (!!state.lastRemoteEtag && remote.etag !== state.lastRemoteEtag);
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
          useTasksPlugin,
        });
        lines[task.lineIndex] = updatedLine;
        changed = true;
        this.state.tasks[task.uid] = {
          uid: task.uid,
          filePath: file.path,
          lastSyncedLine: updatedLine,
          lastRemoteModified: remote.lastModified,
          lastRemoteEtag: remote.etag,
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

  private async runReminderCheck(): Promise<void> {
    if (!this.settings.remindersEnabled) return;
    const tasks = await this.collectAllOpenTasks();
    const today = formatDateOnly(new Date());
    const overdue: TaskLine[] = [];
    const dueToday: TaskLine[] = [];
    for (const task of tasks) {
      const due = task.meta.dueDate ?? task.meta.scheduledDate ?? task.meta.startDate;
      if (!due) continue;
      if (due < today) {
        overdue.push(task);
      } else if (due === today) {
        dueToday.push(task);
      }
    }
    let list: TaskLine[] = [];
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
    new Notice(`Nextcloud sync: ${list.length} ${label} due. Showing top ${count}.`);
  }

  private async collectAllOpenTasks(): Promise<TaskLine[]> {
    const tasks: TaskLine[] = [];
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

  private async appendRemoteTasksToInbox(
    remoteTasks: Map<string, TaskRemoteEntry>,
    useTasksPlugin: boolean
  ): Promise<void> {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    this.ensureInboxNoSync(inboxPath);
    if (this.isNoTaskSync(inboxPath)) return;

    let inboxFile = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!inboxFile) {
      const folder = inboxPath.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      inboxFile = await this.app.vault.create(inboxPath, "# Task Inbox\n");
    }
    if (!(inboxFile instanceof TFile)) return;

    let content = await this.app.vault.read(inboxFile);
    content = this.ensureInboxQueryBlock(content);
    const lines = content.split(/\r?\n/);
    const existingTasks = parseTaskLines(lines, { useTasksPlugin });
    const existingUids = new Set(existingTasks.map((task) => task.uid).filter(Boolean) as string[]);

    const newLines: string[] = [];
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
        useTasksPlugin,
      });
      newLines.push(line);
      this.state.tasks[remote.uid] = {
        uid: remote.uid,
        filePath: inboxPath,
        lastSyncedLine: line,
        lastRemoteModified: remote.lastModified,
        lastRemoteEtag: remote.etag,
      };
    }

    if (newLines.length === 0) return;
    const separator = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    const updated = content + separator + newLines.join("\n") + "\n";
    this.suppressModifyForPaths.add(inboxPath);
    await this.app.vault.modify(inboxFile, updated);
  }

  private ensureInboxQueryBlock(content: string): string {
    const query = this.settings.taskInboxQuery.trim();
    if (!query) return content;
    const hasQuery = /```tasks[\s\S]*?```/m.test(content);
    if (hasQuery) return content;
    const block = `${query}\n\n`;
    if (content.trim().length === 0) {
      return `# Task Inbox\n\n${block}`;
    }
    return content.startsWith("#") ? `${content}\n\n${block}` : `# Task Inbox\n\n${block}${content}`;
  }

  private async reconcileTaskOwnership(file: TFile, content: string): Promise<void> {
    if (!this.settings.taskInboxEnabled) return;
    if (!this.settings.taskInboxAutoMove) return;
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    this.ensureInboxNoSync(inboxPath);
    if (file.path === inboxPath) return;
    if (this.isNoTaskSync(file.path)) return;

    const useTasksPlugin = this.isTasksPluginEnabled();
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    const seen = new Set<string>();
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

  private async removeTaskLineByUid(path: string, uid: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
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

  private resolvePathTemplate(template: string): string {
    const date = formatDateOnly(new Date());
    return template.replace(/\{\{date\}\}/g, date);
  }

  private async refreshTodayNote(): Promise<void> {
    if (!this.settings.todayNoteEnabled) return;
    const path = this.resolvePathTemplate(this.settings.todayNotePath.trim() || "Today.md");
    const limit = Math.max(1, this.settings.todayNoteLimit);
    const useQuery = this.settings.todayNoteUseQuery && this.isTasksPluginEnabled();

    let content = `# Today Focus\n\n`;
    if (useQuery) {
      const query = (this.settings.todayNoteQuery || "").replace(/\{\{limit\}\}/g, String(limit));
      content += `${query}\n`;
    } else {
      const tasks = await this.collectAllOpenTasks();
      const sorted = tasks.sort((a, b) => compareTaskPriority(a, b));
      const top = sorted.slice(0, limit);
      if (top.length === 0) {
        content += "_No open tasks._\n";
      } else {
        for (const task of top) {
          content += `- [ ] ${task.summary}\n`;
        }
      }
    }

    await this.writeNote(path, content, true);
    await this.updateProgressLine(path);
  }

  private async refreshDailyChecklist(): Promise<void> {
    if (!this.settings.dailyChecklistEnabled) return;
    const today = formatDateOnly(new Date());
    if (this.state.lastChecklistDate === today) return;
    const path = this.resolvePathTemplate(this.settings.dailyChecklistPath.trim() || "Daily Checklist.md");
    this.ensureChecklistNoSync(path);
    const content = `# Daily Checklist (${today})\n\n${this.settings.dailyChecklistTemplate.trim()}\n`;
    await this.writeNote(path, content, true);
    this.state.lastChecklistDate = today;
    await this.savePluginData();
  }


  private async quickCaptureTask(): Promise<void> {
    const data = await this.promptQuickCapture();
    if (!data || !data.summary.trim()) return;
    const path = this.resolvePathTemplate(this.settings.quickCapturePath.trim() || "Task Inbox.md");
    const useTasksPlugin = this.isTasksPluginEnabled();
    const shouldAddUid = this.settings.enableTaskSync && this.settings.taskListUrl.trim().length > 0;
    const line = shouldAddUid
      ? buildTaskLine({
          prefix: "- ",
          checked: data.checked,
          summary: data.summary.trim(),
          tags: data.tags,
          meta: data.meta,
          uid: generateUid(),
          statusSymbol: data.statusSymbol,
          useTasksPlugin,
        })
      : buildTaskLineNoUid({
          summary: data.summary.trim(),
          checked: data.checked,
          tags: data.tags,
          meta: data.meta,
          statusSymbol: data.statusSymbol,
          useTasksPlugin,
        });
    await this.appendLineToNote(path, line);
    if (this.settings.enableTaskSync && this.settings.taskListUrl.trim()) {
      await this.syncTasksForPath(path);
    }
  }

  private async startTaskAtCursor(): Promise<void> {
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

  private async snoozeTaskToTomorrow(): Promise<void> {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    const { file, lineIndex, lines } = result;
    let line = lines[lineIndex] ?? "";
    if (!isTaskLine(line)) return;
    const tomorrow = formatDateOnly(new Date(Date.now() + 86400000));
    if (line.match(/📅\s*\d{4}-\d{2}-\d{2}/)) {
      line = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `📅 ${tomorrow}`);
    } else {
      line = `${line} 📅 ${tomorrow}`.trimEnd();
    }
    lines[lineIndex] = line;
    await this.writeFileLines(file, lines);
  }

  private async addTimeBlockToTask(): Promise<void> {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    const { file, lineIndex, lines } = result;
    let line = lines[lineIndex] ?? "";
    if (!isTaskLine(line)) return;
    const value = window.prompt("Time block (e.g., 10:00-11:00):");
    if (!value || !value.trim()) return;
    if (line.match(/🕒\s*[^\s]+/)) {
      line = line.replace(/🕒\s*[^\s]+/, `🕒 ${value.trim()}`);
    } else {
      line = `${line} 🕒 ${value.trim()}`.trimEnd();
    }
    lines[lineIndex] = line;
    await this.writeFileLines(file, lines);
  }

  private async sortTasksInActiveFile(): Promise<void> {
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

  private async updateProgressLineInActiveFile(): Promise<void> {
    const result = await this.getActiveFileAndLine();
    if (!result) return;
    await this.updateProgressLine(result.file.path);
  }

  private async updateProgressLine(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const tasks = parseTaskLines(lines, { useTasksPlugin: this.isTasksPluginEnabled() });
    const total = tasks.length;
    const done = tasks.filter((t) => t.checked).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
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

  private async writeNote(path: string, content: string, overwrite: boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const folder = path.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      await this.app.vault.create(path, content);
      return;
    }
    if (file instanceof TFile && overwrite) {
      this.suppressModifyForPaths.add(path);
      await this.app.vault.modify(file, content);
    }
  }

  private async appendLineToNote(path: string, line: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const folder = path.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      await this.app.vault.create(path, `# ${getFileName(path)}\n\n${line}\n`);
      return;
    }
    if (file instanceof TFile) {
      const content = await this.app.vault.read(file);
      const separator = content.endsWith("\n") || content.length === 0 ? "" : "\n";
      this.suppressModifyForPaths.add(path);
      await this.app.vault.modify(file, content + separator + line + "\n");
    }
  }

  private async syncTasksForPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    let content = await this.app.vault.read(file);
    const result = await this.syncTasksForFile(file, content, { force: true });
    if (result.changed) {
      this.suppressModifyForPaths.add(file.path);
      await this.app.vault.modify(file, result.content);
    }
  }

  private async getActiveFileAndLine(): Promise<{ file: TFile; lineIndex: number; lines: string[] } | null> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) return null;
    const lineIndex = editor.getCursor().line;
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    return { file, lineIndex, lines };
  }

  private async writeFileLines(file: TFile, lines: string[]): Promise<void> {
    this.suppressModifyForPaths.add(file.path);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async promptQuickCapture(): Promise<QuickCaptureResult | null> {
    return await new Promise((resolve) => {
      new QuickCaptureModal(this.app, resolve).open();
    });
  }

  private isTasksPluginEnabled(): boolean {
    const plugins = (this.app as unknown as { plugins?: { getPlugin?: (id: string) => unknown; enabledPlugins?: Set<string> } })
      .plugins;
    if (!plugins) return false;
    const enabledSet = plugins.enabledPlugins;
    if (enabledSet && !enabledSet.has("obsidian-tasks-plugin")) return false;
    return Boolean(plugins.getPlugin?.("obsidian-tasks-plugin"));
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
        noSync: data.state?.noSync ?? {},
        noTaskSync: data.state?.noTaskSync ?? {},
        lastChecklistDate: data.state?.lastChecklistDate ?? null,
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
        noSync: {},
        noTaskSync: {},
        lastChecklistDate: null,
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

  private onVaultDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (this.suppressDeletePrompt.has(file.path)) {
      this.suppressDeletePrompt.delete(file.path);
      return;
    }
    if (this.settings.taskInboxEnabled) {
      const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
      if (file.path === inboxPath) {
        void this.restoreTaskInbox();
        new Notice("Nextcloud sync: Task Inbox cannot be deleted.");
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
        new Notice(`Nextcloud sync delete error: ${message}`);
      }
    }).open();
  }

  private async onVaultRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file.path === oldPath) return;
    if (this.settings.taskInboxEnabled) {
      const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
      if (oldPath === inboxPath && file.path !== inboxPath && file instanceof TFile) {
        try {
          await this.app.fileManager.renameFile(file, inboxPath);
          this.ensureInboxNoSync(inboxPath);
          await this.savePluginData();
          new Notice("Nextcloud sync: Task Inbox cannot be renamed.");
        } catch (error) {
          this.logDebug(`Inbox rename restore failed: ${this.describeError(error)}`);
        }
        return;
      }
    }
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
    this.renamePrefixInRecord(this.state.noSync, oldPath, newPath);
    this.renamePrefixInRecord(this.state.noTaskSync, oldPath, newPath);

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

  private scheduleTaskDebouncedSync(path: string): void {
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

  private enqueueSync(path: string, reason: string): void {
    if (!this.queuedPaths.has(path)) {
      this.queue.push({ path, reason, kind: "sync" });
      this.queuedPaths.add(path);
      this.addProgressTotal(1);
      this.logDebug(`Queued: ${path} (${reason})`);
    }
    void this.processQueue();
  }

  private enqueueRemoteCheck(path: string, reason: string): void {
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

  private async processQueue(): Promise<void> {
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

  private async syncAllMarkdown(): Promise<void> {
    if (this.hasDirtyFiles()) {
      new Notice("Nextcloud sync: waiting for dirty files before Sync all.");
      const cleared = await this.waitForNoDirtyFiles();
      if (!cleared) {
        new Notice("Nextcloud sync: Sync all canceled (dirty files still pending).");
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
    return this.isPathInScope(file.path);
  }

  private isPathInScope(path: string): boolean {
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

  private isNoSync(path: string): boolean {
    return Boolean(this.state.noSync[path]);
  }

  private isNoTaskSync(path: string): boolean {
    return Boolean(this.state.noTaskSync[path]);
  }

  private async toggleNoSync(file: TFile): Promise<void> {
    if (this.isNoSync(file.path)) {
      delete this.state.noSync[file.path];
      await this.reconcileNoteTaskState(file);
      new Notice(`Nextcloud sync: enabled for ${file.path}`);
    } else {
      this.state.noSync[file.path] = true;
      this.fileStatuses.delete(file.path);
      this.updateFileExplorerIcon(file.path, null);
      new Notice(`Nextcloud sync: disabled for ${file.path}`);
    }
    await this.savePluginData();
  }

  private async toggleNoTaskSync(file: TFile): Promise<void> {
    if (this.isNoTaskSync(file.path)) {
      delete this.state.noTaskSync[file.path];
      new Notice(`Nextcloud sync: task sync enabled for ${file.path}`);
    } else {
      this.state.noTaskSync[file.path] = true;
      new Notice(`Nextcloud sync: task sync disabled for ${file.path}`);
    }
    await this.savePluginData();
  }

  private async reconcileNoteTaskState(file: TFile): Promise<void> {
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
          lastRemoteEtag: null,
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

  private ensureInboxNoSync(inboxPath: string): void {
    if (!this.settings.taskInboxEnabled) return;
    if (!inboxPath) return;
    this.state.noSync[inboxPath] = true;
    if (this.state.noTaskSync[inboxPath]) {
      delete this.state.noTaskSync[inboxPath];
    }
  }

  private ensureArchiveNoSync(path: string): void {
    if (!path) return;
    this.state.noSync[path] = true;
    this.state.noTaskSync[path] = true;
  }

  private ensureChecklistNoSync(path: string): void {
    if (!path) return;
    this.state.noSync[path] = true;
  }

  private async archiveInboxCompleted(): Promise<void> {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
    const inboxFile = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!(inboxFile instanceof TFile)) return;
    const content = await this.app.vault.read(inboxFile);
    const lines = content.split(/\r?\n/);
    const useTasksPlugin = this.isTasksPluginEnabled();
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    const completed = tasks.filter((t) => t.checked);
    if (completed.length === 0) return;

    const remaining = new Set(tasks.filter((t) => !t.checked).map((t) => t.lineIndex));
    const updatedLines: string[] = [];
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
    if (archiveFile instanceof TFile) {
      const archiveContent = await this.app.vault.read(archiveFile);
      const separator = archiveContent.endsWith("\n") || archiveContent.length === 0 ? "" : "\n";
      const completedLines = completed.map((t) => t.raw.trimEnd()).join("\n");
      this.suppressModifyForPaths.add(archivePath);
      await this.app.vault.modify(archiveFile, archiveContent + separator + completedLines + "\n");
    }

    this.ensureArchiveNoSync(archivePath);
    await this.savePluginData();
  }

  private async restoreArchiveToInbox(): Promise<void> {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
    const archiveFile = this.app.vault.getAbstractFileByPath(archivePath);
    if (!(archiveFile instanceof TFile)) return;
    const content = await this.app.vault.read(archiveFile);
    const lines = content.split(/\r?\n/);
    const useTasksPlugin = this.isTasksPluginEnabled();
    const tasks = parseTaskLines(lines, { useTasksPlugin });
    const reopened = tasks.filter((t) => !t.checked);
    if (reopened.length === 0) return;

    const remaining = new Set(tasks.filter((t) => t.checked).map((t) => t.lineIndex));
    const updatedLines: string[] = [];
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
    if (inboxFile instanceof TFile) {
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

  private async restoreTaskInbox(): Promise<void> {
    const inboxPath = this.settings.taskInboxPath.trim() || "Task Inbox.md";
    this.ensureInboxNoSync(inboxPath);
    let file = this.app.vault.getAbstractFileByPath(inboxPath);
    if (!file) {
      const folder = inboxPath.split("/").slice(0, -1).join("/");
      await this.ensureLocalFolder(folder);
      const content = this.ensureInboxQueryBlock("# Task Inbox\n\n");
      file = await this.app.vault.create(inboxPath, content);
    } else if (file instanceof TFile) {
      const content = await this.app.vault.read(file);
      const updated = this.ensureInboxQueryBlock(content);
      if (updated !== content) {
        this.suppressModifyForPaths.add(inboxPath);
        await this.app.vault.modify(file, updated);
      }
    }
    await this.savePluginData();
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
    this.currentStatus = status;
    this.statusBarItem.empty();
    const detail = this.lockStatusPath
      ? " periodic check"
      : this.currentSyncPath
        ? ` ${this.currentSyncPath}`
        : "";
    const percent = this.progressActive && this.progressTotal > 0
      ? ` (${Math.min(100, Math.floor((this.progressDone / this.progressTotal) * 100))}%)`
      : "";
    switch (status) {
      case "syncing":
        setIcon(this.statusBarItem, "sync");
        this.statusBarItem.appendText(` Syncing${detail}${percent}`);
        break;
      case "conflict":
        setIcon(this.statusBarItem, "alert-triangle");
        this.statusBarItem.appendText(` Conflict${detail}${percent}`);
        break;
      case "error":
        setIcon(this.statusBarItem, "x-circle");
        this.statusBarItem.appendText(` Error${detail}${percent}`);
        break;
      default:
        setIcon(this.statusBarItem, "check-circle");
        this.statusBarItem.appendText(` Idle${detail}${percent}`);
        break;
    }
  }

  private hasPeriodicWork(): boolean {
    if (this.periodicSyncInFlight) return true;
    return this.queue.some((task) => task.reason === "periodic");
  }

  private updateIdleStatus(): void {
    if (this.queueRunning) return;
    if (this.queue.length > 0) return;
    if (this.hasPeriodicWork()) return;
    this.currentSyncPath = null;
    this.progressActive = false;
    this.progressTotal = 0;
    this.progressDone = 0;
    this.setStatus("idle");
  }

  private hasDirtyFiles(): boolean {
    for (const status of this.fileStatuses.values()) {
      if (status === "dirty") return true;
    }
    return false;
  }

  private async waitForNoDirtyFiles(timeoutMs = 120000): Promise<boolean> {
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

  private updatePeriodicLock(): void {
    const shouldLock = this.hasPeriodicWork();
    if (!shouldLock) {
      this.lockStatusPath = false;
      return;
    }
    this.lockStatusPath = true;
    this.currentSyncPath = "periodic check";
    this.setStatus(this.currentStatus);
  }

  private startProgress(): void {
    if (this.progressActive) return;
    this.progressActive = true;
    this.progressTotal = 0;
    this.progressDone = 0;
  }

  private addProgressTotal(count = 1): void {
    if (count <= 0) return;
    this.startProgress();
    this.progressTotal += count;
    this.setStatus(this.currentStatus);
  }

  private markProgressDone(count = 1): void {
    if (!this.progressActive) return;
    this.progressDone += count;
    if (this.progressDone > this.progressTotal) {
      this.progressTotal = this.progressDone;
    }
    this.setStatus(this.currentStatus);
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

    if (!this.lockStatusPath) {
      this.currentSyncPath = path;
    }
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
      lastKnownLocalMtime: null,
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
        state.lastKnownLocalMtime = file.stat.mtime;
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
        await this.reconcileTaskOwnership(file, remoteContent);
        state.lastSyncedHash = await hashString(remoteContent);
        state.lastKnownEtag = remoteInfo.etag;
        state.lastKnownRemoteMtime = remoteInfo.lastModified;
        state.lastKnownLocalMtime = file.stat.mtime;
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
      new Notice(`Nextcloud sync error: ${message}`);
    } finally {
      if (!this.lockStatusPath) {
        this.currentSyncPath = null;
      }
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
      lastKnownLocalMtime: null,
    };

    const checkAttempt = async () => {
      let localContent: string | null = null;
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
        const localHash = await hashString(localContent);
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
        state.lastKnownLocalMtime = file.stat.mtime;
        state.lastSyncTimestamp = new Date().toISOString();
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
          localContent ?? (await this.app.vault.read(file))
        );
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
      await this.reconcileTaskOwnership(file, remoteContent);
      state.lastSyncedHash = await hashString(remoteContent);
      state.lastKnownEtag = remoteInfo.etag;
      state.lastKnownRemoteMtime = remoteInfo.lastModified;
      state.lastKnownLocalMtime = file.stat.mtime;
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
      if (!this.lockStatusPath) {
        this.currentSyncPath = null;
      }
    }
  }

  private async syncRemoteNewFiles(reason: string): Promise<void> {
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
    let entries: WebDavListEntry[];
    try {
      entries = await client.list(remoteRoot, "infinity");
    } catch (error) {
      const message = this.describeError(error);
      if (!isPeriodic) {
        this.setStatus("error");
      }
      this.logDebug(`Error (list remote): ${message}`);
      if (showNotices) {
        new Notice(`Nextcloud sync error: ${message}`);
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
        new Notice(`Nextcloud sync: downloaded ${downloaded} remote file(s).`);
      }
    }
    if (failed > 0) {
      if (showNotices) {
        new Notice("Nextcloud sync: some remote files could not be downloaded. Check sync log.");
      }
    }

    if (!hadQueue && showStatus) {
      this.currentSyncPath = null;
      this.updateIdleStatus();
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

  private findLockedTaskUid(filePath: string, normalizedLine: string): string | null {
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

  private async syncTasksForFile(
    file: TFile,
    content: string,
    options?: { cleanup?: boolean; force?: boolean }
  ): Promise<{ content: string; changed: boolean }> {
    if (this.isNoTaskSync(file.path)) {
      return { content, changed: false };
    }
    if (this.settings.taskInboxEnabled) {
      const archivePath = this.settings.taskInboxArchivePath.trim() || "Task Inbox closed.md";
      if (file.path === archivePath) {
        return { content, changed: false };
      }
    }
    if (!this.settings.enableTaskSync || (!this.settings.taskSyncOnFileSync && !options?.force)) {
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
    const seenUids = new Set<string>();

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
          useTasksPlugin,
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
              useTasksPlugin,
            });
            lines[task.lineIndex] = updatedLine;
            this.state.tasks[uid] = {
              uid,
              filePath: file.path,
              lastSyncedLine: updatedLine,
              lastRemoteModified: matched.lastModified,
              lastRemoteEtag: matched.etag,
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
          useTasksPlugin,
        });
        lines[task.lineIndex] = newLine;
        await this.createRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin);
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
        const updatedLine = buildTaskLine({
          prefix: task.prefix,
          checked: remote.completed,
          summary: remote.summary,
          tags: remote.categories,
          meta: mapRemoteToTaskMeta(remote),
          uid,
          statusSymbol: task.statusSymbol,
          useTasksPlugin,
        });
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
        await this.createRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin);
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
              useTasksPlugin,
            });
            lines[task.lineIndex] = updatedLine;
            changed = true;
            this.state.tasks[uid] = {
              uid,
              filePath: file.path,
              lastSyncedLine: updatedLine,
              lastRemoteModified: remote.lastModified,
              lastRemoteEtag: remote.etag,
            };
          } else {
            await this.updateRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin, remote.etag);
            this.state.tasks[uid] = {
              uid,
              filePath: file.path,
              lastSyncedLine: localLine,
              lastRemoteModified: remote.lastModified,
              lastRemoteEtag: remote.etag,
            };
          }
          new Notice(`Task conflict for ${uid}. Kept newest change.`);
        } else {
          await this.updateRemoteTask(client, calendarUrl, uid, summary, checked, task, useTasksPlugin, remote.etag);
          this.state.tasks[uid] = {
            uid,
            filePath: file.path,
            lastSyncedLine: localLine,
            lastRemoteModified: remote.lastModified,
            lastRemoteEtag: remote.etag,
          };
        }
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
        dueDate: parsed.dueDate,
        startDate: parsed.startDate,
        completedDate: parsed.completedDate,
        status: parsed.status,
        priority: parsed.priority,
        percentComplete: parsed.percentComplete,
        categories: parsed.categories,
        description: parsed.description,
        recurrenceRule: parsed.recurrenceRule,
      });
    }
    return tasks;
  }

  private async promptTaskDeletion(uid: string, summary: string): Promise<"delete" | "complete" | "keep"> {
    if (!this.settings.taskDeletionPromptEnabled) {
      return this.settings.taskDeletionDefaultAction;
    }
    return await new Promise((resolve) => {
      new TaskDeleteModal(this.app, uid, summary, resolve).open();
    });
  }

  private async deleteRemoteTask(client: WebDavClient, remote: TaskRemoteEntry): Promise<void> {
    const headers: Record<string, string> = {};
    if (remote.etag) {
      headers["If-Match"] = remote.etag;
    }
    const response = await client.deleteAbsolute(remote.href, headers);
    if (!response.ok && response.status !== 404) {
      throw await this.handleWebDavError(response, remote.href);
    }
  }

  private async completeRemoteTask(
    client: WebDavClient,
    calendarUrl: string,
    remote: TaskRemoteEntry,
    useTasksPlugin: boolean
  ): Promise<void> {
    const taskLine: TaskLine = {
      lineIndex: 0,
      raw: "",
      checked: true,
      summary: remote.summary,
      uid: remote.uid,
      prefix: "- ",
      statusSymbol: "x",
      tags: remote.categories ?? [],
      meta: mapRemoteToTaskMeta(remote),
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

  private async createRemoteTask(
    client: WebDavClient,
    calendarUrl: string,
    uid: string,
    summary: string,
    completed: boolean,
    task: TaskLine,
    useTasksPlugin: boolean
  ): Promise<void> {
    const url = `${calendarUrl.replace(/\/+$/, "/")}${uid}.ics`;
    const body = buildVtodo(uid, summary, completed, task, useTasksPlugin);
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
    task: TaskLine,
    useTasksPlugin: boolean,
    etag: string | null
  ): Promise<void> {
    const url = `${calendarUrl.replace(/\/+$/, "/")}${uid}.ics`;
    const body = buildVtodo(uid, summary, completed, task, useTasksPlugin);
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
    localMtime: number,
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
    state.lastKnownLocalMtime = localMtime;
    state.lastSyncTimestamp = new Date().toISOString();
    this.state.files[vaultPath] = state;
    await this.savePluginData();
  }

  private async updateStateAfterDownload(
    vaultPath: string,
    content: string,
    remoteEtag: string | null,
    remoteMtime: string | null,
    localMtime: number
  ): Promise<void> {
    const state = this.state.files[vaultPath] ?? {
      vaultPath,
      lastSyncedHash: null,
      lastKnownEtag: null,
      lastSyncTimestamp: null,
      lastKnownRemoteMtime: null,
      lastKnownLocalMtime: null,
    };
    state.lastSyncedHash = await hashString(content);
    state.lastKnownEtag = remoteEtag;
    state.lastKnownRemoteMtime = remoteMtime;
    state.lastKnownLocalMtime = localMtime;
    state.lastSyncTimestamp = new Date().toISOString();
    this.state.files[vaultPath] = state;
    await this.savePluginData();
  }

  private async downloadRemoteFile(
    client: WebDavClient,
    remotePath: string,
    localPath: string,
    remoteEtag: string | null,
    remoteMtime: string | null,
    reason: string
  ): Promise<void> {
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
      lastKnownLocalMtime: null,
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
      lastKnownLocalMtime: null,
    };
    state.lastSyncedHash = await hashString(remoteContent);
    state.lastKnownEtag = etag;
    state.lastKnownRemoteMtime = mtime;
    state.lastKnownLocalMtime = file.stat.mtime;
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
    const conflictContent = await this.app.vault.read(conflictFile);

    const remoteArchiveRoot = this.settings.conflictArchiveRemoteFolder.replace(/^\/+|\/+$/g, "");
    if (remoteArchiveRoot) {
      const remoteArchivePath = `${remoteArchiveRoot}/${conflictFile.name}`;
      await this.ensureRemoteFolders(client, remoteArchivePath);
      const response = await client.put(remoteArchivePath, conflictContent, {
        "If-None-Match": "*",
      });
      if (!response.ok && response.status !== 405 && response.status !== 409) {
        this.logDebug(`Archive upload failed: ${remoteArchivePath} (${response.status})`);
      }
    }

    await this.deleteConflictFile(conflict.conflictPath);
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

  private async cleanupTaskIds(): Promise<void> {
    if (!this.settings.enableTaskSync) {
      new Notice("Nextcloud sync: enable Task sync first.");
      return;
    }
    if (!this.settings.taskListUrl) {
      new Notice("Nextcloud sync: set Task list URL first.");
      return;
    }

    new Notice("Nextcloud sync: cleaning task IDs...");
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
    new Notice("Nextcloud sync: task ID cleanup finished.");
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

      const special = this.getSpecialNoteType(path);
      let specialEl = container.querySelector(".nc-special-note-icon") as HTMLElement | null;
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
        const icon = special === "inbox"
          ? "inbox"
          : special === "archive"
            ? "archive"
            : special === "today"
              ? "calendar"
              : "check-square";
        setIcon(specialEl, icon);
        container.addClass("nc-special-note");
      } else {
        container.removeClass("nc-special-note");
        if (specialEl) specialEl.remove();
      }

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

  private getSpecialNoteType(path: string): "inbox" | "archive" | "today" | "checklist" | null {
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

  private addRibbonSeparator(): void {
    const ribbon = (this.app.workspace as unknown as { leftRibbonEl?: HTMLElement }).leftRibbonEl;
    if (!ribbon) return;
    const spacer = ribbon.createDiv({ cls: "nc-sync-ribbon-spacer" });
    this.register(() => spacer.remove());
  }

  private addRibbonAction(icon: string, title: string, callback: () => void): void {
    const el = this.addRibbonIcon(icon, title, callback);
    el.addClass("nc-sync-ribbon-icon");
  }

  private registerTaskIdIconProcessor(): void {
    this.registerMarkdownPostProcessor((el) => {
      const touched = new Set<HTMLElement>();
      const listItems = Array.from(el.querySelectorAll("li"));
      for (const li of listItems) {
        if (touched.has(li)) continue;
        if (!li.textContent?.includes("🆔")) continue;
        touched.add(li);

        let icon = li.querySelector<HTMLElement>(".nc-task-synced-icon");
        if (!icon) {
          icon = document.createElement("span");
          icon.className = "nc-task-synced-icon";
          setIcon(icon, "check-circle");
          const checkbox = li.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (checkbox) {
            checkbox.insertAdjacentElement("afterend", icon);
          } else {
            li.insertBefore(icon, li.firstChild);
          }
        }
      }
    });
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
    containerEl.createEl("h3", { text: "Connection" });

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

    containerEl.createEl("h3", { text: "Sync Behavior" });

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

    containerEl.createEl("h3", { text: "Remote Checks" });

    new Setting(containerEl)
      .setName("Periodic remote check")
      .setDesc("Check remote changes for all in-scope notes every N minutes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.periodicRemoteCheckEnabled)
          .onChange(async (value) => {
            this.plugin.settings.periodicRemoteCheckEnabled = value;
            await this.plugin.savePluginData();
            this.plugin.setupPeriodicRemoteCheck();
          })
      );

    new Setting(containerEl)
      .setName("Periodic check interval (minutes)")
      .setDesc("How often to check for remote changes when periodic check is enabled")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(String(this.plugin.settings.periodicRemoteCheckMinutes))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.periodicRemoteCheckMinutes = Number.isFinite(parsed)
              ? Math.max(1, parsed)
              : 15;
            await this.plugin.savePluginData();
            this.plugin.setupPeriodicRemoteCheck();
          })
      );

    new Setting(containerEl)
      .setName("Periodic check notices")
      .setDesc("Show a notice when a periodic check starts and finishes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.periodicRemoteCheckNotices)
          .onChange(async (value) => {
            this.plugin.settings.periodicRemoteCheckNotices = value;
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

    containerEl.createEl("h3", { text: "Deletes" });

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

    containerEl.createEl("h3", { text: "Task Sync" });

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
      .setName("Task sync interval")
      .setDesc("Sync tasks from Nextcloud on a fixed interval")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.taskSyncIntervalEnabled).onChange(async (value) => {
          this.plugin.settings.taskSyncIntervalEnabled = value;
          await this.plugin.savePluginData();
          this.plugin.setupTaskSyncInterval();
        })
      );

    new Setting(containerEl)
      .setName("Task sync interval (minutes)")
      .setDesc("How often to pull task updates from Nextcloud")
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.taskSyncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.taskSyncIntervalMinutes = Number.isFinite(parsed)
              ? Math.max(1, parsed)
              : 10;
            await this.plugin.savePluginData();
            this.plugin.setupTaskSyncInterval();
          })
      );

    new Setting(containerEl)
      .setName("Task deletion prompt")
      .setDesc("Ask what to do when a task is removed locally")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.taskDeletionPromptEnabled).onChange(async (value) => {
          this.plugin.settings.taskDeletionPromptEnabled = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Task deletion default action")
      .setDesc("Used when the prompt is disabled")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("delete", "Delete on server")
          .addOption("complete", "Mark completed on server")
          .addOption("keep", "Keep on server")
          .setValue(this.plugin.settings.taskDeletionDefaultAction)
          .onChange(async (value) => {
            this.plugin.settings.taskDeletionDefaultAction = value as "delete" | "complete" | "keep";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Remote task inbox")
      .setDesc("Append remote-only tasks to a local inbox note")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.taskInboxEnabled).onChange(async (value) => {
          this.plugin.settings.taskInboxEnabled = value;
          if (value) {
            const inboxPath = this.plugin.settings.taskInboxPath.trim() || "Task Inbox.md";
            this.plugin.state.noSync[inboxPath] = true;
            delete this.plugin.state.noTaskSync[inboxPath];
          }
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Remote task inbox path")
      .setDesc("Note path to store remote-only tasks")
      .addText((text) =>
        text
          .setPlaceholder("Task Inbox.md")
          .setValue(this.plugin.settings.taskInboxPath)
          .onChange(async (value) => {
            this.plugin.settings.taskInboxPath = value.trim() || "Task Inbox.md";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Task inbox archive path")
      .setDesc("Note path to archive completed inbox tasks")
      .addText((text) =>
        text
          .setPlaceholder("Task Inbox closed.md")
          .setValue(this.plugin.settings.taskInboxArchivePath)
          .onChange(async (value) => {
            this.plugin.settings.taskInboxArchivePath = value.trim() || "Task Inbox closed.md";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Remote task inbox query")
      .setDesc("Tasks plugin query inserted into the inbox note")
      .addTextArea((text) =>
        text
          .setPlaceholder("```tasks\nnot done\n```")
          .setValue(this.plugin.settings.taskInboxQuery)
          .onChange(async (value) => {
            this.plugin.settings.taskInboxQuery = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Auto-move tasks from inbox")
      .setDesc("Move inbox tasks to their note when the note is downloaded")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.taskInboxAutoMove).onChange(async (value) => {
          this.plugin.settings.taskInboxAutoMove = value;
          await this.plugin.savePluginData();
        })
      );

    containerEl.createEl("h3", { text: "Focus & Planning" });

    new Setting(containerEl)
      .setName("Today Focus note")
      .setDesc("Create/update a Today Focus note")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.todayNoteEnabled).onChange(async (value) => {
          this.plugin.settings.todayNoteEnabled = value;
          await this.plugin.savePluginData();
          if (value) {
            void this.plugin.refreshTodayNote();
          }
        })
      );

    new Setting(containerEl)
      .setName("Today Focus path")
      .setDesc("Path for Today note (supports {{date}})")
      .addText((text) =>
        text
          .setPlaceholder("Today.md")
          .setValue(this.plugin.settings.todayNotePath)
          .onChange(async (value) => {
            this.plugin.settings.todayNotePath = value.trim() || "Today.md";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Today Focus task limit")
      .setDesc("Max tasks shown in Today Focus")
      .addText((text) =>
        text
          .setPlaceholder("4")
          .setValue(String(this.plugin.settings.todayNoteLimit))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.todayNoteLimit = Number.isFinite(parsed) ? Math.max(1, parsed) : 4;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Today Focus uses Tasks query")
      .setDesc("Use Tasks plugin query block for Today Focus")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.todayNoteUseQuery).onChange(async (value) => {
          this.plugin.settings.todayNoteUseQuery = value;
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Today Focus query")
      .setDesc("Tasks query inserted into Today note (supports {{limit}})")
      .addTextArea((text) =>
        text
          .setPlaceholder("```tasks\\nnot done\\nlimit {{limit}}\\nsort by due\\n```")
          .setValue(this.plugin.settings.todayNoteQuery)
          .onChange(async (value) => {
            this.plugin.settings.todayNoteQuery = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Task reminders")
      .setDesc("Show gentle reminders for overdue or due-today tasks")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.remindersEnabled).onChange(async (value) => {
          this.plugin.settings.remindersEnabled = value;
          await this.plugin.savePluginData();
          this.plugin.setupReminders();
        })
      );

    new Setting(containerEl)
      .setName("Reminder interval (minutes)")
      .setDesc("How often to check for due tasks")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.remindersMinutes))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.remindersMinutes = Number.isFinite(parsed) ? Math.max(5, parsed) : 60;
            await this.plugin.savePluginData();
            this.plugin.setupReminders();
          })
      );

    new Setting(containerEl)
      .setName("Reminder mode")
      .setDesc("Which tasks to remind about")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("overdue", "Overdue only")
          .addOption("today", "Due today only")
          .addOption("both", "Overdue + due today")
          .setValue(this.plugin.settings.remindersMode)
          .onChange(async (value) => {
            this.plugin.settings.remindersMode = value as "overdue" | "today" | "both";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Reminder max count")
      .setDesc("Maximum tasks mentioned per reminder")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.remindersMaxCount))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.remindersMaxCount = Number.isFinite(parsed) ? Math.max(1, parsed) : 3;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Daily checklist")
      .setDesc("Create/reset a daily checklist note")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dailyChecklistEnabled).onChange(async (value) => {
          this.plugin.settings.dailyChecklistEnabled = value;
          await this.plugin.savePluginData();
          if (value) {
            void this.plugin.refreshDailyChecklist();
          }
        })
      );

    new Setting(containerEl)
      .setName("Daily checklist path")
      .setDesc("Path for daily checklist (supports {{date}})")
      .addText((text) =>
        text
          .setPlaceholder("Daily Checklist.md")
          .setValue(this.plugin.settings.dailyChecklistPath)
          .onChange(async (value) => {
            this.plugin.settings.dailyChecklistPath = value.trim() || "Daily Checklist.md";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Daily checklist template")
      .setDesc("Content inserted when checklist resets")
      .addTextArea((text) =>
        text
          .setPlaceholder("- [ ] Plan top 3 tasks")
          .setValue(this.plugin.settings.dailyChecklistTemplate)
          .onChange(async (value) => {
            this.plugin.settings.dailyChecklistTemplate = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Quick capture path")
      .setDesc("Note to append quick-captured tasks")
      .addText((text) =>
        text
          .setPlaceholder("Task Inbox.md")
          .setValue(this.plugin.settings.quickCapturePath)
          .onChange(async (value) => {
            this.plugin.settings.quickCapturePath = value.trim() || "Task Inbox.md";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Focus tag")
      .setDesc("Optional tag used by focus workflows")
      .addText((text) =>
        text
          .setPlaceholder("focus")
          .setValue(this.plugin.settings.focusTag)
          .onChange(async (value) => {
            this.plugin.settings.focusTag = value.trim() || "focus";
            await this.plugin.savePluginData();
          })
      );

    containerEl.createEl("h3", { text: "Changelog & Debug" });

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

    containerEl.createEl("h3", { text: "Conflicts" });

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

class TaskDeleteModal extends Modal {
  private uid: string;
  private summary: string;
  private onChoice: (choice: "delete" | "complete" | "keep") => void;

  constructor(
    app: App,
    uid: string,
    summary: string,
    onChoice: (choice: "delete" | "complete" | "keep") => void
  ) {
    super(app);
    this.uid = uid;
    this.summary = summary;
    this.onChoice = onChoice;
  }

  onOpen(): void {
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
}

class QuickCaptureModal extends Modal {
  private onSubmit: (value: QuickCaptureResult | null) => void;

  constructor(app: App, onSubmit: (value: QuickCaptureResult | null) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
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
      if (checked) meta.doneDate = formatDateOnly(new Date());
      const priorityMap: Record<string, number | null> = {
        none: null,
        high: 1,
        medium: 3,
        low: 7,
        lowest: 9,
      };
      meta.priority = priorityMap[prioritySelect.value] ?? null;
      const tags = parseTagInput(tagsInput.value);
      this.onSubmit({
        summary: summaryInput.value,
        checked,
        tags,
        meta,
        statusSymbol: checked ? "x" : " ",
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

function formatDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    return null;
  }
}

function parseTaskLines(lines: string[], options?: { useTasksPlugin?: boolean }): TaskLine[] {
  const tasks: TaskLine[] = [];
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
    let uid: string | null = null;
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
    let tags: string[] = [];
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
      meta,
    });
  }
  return tasks;
}

function stripTaskUid(value: string): string {
  return value
    .replace(/\s*🆔\s*[A-Za-z0-9-]+\s*/g, " ")
    .replace(/\s*<!--\s*nc-task:[A-Za-z0-9-]+\s*-->\s*/g, " ")
    .trim();
}

function stripTaskUidKeepWhitespace(value: string): string {
  return value
    .replace(/\s*🆔\s*[A-Za-z0-9-]+\s*/g, " ")
    .replace(/\s*<!--\s*nc-task:[A-Za-z0-9-]+\s*-->\s*/g, " ");
}

function normalizeTaskKey(summary: string, completed: boolean): string {
  const normalized = summary.trim().toLowerCase().replace(/\s+/g, " ");
  return `${completed ? "1" : "0"}|${normalized}`;
}

function isTaskLine(line: string): boolean {
  return /^\s*-\s+\[[^\]]\]\s+/.test(line);
}

function findFirstTaskIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isTaskLine(lines[i])) return i;
  }
  return lines.length;
}

function compareTaskPriority(a: TaskLine, b: TaskLine): number {
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

function parseTagInput(value: string): string[] {
  if (!value) return [];
  const parts = value
    .split(/[, ]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("#") ? part.slice(1) : part));
  return normalizeTags(parts);
}

function buildTaskLineNoUid(options: {
  summary: string;
  checked: boolean;
  tags: string[];
  meta: TaskLineMeta;
  statusSymbol: string;
  useTasksPlugin: boolean;
}): string {
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

function buildRemoteTaskIndex(
  tasks: Map<string, TaskRemoteEntry>
): Map<string, TaskRemoteEntry[]> {
  const index = new Map<string, TaskRemoteEntry[]>();
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

function popRemoteMatch(
  index: Map<string, TaskRemoteEntry[]> | null,
  summary: string,
  completed: boolean
): TaskRemoteEntry | null {
  if (!index) return null;
  const key = normalizeTaskKey(summary, completed);
  const bucket = index.get(key);
  if (!bucket || bucket.length === 0) return null;
  return bucket.shift() ?? null;
}

function formatTaskUid(uid: string): string {
  return `🆔 ${uid}`;
}

function generateUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    const uuid = crypto.randomUUID().replace(/-/g, "");
    return uuid.slice(0, 6);
  }
  const random = Math.random().toString(36).slice(2);
  return random.slice(0, 6);
}

function buildVtodo(uid: string, summary: string, completed: boolean, task: TaskLine, useTasksPlugin: boolean): string {
  const stamp = formatCalDate(new Date());
  const meta = useTasksPlugin ? task.meta : emptyTaskMeta();
  const status = meta.cancelledDate && !completed ? "CANCELLED" : completed ? "COMPLETED" : "NEEDS-ACTION";
  const completedDate = completed ? meta.doneDate : null;
  const completedLine = completed
    ? completedDate
      ? `COMPLETED;VALUE=DATE:${formatCalDateOnly(completedDate)}\r\n`
      : `COMPLETED:${stamp}\r\n`
    : "";
  const categories = useTasksPlugin ? normalizeTags(task.tags) : [];
  const descriptionParts: string[] = [];
  if (meta.scheduledDate) descriptionParts.push(`Scheduled: ${meta.scheduledDate}`);
  if (meta.createdDate) descriptionParts.push(`Created: ${meta.createdDate}`);
  if (meta.cancelledDate && status !== "CANCELLED") descriptionParts.push(`Cancelled: ${meta.cancelledDate}`);
  const recurrenceRule = meta.recurrenceText?.trim() ?? "";
  const hasRrule = recurrenceRule.toUpperCase().includes("FREQ=");
  if (meta.recurrenceText && !hasRrule) {
    descriptionParts.push(`Recurrence: ${meta.recurrenceText}`);
  }
  const descriptionLine = descriptionParts.length > 0
    ? `DESCRIPTION:${escapeCalText(descriptionParts.join("\\n"))}`
    : "";
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
  dueDate: string | null;
  startDate: string | null;
  completedDate: string | null;
  status: string | null;
  priority: number | null;
  percentComplete: number | null;
  categories: string[];
  description: string | null;
  recurrenceRule: string | null;
} | null {
  const lines = unfoldIcalLines(data);
  let inTodo = false;
  let uid: string | null = null;
  let summary: string | null = null;
  let status: string | null = null;
  let completedValue: string | null = null;
  let lastModified: string | null = null;
  let dueDate: string | null = null;
  let startDate: string | null = null;
  let completedDate: string | null = null;
  let priority: number | null = null;
  let percentComplete: number | null = null;
  let categories: string[] = [];
  let description: string | null = null;
  let recurrenceRule: string | null = null;

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
    recurrenceRule,
  };
}

function emptyTaskMeta(): TaskLineMeta {
  return {
    dueDate: null,
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    doneDate: null,
    cancelledDate: null,
    priority: null,
    recurrenceText: null,
  };
}

function normalizeTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag));
}

function parseTasksPluginTask(summary: string): { summary: string; tags: string[]; meta: TaskLineMeta } {
  let working = summary;
  const tags = extractTags(working);
  working = removeTags(working).trim();
  const { cleaned, meta } = extractTasksPluginMeta(working);
  return { summary: cleaned, tags, meta };
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  const pattern = /(^|\s)(#[A-Za-z0-9/_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tags.push(match[2].slice(1));
  }
  return Array.from(new Set(tags));
}

function removeTags(text: string): string {
  return text.replace(/(^|\s)#[A-Za-z0-9/_-]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function extractTasksPluginMeta(text: string): { cleaned: string; meta: TaskLineMeta } {
  let cleaned = text;
  const meta = emptyTaskMeta();

  const dateFields: Array<{ emoji: string; key: keyof TaskLineMeta }> = [
    { emoji: "📅", key: "dueDate" },
    { emoji: "⏳", key: "scheduledDate" },
    { emoji: "🛫", key: "startDate" },
    { emoji: "➕", key: "createdDate" },
    { emoji: "✅", key: "doneDate" },
    { emoji: "❌", key: "cancelledDate" },
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
    cleaned =
      cleaned.slice(0, recurrenceIndex).trim() +
      " " +
      cleaned.slice(endIndex).trim();
  }

  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return { cleaned, meta };
}

function formatTaskMetaTokens(meta: TaskLineMeta): string {
  const parts: string[] = [];
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

function buildTaskLine(options: {
  prefix: string;
  checked: boolean;
  summary: string;
  tags: string[];
  meta: TaskLineMeta;
  uid: string;
  statusSymbol: string;
  useTasksPlugin: boolean;
}): string {
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

function mapRemoteToTaskMeta(remote: TaskRemoteEntry): TaskLineMeta {
  return {
    dueDate: remote.dueDate,
    scheduledDate: null,
    startDate: remote.startDate,
    createdDate: null,
    doneDate: remote.completedDate,
    cancelledDate: remote.status === "CANCELLED" ? remote.completedDate : null,
    priority: remote.priority,
    recurrenceText: remote.recurrenceRule,
  };
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

function formatCalDateOnly(value: string): string {
  if (!value) return formatCalDate(new Date()).slice(0, 8);
  return value.replace(/-/g, "");
}

function parseCalDateValue(value: string, isDateValue: boolean): string | null {
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
