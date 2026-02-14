import * as vscode from 'vscode';
import { ConfigManager } from './core/ConfigManager';
import { Watcher } from './core/Watcher';
import { StatusBar } from './ui/StatusBar';
import { registerCommands } from './ui/Commands';
import { WatcherState } from './types/state';
import { Logger } from './utils/Logger';
import { KEY_SELECTED_WORKSPACE } from './utils/constants';

let sessionDisposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext) {
  // Init Logger FIRST
  Logger.activate(context);
  Logger.info('Extension "Context Builder" is activating...');

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    Logger.warn('No workspace folder found. Extension disabled.');
    return;
  }

  const switchWorkspace = async () => {
    const selectedFolder = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Context Builder: Select workspace folder to monitor',
      ignoreFocusOut: true,
    });

    if (selectedFolder) {
      await startSession(selectedFolder.uri.fsPath);
    }
  };

  // Register globally to allow switching at any time
  context.subscriptions.push(vscode.commands.registerCommand('context-builder.switchWorkspace', switchWorkspace));

  const startSession = async (workspaceRoot: string) => {
    Logger.info(`Starting session for root: ${workspaceRoot}`);

    // Dispose previous session resources
    if (sessionDisposables.length > 0) {
      Logger.info('Disposing previous session resources...');
      sessionDisposables.forEach((d) => d.dispose());
      sessionDisposables = [];
    }

    // Persist selection
    await context.workspaceState.update(KEY_SELECTED_WORKSPACE, workspaceRoot);

    // Initialize Core Components
    // Pass workspaceState for Memento storage
    const configManager = new ConfigManager(workspaceRoot, context.workspaceState);
    const watcher = new Watcher(workspaceRoot, configManager);

    // Initialize UI
    const statusBar = new StatusBar();

    // Create a proxy context to capture subscriptions for this session
    // This ensures commands are disposed when the session changes
    const sessionContext = {
      ...context,
      subscriptions: sessionDisposables,
    } as vscode.ExtensionContext;

    // Initialize Commands
    registerCommands(sessionContext, watcher, configManager, workspaceRoot);

    // Add core components to session disposables
    sessionDisposables.push(configManager, watcher, statusBar);

    // Hook up Status Bar to Watcher events
    watcher.onStateChange((state) => {
      const profileName = watcher.currentProfile?.name;
      const stats = watcher.currentStats;
      statusBar.update(state, profileName, stats?.fileCount);
      Logger.info(`State changed: ${state}`);
    });

    watcher.onBuildFinished((stats) => {
      Logger.info(`Build finished: ${stats.fileCount} files, ${stats.tokenCount} tokens`);
      if (watcher.state === WatcherState.Watching) {
        const profileName = watcher.currentProfile?.name;
        statusBar.update(WatcherState.Watching, profileName, stats.fileCount);
      }
    });

    // Start watching for config changes.
    configManager.startWatching();
  };

  // Logic to determine initial root
  const savedRoot = context.workspaceState.get<string>(KEY_SELECTED_WORKSPACE);
  let initialRoot: string | undefined;

  if (savedRoot && workspaceFolders.some((f) => f.uri.fsPath === savedRoot)) {
    initialRoot = savedRoot;
  } else if (workspaceFolders.length === 1) {
    initialRoot = workspaceFolders[0].uri.fsPath;
  }

  if (initialRoot) {
    await startSession(initialRoot);
  } else {
    // If no saved root and multiple folders, prompt user
    await switchWorkspace();
  }
}

export function deactivate() {
  Logger.info('Extension deactivated.');
  sessionDisposables.forEach((d) => d.dispose());
}
