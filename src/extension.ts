import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TahciaClient } from './tahciaClient';

interface TahciaConfig {
    api_key?: string;
    uploadOnSave?: number;
}

/**
 * Recursively scans upward from a starting directory to find 'tahcia-config.json'.
 * This fixes subfolder tracking issues.
 */
function findConfigUpwards(startDir: string): { dir: string | null; config: TahciaConfig } {
    let currentDir = path.resolve(startDir);
    
    while (true) {
        const configPath = path.join(currentDir, 'tahcia-config.json');
        if (fs.existsSync(configPath)) {
            try {
                const raw = fs.readFileSync(configPath, 'utf8');
                const data = JSON.parse(raw);
                if (data && typeof data === 'object' && 'api_key' in data) {
                    return { dir: currentDir, config: data };
                }
            } catch {
                // Keep moving if file is locked or corrupt
            }
        }
        
        const parentDir = path.dirname(currentDir);
        // Break if we hit the root directory
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }
    return { dir: null, config: {} };
}

async function getTahciaConfigRoots(): Promise<Set<string>> {
    const roots = new Set<string>();
    if (!vscode.workspace.workspaceFolders) {
        return roots;
    }

    try {
        const configUris = await vscode.workspace.findFiles('**/tahcia-config.json', '**/node_modules/**', 50);
        for (const uri of configUris) {
            if (uri.scheme === 'file') {
                roots.add(path.dirname(uri.fsPath));
            }
        }
    } catch {
        // ignore
    }

    return roots;
}

function collectTahciaSubdirectories(root: string, out: Set<string>) {
    if (out.has(root)) {
        return;
    }
    out.add(root);

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const child = path.join(root, entry.name);
            collectTahciaSubdirectories(child, out);
        }
    }
}

async function refreshTahciaContextKeys() {
    const roots = await getTahciaConfigRoots();
    const supportedDirs = new Set<string>();
    const configDirsContext: Record<string, boolean> = {};
    const supportedDirsContext: Record<string, boolean> = {};
    const supportedPathsContext: Record<string, boolean> = {};

    for (const root of roots) {
        configDirsContext[root] = true;
        collectTahciaSubdirectories(root, supportedDirs);
    }

    for (const dir of supportedDirs) {
        supportedDirsContext[dir] = true;
    }

    try {
        const fileUris = await vscode.workspace.findFiles('**/*.tahcia.json', '**/node_modules/**', 2000);
        for (const uri of fileUris) {
            if (uri.scheme !== 'file') {
                continue;
            }
            const filePath = uri.fsPath;
            for (const dir of supportedDirs) {
                if (filePath.startsWith(dir + path.sep) || filePath === dir) {
                    supportedPathsContext[filePath] = true;
                    break;
                }
            }
        }
    } catch {
        // ignore
    }

    await vscode.commands.executeCommand('setContext', 'tahcia.configDirs', configDirsContext);
    await vscode.commands.executeCommand('setContext', 'tahcia.supportedDirs', supportedDirsContext);
    await vscode.commands.executeCommand('setContext', 'tahcia.supportedPaths', supportedPathsContext);
}

/**
 * Searches the project workspace for a valid 'tahcia-config.json'.
 * Simulates your precise Sublime multi-tier path scanner, enhanced for recursive subfolders.
 */
function getTahciaConfig(fallbackPath?: string): { dir: string | null; config: TahciaConfig } {
    // 0. High priority target via explicit workspace interactions (recursive check)
    if (fallbackPath) {
        if (fs.existsSync(fallbackPath)) {
            const stat = fs.statSync(fallbackPath);
            const startDir = stat.isDirectory() ? fallbackPath : path.dirname(fallbackPath);
            const result = findConfigUpwards(startDir);
            if (result.dir) { return result; }
        }
    }

    // 1. Fallback check relative to the focused document editor (recursive check)
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && !activeEditor.document.isUntitled) {
        const startDir = path.dirname(activeEditor.document.uri.fsPath);
        const result = findConfigUpwards(startDir);
        if (result.dir) { return result; }
    }

    // 2. Scan standard multi-root workspace folders
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const result = findConfigUpwards(folder.uri.fsPath);
            if (result.dir) { return result; }
        }
    }

    return { dir: null, config: {} };
}

