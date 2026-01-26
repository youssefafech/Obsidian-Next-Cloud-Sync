# Nextcloud Sync Suite (Obsidian)
Sync Markdown files from your vault to a self-hosted Nextcloud server over WebDAV, with optional two-way task sync via CalDAV.
## Features

- Debounced per-file syncing with a single queue to avoid rapid request floods.
- Scope control via include/exclude glob patterns (defaults to `**/*.md`).
- Manual commands: “Sync now (current file)” and “Sync all”.
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
    
## Tasks (Two-Way)
- Task lines are detected as Markdown checkboxes:
    - `- [ ] Task title`
    - `- [x] Completed task`
        
- The plugin embeds a hidden ID in the line:
    - `<!-- nc-task:UID -->`
        
- When tasks are updated on either side, the checkbox state and title update to match.

## Notes

- The WebDAV base URL is built as: `{nextcloudBase}/remote.php/dav/files/{username}/`.
- Conflicts create `filename (conflict YYYY-MM-DD HHmm).md` next to the original.
- Nextcloud server-side file versions are used automatically for remote history.
- Deletions use Nextcloud Trash and Obsidian Trash for rollback.
- Stored credentials and URLs are encrypted at rest and decrypted only in-app.
