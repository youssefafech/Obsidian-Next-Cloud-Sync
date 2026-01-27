# Nextcloud Sync Suite (Obsidian)
Sync Markdown files from your vault to a self-hosted Nextcloud server over WebDAV, with optional two-way task sync via CalDAV.
## Features

- Debounced per-file syncing with a single queue to avoid rapid request floods.
- Scope control via include/exclude glob patterns (defaults to `**/*.md`).
- Manual commands: “Sync now (current file)” and “Sync all”.
- “Sync all” performs two-way sync, including downloading remote-only notes.
- Conflict detection using ETags (creates local conflict copies).
- Conflict resolver: “Resolve conflict for current file” opens a local/remote viewer and lets you keep either version.
- Conflict archive (local + remote) on resolve (default, configurable).
- Remote version history: “Open remote version history” lists Nextcloud versions and opens a read-only preview that is removed on close.
- Deletions: deleting a synced file prompts to delete it on Nextcloud (goes to server trash) and logs the deletion so other devices can move it to local trash.
- Renames/moves: file and folder moves are mirrored to Nextcloud (falls back to re-upload if needed).
- Status bar indicator: idle / syncing / conflict / error.
- Per-file sync status indicator in the file explorer.
- Remote change checks on file open and app focus (configurable throttle).
- Task sync: Markdown checkboxes sync with Nextcloud Tasks (two-way) when enabled.

## Setup
1. Copy this plugin folder into your vault at `.obsidian/plugins/nextcloud-sync-suite` or install from the community plugins.
2. In Obsidian, enable the plugin in Settings → Community plugins.
3. Open the plugin settings and configure:
    - Nextcloud base URL (e.g., `https://cloud.example.com`)
    - Username
    - App password (create one in Nextcloud → Settings → Security)
    - Remote root folder (e.g., `Obsidian`)
4. Optional: configure task sync by enabling “Task sync” and selecting a task list.
    
## Settings Reference

| Setting | Default | Description |
| --- | --- | --- |
| Nextcloud base URL | `https://your-nextcloud.example.com` | Base URL of your Nextcloud instance. |
| Username | `""` | Nextcloud username. |
| App password | `""` | App password generated in Nextcloud. |
| Remote root folder | `Obsidian` | Folder under your WebDAV root where files are stored. |
| Debounce (ms) | `900` | Delay before syncing after edits. |
| Include patterns | `**/*.md` | Glob patterns to include (one per line). |
| Exclude patterns | `""` | Glob patterns to exclude (one per line). |
| Sync on modify | `true` | Automatically sync after edits. |
| Sync on file close | `true` | Sync when switching away from a file. |
| Check remote on open | `true` | Check remote changes when opening a note. |
| Check remote on focus | `true` | Check the active note when Obsidian regains focus. |
| Focus check throttle (ms) | `2000` | Minimum delay between focus-triggered checks per file. |
| Periodic remote check | `false` | Check all in-scope notes every N minutes. |
| Periodic check interval (minutes) | `15` | Interval for periodic remote checks. |
| Periodic check notices | `false` | Show a notice when a periodic check starts and finishes. |
| Prompt to delete remote file | `true` | Ask before deleting the remote copy. |
| Apply remote deletions | `true` | Delete locally when remote deletions are detected. |
| Remote deletions log path | `.sync-deletions.json` | Remote JSON file used to broadcast deletions across devices. |
| Task sync | `false` | Enable two-way task sync with Nextcloud Tasks. |
| Task list URL | `""` | CalDAV task list URL. |
| CalDAV base URL (optional) | `""` | Optional override for CalDAV base URL. |
| Sync tasks during file sync | `true` | Sync tasks whenever a file sync runs. |
| Local changelog | `false` | Append sync entries to a local note. |
| Changelog path | `Sync Changelog.md` | Path for the local changelog note. |
| Debug logging | `false` | Capture recent sync events for troubleshooting. |
| Archive conflicts on resolve | `true` | Archive resolved conflicts locally and remotely. |
| Conflict archive folder | `Sync Conflicts` | Local folder for archived conflicts. |
| Remote conflict archive folder | `.sync-conflicts` | Remote folder (under WebDAV root) for archived conflicts. |

## Tasks (Two-Way)
- Task lines are detected as Markdown checkboxes:
    - `- [ ] Task title`
    - `- [x] Completed task`
        
- The plugin embeds a hidden ID in the line:
    - `<!-- nc-task:UID -->`
        
- When tasks are updated on either side, the checkbox state and title update to match.

## Data Storage

Plugin data is stored in `data.json` inside the plugin folder. It contains:

- `settings`: the configuration values listed above (credentials stored encrypted).
- `state`: sync metadata including per-file hashes/ETags, conflict records, applied deletions, and task sync state.

Example (redacted):

```json
{
  "settings": {
    "nextcloudBaseUrl": "https://cloud.example.com",
    "username": "user",
    "appPassword": "enc:v1:...",
    "remoteRoot": "Notes",
    "debounceMs": 900,
    "includePatterns": "**/*.md",
    "excludePatterns": "",
    "syncOnModify": true,
    "syncOnFileClose": true,
    "checkRemoteOnOpen": true,
    "checkRemoteOnFocus": true,
    "focusCheckThrottleMs": 2000,
    "periodicRemoteCheckEnabled": false,
    "periodicRemoteCheckMinutes": 15,
    "promptRemoteDelete": true,
    "applyRemoteDeletions": true,
    "remoteDeletionsPath": ".sync-deletions.json",
    "enableTaskSync": true,
    "taskListUrl": "enc:v1:...",
    "caldavBaseUrl": "",
    "taskSyncOnFileSync": true,
    "enableChangelog": false,
    "changelogPath": "Sync Changelog.md",
    "enableDebug": false,
    "archiveConflictsOnResolve": true,
    "conflictArchiveFolder": "Sync Conflicts",
    "conflictArchiveRemoteFolder": ".sync-conflicts"
  },
  "state": {
    "files": {},
    "conflicts": {},
    "deletionsApplied": {},
    "tasks": {}
  }
}
```

Note: Defaults are defined in the plugin code. Your `data.json` reflects your current settings (which may differ from defaults).

## Troubleshooting

- Use **Show sync log** to view recent sync events (enable **Debug logging** first for detailed entries).
- Use **Show sync queue** to see pending sync tasks and what is currently syncing.
- If you see conflicts, run **Resolve conflict for current file** or **Show conflicts** to review all conflict copies.
- If remote changes are not detected, check **Check remote on open/focus** and the **Periodic remote check** interval.
- If tasks do not sync, verify **Task sync** is enabled and the **Task list URL** is set.

## Notes

- The WebDAV base URL is built as: `{nextcloudBase}/remote.php/dav/files/{username}/`.
- Conflicts create `filename (conflict YYYY-MM-DD HHmm).md` next to the original.
- Nextcloud server-side file versions are used automatically for remote history.
- Deletions use Nextcloud Trash and Obsidian Trash for rollback.
- Stored credentials and URLs are encrypted at rest and decrypted only in-app.