export function activate(context: vscode.ExtensionContext) {
    const skipAutoUploadOnSave = new Set<string>();

    void refreshTahciaContextKeys();
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshTahciaContextKeys()),
        vscode.workspace.onDidCreateFiles(() => void refreshTahciaContextKeys()),
        vscode.workspace.onDidDeleteFiles(() => void refreshTahciaContextKeys()),
        vscode.workspace.onDidRenameFiles(() => void refreshTahciaContextKeys())
    );

    // --- 1. INITIALIZE COMMAND (tahcia.init) ---
    let initCmd = vscode.commands.registerCommand('tahcia.init', async (uri?: vscode.Uri) => {
        let targetDir: string | null = null;

        if (uri && uri.fsPath) {
            const stat = fs.statSync(uri.fsPath);
            targetDir = stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
        } else if (vscode.window.activeTextEditor && !vscode.window.activeTextEditor.document.isUntitled) {
            targetDir = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            targetDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        if (!targetDir) {
            vscode.window.showErrorMessage("Tahcia: Cannot determine target folder. Open a folder or file first.");
            return;
        }

        const configPath = path.join(targetDir, 'tahcia-config.json');
        const defaultConfig = {
            "api_key": "PASTE_YOUR_TAHCIA_API_KEY_HERE",
            "uploadOnSave": 1
        };

        try {
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4), 'utf8');
            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Tahcia: Created 'tahcia-config.json' in ${path.basename(targetDir)}`);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Tahcia: Failed to write config file. Details: ${e.message}`);
        }
    });

    // --- 2. UPLOAD COMMAND (tahcia.upload) ---
    let uploadCmd = vscode.commands.registerCommand('tahcia.upload', async (uri?: vscode.Uri) => {
        const clickedPath = uri?.fsPath;
        const { dir: tahciaDir, config } = getTahciaConfig(clickedPath);
        const apiKey = config.api_key?.trim();

        if (!apiKey || !tahciaDir) {
            vscode.window.showErrorMessage("Tahcia: 'tahcia-config.json' was not found. Please run 'Use Tahcia Here' first.");
            return;
        }

        let filename: string | null = null;
        let code = '';

        const activeEditor = vscode.window.activeTextEditor;
        if (clickedPath && fs.statSync(clickedPath).isFile()) {
            filename = clickedPath;
        } else if (activeEditor && !activeEditor.document.isUntitled) {
            filename = activeEditor.document.uri.fsPath;
        }

        if (!filename) {
            vscode.window.showErrorMessage("Tahcia: Current view must be saved to disk before uploading.");
            return;
        }

        const basename = path.basename(filename);
        if (!basename.endsWith('.tahcia.json')) {
            vscode.window.showErrorMessage("Tahcia: Filename must end with '.tahcia.json' to be uploaded.");
            return;
        }

        if (activeEditor && activeEditor.document.uri.fsPath === filename) {
            code = activeEditor.document.getText();
        } else {
            try {
                code = fs.readFileSync(filename, 'utf8');
            } catch (e: any) {
                vscode.window.showErrorMessage(`Tahcia: Failed to read file context: ${e.message}`);
                return;
            }
        }

        try {
            JSON.parse(code);
        } catch (jsonErr: any) {
            vscode.window.showErrorMessage(`Tahcia: Invalid JSON detected! Upload aborted to protect remote instance.\nDetails: ${jsonErr.message}`);
            return;
        }

        const client = new TahciaClient(apiKey);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${basename}...`,
            cancellable: false
        }, async () => {
            try {
                const res = await client.uploadScript(basename, code);
                vscode.window.showInformationMessage(`Tahcia: Successfully uploaded '${basename}'!`);
                
                if (res && res.name) {
                    let serverName = res.name;
                    if (!serverName.endsWith('.tahcia.json')) {
                        serverName += '.tahcia.json';
                    }
                    if (serverName !== basename && filename) {
                        const directory = path.dirname(filename);
                        const newFilePath = path.join(directory, serverName);
                        
                        if (fs.existsSync(newFilePath)) {
                            fs.unlinkSync(newFilePath);
                        }
                        fs.renameSync(filename, newFilePath);
                        
                        const doc = await vscode.workspace.openTextDocument(newFilePath);
                        await vscode.window.showTextDocument(doc);
                        vscode.window.showInformationMessage(`Tahcia: Updated local filename to '${serverName}'`);
                    }
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Tahcia Error: ${err.message}`);
            }
        });
    });

    // --- 3. STANDALONE DOWNLOAD ONE-CLICK COMMAND (tahcia.download) ---
    let downloadCmd = vscode.commands.registerCommand('tahcia.download', async (uri?: vscode.Uri) => {
        const clickedPath = uri?.fsPath;
        const { dir: tahciaDir, config } = getTahciaConfig(clickedPath);
        const apiKey = config.api_key?.trim();

        if (!apiKey || !tahciaDir) {
            vscode.window.showErrorMessage("Tahcia: 'tahcia-config.json' was not found.");
            return;
        }

        let filename: string | null = null;
        const activeEditor = vscode.window.activeTextEditor;
        
        if (clickedPath && fs.statSync(clickedPath).isFile()) {
            filename = clickedPath;
        } else if (activeEditor && !activeEditor.document.isUntitled) {
            filename = activeEditor.document.uri.fsPath;
        }

        if (!filename) {
            vscode.window.showErrorMessage("Tahcia: Could not identify target file for download sync.");
            return;
        }

        const basename = path.basename(filename);
        if (!basename.endsWith('.tahcia.json')) {
            vscode.window.showErrorMessage("Tahcia: Filename must end with '.tahcia.json' to pull from remote instance.");
            return;
        }

        const client = new TahciaClient(apiKey);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${basename}...`,
            cancellable: false
        }, async () => {
            try {
                const content = await client.downloadScript(basename);
                fs.writeFileSync(filename!, content, 'utf8');

                const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filename);
                if (openDoc) {
                    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filename)
                        ?? await vscode.window.showTextDocument(openDoc, { preview: false });

                    if (openDoc.isDirty) {
                        await vscode.commands.executeCommand('workbench.action.files.revert');
                    }

                    const fullRange = new vscode.Range(
                        editor.document.positionAt(0),
                        editor.document.positionAt(editor.document.getText().length)
                    );

                    await editor.edit(editBuilder => {
                        editBuilder.replace(fullRange, content);
                    });

                    skipAutoUploadOnSave.add(filename);
                    try {
                        await editor.document.save();
                    } finally {
                        skipAutoUploadOnSave.delete(filename);
                    }
                }

                vscode.window.setStatusBarMessage(`Tahcia: Downloaded and synchronized ${basename}`, 4000);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Tahcia Error: ${err.message}`);
            }
        });
    });

    // --- 4. BROWSE / DOWNLOAD / DELETE CENTRAL COMMAND (tahcia.browse) ---
    let browseCmd = vscode.commands.registerCommand('tahcia.browse', async () => {
        const { dir: tahciaDir, config } = getTahciaConfig();
        const apiKey = config.api_key?.trim();

        if (!apiKey || !tahciaDir) {
            vscode.window.showErrorMessage("Tahcia: 'tahcia-config.json' was not found. Configure your local workspace environment first.");
            return;
        }

        const client = new TahciaClient(apiKey);
        let scripts: string[] = [];
        let fetchFailed = false;
        let errorMessage = '';

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching remote scripts list...",
            cancellable: false
        }, async () => {
            try {
                scripts = await client.listScripts();
            } catch (err: any) {
                fetchFailed = true;
                errorMessage = err.message || String(err);
            }
        });

        if (fetchFailed) {
            vscode.window.showErrorMessage(`Tahcia Connection Error: ${errorMessage}`);
            return;
        }

        if (scripts.length === 0) {
            vscode.window.showInformationMessage("Tahcia: No remote scripts found.");
            return;
        }

        const selectedScript = await vscode.window.showQuickPick(scripts, {
            placeHolder: 'Select a script to manage'
        });

        if (!selectedScript) { return; }

        const actions = [
            "Download and Open Script",
            "Delete Script",
            "Cancel"
        ];

        const selectedAction = await vscode.window.showQuickPick(actions, {
            placeHolder: `Action for ${selectedScript}`
        });

        if (!selectedAction || selectedAction === "Cancel") { return; }

        if (selectedAction === "Download and Open Script") {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Downloading ${selectedScript}...`,
                cancellable: false
            }, async () => {
                try {
                    const content = await client.downloadScript(selectedScript);
                    const filepath = path.join(tahciaDir, selectedScript);
                    fs.writeFileSync(filepath, content, 'utf8');
                    const doc = await vscode.workspace.openTextDocument(filepath);
                    await vscode.window.showTextDocument(doc);
                    vscode.window.setStatusBarMessage(`Tahcia: Downloaded and opened ${selectedScript}`, 4000);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Tahcia Error: ${err.message}`);
                }
            });
        } else if (selectedAction === "Delete Script") {
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to permanently delete '${selectedScript}' from the Tahcia server?`,
                { modal: true },
                "Delete"
            );

            if (confirm === "Delete") {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Deleting ${selectedScript}...`,
                    cancellable: false
                }, async () => {
                    try {
                        await client.deleteScript(selectedScript);
                        vscode.window.showInformationMessage(`Tahcia: Successfully deleted '${selectedScript}' from the server.`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Tahcia Error: ${err.message}`);
                    }
                });
            }
        }
    });

    // --- 5. AUTOMATED SAVE HOOK EVENT LISTENER ---
    let saveListener = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        const filename = document.uri.fsPath;
        const basename = path.basename(filename);

        if (basename.endsWith('.tahcia.json')) {
            if (skipAutoUploadOnSave.has(filename)) {
                skipAutoUploadOnSave.delete(filename);
                return;
            }

            const { dir: tahciaDir, config } = getTahciaConfig(filename);
            if (!tahciaDir || !config) { return; }

            const uploadOnSave = config.uploadOnSave !== undefined ? config.uploadOnSave : 1;
            if (uploadOnSave === 0) { return; }

            const realFilename = fs.realpathSync(filename);
            const realTahciaDir = fs.realpathSync(tahciaDir);

            if (realFilename.startsWith(realTahciaDir)) {
                vscode.commands.executeCommand('tahcia.upload', document.uri);
            }
        }
    });

    context.subscriptions.push(initCmd, uploadCmd, downloadCmd, browseCmd, saveListener);
}

export function deactivate() {}