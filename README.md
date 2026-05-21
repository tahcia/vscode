# Tahcia Script Sync

Tahcia is a lightweight, efficient Visual Studio Code extension designed for full-stack developers and automation engineers to seamlessly download, manage, and synchronize JSON automation scripts directly with your remote execution server environment. 

## Features

*   **Workspace Initialization**: One-click generation of local project staging environments.
*   **Upward Configuration Scanning**: Automatically detects configuration profiles across multi-tier directory layouts and deep subfolders.
*   **Safe Sync Upload Pipeline**: Runs an immediate validation parse to ensure your JSON data structures are structurally intact before transmitting, preventing broken remote code deployment.
*   **Active Editor Force-Refresh**: Manually downloading a remote script drops dirty memory states and instantly replaces active text buffers line-by-line.
*   **Automated Background Uploads**: Keeps code completely synchronized on standard file saves (`Cmd+S` / `Ctrl+S`) when running within an active staging environment.
*   **Remote Server Explorer**: Fast, interactive UI QuickPick drops down to browse, pull down, or permanently drop remote server files.

---

## Installation

To pack and install this extension locally:

1. Compile the production package:
   
```bash
   npm run package