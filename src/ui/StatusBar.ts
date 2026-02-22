import * as vscode from 'vscode';
import { WatcherState } from '../types/state';

export class StatusBar implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'context-builder.showMenu';
    this.update(WatcherState.Idle);
    this.statusBarItem.show();
  }

  public setCommand(command: string): void {
    this.statusBarItem.command = command;
  }

  public update(state: WatcherState, profileName?: string, fileCount?: number, format?: string): void {
    switch (state) {
      case WatcherState.Idle:
        this.statusBarItem.text = '$(circle-slash) Context: Off';
        this.statusBarItem.tooltip = 'Context Builder is paused. Click to select profile.';
        break;

      case WatcherState.Watching:
        const countStr = fileCount !== undefined ? `${fileCount} files` : 'Ready';
        const formatStr = format ? ` [${format}]` : '';
        this.statusBarItem.text = `🟢 ${profileName}${formatStr} (${countStr})`;
        this.statusBarItem.tooltip = `Watching profile: ${profileName} | Format: ${format || 'markdown'}. Click for options.`;
        break;

      case WatcherState.Debouncing:
        this.statusBarItem.text = `🟡 ${profileName} (Waiting...)`;
        this.statusBarItem.tooltip = 'Waiting for file changes to settle...';
        break;

      case WatcherState.Building:
        this.statusBarItem.text = '$(loading~spin) Building...';
        this.statusBarItem.tooltip = 'Generating context file...';
        break;
    }
  }

  public showSelectWorkspace(): void {
    this.statusBarItem.text = '$(root-folder) Context: Select Workspace';
    this.statusBarItem.tooltip = 'Click to select a workspace folder to monitor';
    this.statusBarItem.command = 'context-builder.switchWorkspace';
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
