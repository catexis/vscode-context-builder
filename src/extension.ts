import * as vscode from 'vscode';
import { ConfigManager } from './core/ConfigManager';
import { Watcher } from './core/Watcher';
import { StatusBar } from './ui/StatusBar';
import { registerCommands } from './ui/Commands';
import { WatcherState } from './types/state';

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return; // Context Builder works only in workspace/folder mode
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Initialize Core Components
  const configManager = new ConfigManager(workspaceRoot);
  const watcher = new Watcher(workspaceRoot, configManager);

  // Initialize UI
  const statusBar = new StatusBar();

  // Initialize Commands
  registerCommands(context, watcher, configManager, workspaceRoot);

  // Auto-start watching for config changes
  // This usually triggers an initial load event via reload()
  configManager.startWatching();

  // Add disposables to context
  context.subscriptions.push(configManager, watcher, statusBar);

  // Hook up Status Bar to Watcher events
  watcher.onStateChange((state) => {
    const profileName = watcher.currentProfile?.name;
    const stats = watcher.currentStats;
    statusBar.update(state, profileName, stats?.fileCount);
  });

  watcher.onBuildFinished((stats) => {
    if (watcher.state === WatcherState.Watching) {
      const profileName = watcher.currentProfile?.name;
      statusBar.update(WatcherState.Watching, profileName, stats.fileCount);
    }
  });

  // Explicit Initialization (Review Fix)
  // We explicitly check for config existence to ensure the watcher starts
  // even if the file watcher event is delayed or missed during startup.
  if (await configManager.exists()) {
    try {
      const config = await configManager.load();
      // Only start if not already started by the event listener (race condition protection)
      if (watcher.state === WatcherState.Idle && config.activeProfile) {
        console.log('Context Builder: Explicit start triggered');
        await watcher.start(config.activeProfile);
      }
    } catch (error) {
      console.error('Context Builder: Initial config load failed', error);
    }
  }
}

export function deactivate() {}
