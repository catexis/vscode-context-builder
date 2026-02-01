import * as vscode from 'vscode';
import { ConfigManager } from './core/ConfigManager';
import { Watcher } from './core/Watcher';
import { StatusBar } from './ui/StatusBar';
import { registerCommands } from './ui/Commands';
import { WatcherState } from './types/state';
import { Logger } from './utils/Logger';

export async function activate(context: vscode.ExtensionContext) {
  // 1. Init Logger FIRST
  Logger.activate(context);
  Logger.info('Extension "Context Builder" is activating...');

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    Logger.warn('No workspace folder found. Extension disabled.');
    return;
  }

  let workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Multi-root Workspace Support
  if (workspaceFolders.length > 1) {
    const selectedFolder = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Context Builder: Select workspace folder to monitor',
      ignoreFocusOut: true,
    });

    if (!selectedFolder) {
      Logger.warn('Workspace folder selection cancelled. Extension disabled.');
      return;
    }

    workspaceRoot = selectedFolder.uri.fsPath;
  }

  Logger.info(`Selected workspace root: ${workspaceRoot}`);

  // Initialize Core Components
  const configManager = new ConfigManager(workspaceRoot);
  const watcher = new Watcher(workspaceRoot, configManager);

  // Initialize UI
  const statusBar = new StatusBar();

  // Initialize Commands
  registerCommands(context, watcher, configManager, workspaceRoot);

  // Auto-start watching for config changes
  configManager.startWatching();

  // Add disposables to context
  context.subscriptions.push(configManager, watcher, statusBar);

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

  // Explicit Initialization
  // We explicitly check for config existence to ensure the watcher starts
  // even if the file watcher event is delayed or missed during startup.
  if (await configManager.exists()) {
    try {
      const config = await configManager.load();
      // Only start if not already started by the event listener (race condition protection)
      if (watcher.state === WatcherState.Idle && config.activeProfile) {
        Logger.info('Triggering explicit start from existing config');
        await watcher.start(config.activeProfile);
      }
    } catch (error) {
      Logger.error('Initial config load failed', error);
      // Optional: Show output channel on critical init failure
      // Logger.show();
    }
  }
}

export function deactivate() {
  Logger.info('Extension deactivated.');
}
