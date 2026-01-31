import * as vscode from 'vscode';
import { ConfigManager } from './core/ConfigManager';
import { Watcher } from './core/Watcher';
import { StatusBar } from './ui/StatusBar';
import { registerCommands } from './ui/Commands';
import { WatcherState } from './types/state';

export function activate(context: vscode.ExtensionContext) {
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
    // Update status bar with new stats if we are back in Watching state
    if (watcher.state === WatcherState.Watching) {
      const profileName = watcher.currentProfile?.name;
      statusBar.update(WatcherState.Watching, profileName, stats.fileCount);
    }
  });
}

export function deactivate() {}
