import * as vscode from 'vscode';
import { ConfigManager } from './core/ConfigManager';
import { Watcher } from './core/Watcher';
import { registerCommands } from './ui/Commands';

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return; // Context Builder works only in workspace/folder mode
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Initialize Core Components
  const configManager = new ConfigManager(workspaceRoot);
  const watcher = new Watcher(workspaceRoot, configManager);

  // Initialize UI & Commands
  registerCommands(context, watcher, configManager);

  // Auto-start watching for config changes
  configManager.startWatching();

  // Add disposables to context
  context.subscriptions.push(configManager, watcher);

  // Log status (replace with StatusBar later)
  watcher.onStateChange((state) => {
    console.log(`[Context Builder] State changed: ${state}`);
  });
}

export function deactivate() {}
