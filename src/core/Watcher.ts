import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigManager } from './ConfigManager';
import { FileResolver } from './FileResolver';
import { ContextBuilder } from './ContextBuilder';
import { TokenCounter } from './TokenCounter';
import { WatcherState, BuildStats } from '../types/state';
import { Profile } from '../types/config';

export class Watcher implements vscode.Disposable {
  private _state: WatcherState = WatcherState.Idle;
  private activeProfile: Profile | null = null;
  private fsWatcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastStats: BuildStats | null = null;

  private readonly _onStateChange = new vscode.EventEmitter<WatcherState>();
  public readonly onStateChange = this._onStateChange.event;

  private readonly _onBuildFinished = new vscode.EventEmitter<BuildStats>();
  public readonly onBuildFinished = this._onBuildFinished.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly configManager: ConfigManager,
  ) {
    // Listen for config changes to auto-restart or stop
    this.configManager.onDidChangeConfig((config) => {
      if (!config) {
        // Config became invalid
        this.stop();
        vscode.window.showErrorMessage('Context Builder: Configuration is invalid. Watching stopped.');
        return;
      }

      // If we are running, restart to apply new settings (e.g. debounceMs or exclude patterns)
      if (this.state !== WatcherState.Idle && this.activeProfile) {
        // Try to keep the same profile active if it still exists
        const stillExists = config.profiles.find((p) => p.name === this.activeProfile?.name);
        if (stillExists) {
          this.start(stillExists.name);
        } else {
          this.stop();
          vscode.window.showWarningMessage(
            `Context Builder: Profile "${this.activeProfile.name}" no longer exists. Watching stopped.`,
          );
        }
      }
    });
  }

  public get state(): WatcherState {
    return this._state;
  }

  public get currentStats(): BuildStats | null {
    return this.lastStats;
  }

  public get currentProfile(): Profile | null {
    return this.activeProfile;
  }

  public async start(profileName: string): Promise<void> {
    const profile = this.configManager.getProfile(profileName);
    if (!profile) {
      vscode.window.showErrorMessage(`Profile "${profileName}" not found.`);
      return;
    }

    // Stop existing watcher if any
    this.stop();

    this.activeProfile = profile;
    this.setState(WatcherState.Watching);

    // Create a temporary resolver to get watch patterns correctly (DRY)
    const config = await this.configManager.load(); // Ensure we have latest settings
    const resolver = new FileResolver(this.workspaceRoot, profile, config.globalSettings);
    const patterns = resolver.getWatchPatterns();

    // Convert patterns array to VS Code GlobPattern: "{src/**/*,README.md}"
    const globPattern = patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;
    const relativePattern = new vscode.RelativePattern(this.workspaceRoot, globPattern);

    this.fsWatcher = vscode.workspace.createFileSystemWatcher(relativePattern);

    // Bind events
    const handler = (uri: vscode.Uri) => this.handleFileEvent(uri);
    this.fsWatcher.onDidChange(handler);
    this.fsWatcher.onDidCreate(handler);
    this.fsWatcher.onDidDelete(handler);

    // Initial build on start
    this.triggerBuild();
  }

  public stop(): void {
    if (this.fsWatcher) {
      this.fsWatcher.dispose();
      this.fsWatcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.activeProfile = null;
    this.setState(WatcherState.Idle);
  }

  public async buildOnce(profileName?: string): Promise<void> {
    const targetProfileName = profileName || this.activeProfile?.name;
    if (!targetProfileName) {
      vscode.window.showErrorMessage('No profile selected for build.');
      return;
    }

    // If not already watching, we need to load the profile temporarily
    if (!this.activeProfile || this.activeProfile.name !== targetProfileName) {
      const profile = this.configManager.getProfile(targetProfileName);
      if (!profile) return;
      this.activeProfile = profile;
    }

    await this.triggerBuild();

    // If we weren't watching, reset activeProfile
    if (this.state === WatcherState.Idle) {
      this.activeProfile = null;
    }
  }

  public dispose(): void {
    this.stop();
    this._onStateChange.dispose();
    this._onBuildFinished.dispose();
  }

  private setState(newState: WatcherState) {
    if (this._state !== newState) {
      this._state = newState;
      this._onStateChange.fire(newState);
    }
  }

  private handleFileEvent(uri: vscode.Uri): void {
    if (!this.activeProfile) return;

    // Safety: Prevent recursion by ignoring the output file
    const absoluteOutput = path.join(this.workspaceRoot, this.activeProfile.outputFile);
    if (uri.fsPath === absoluteOutput) {
      return;
    }

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.setState(WatcherState.Debouncing);

    this.configManager.load().then((cfg) => {
      const delay = cfg.globalSettings.debounceMs;
      this.debounceTimer = setTimeout(() => {
        this.triggerBuild();
      }, delay);
    });
  }

  private async triggerBuild(): Promise<void> {
    if (!this.activeProfile) return;

    this.setState(WatcherState.Building);

    try {
      const config = await this.configManager.load();
      const resolver = new FileResolver(this.workspaceRoot, this.activeProfile, config.globalSettings);
      const files = await resolver.resolve();

      const tokenCounter = new TokenCounter(config.globalSettings.tokenizerModel);
      const builder = new ContextBuilder(this.workspaceRoot, this.activeProfile, files, tokenCounter);

      const stats = await builder.build();
      this.lastStats = stats;
      this._onBuildFinished.fire(stats);

      console.log(`[Context Builder] Build complete: ${stats.fileCount} files, ${stats.tokenCount} tokens`);
    } catch (error) {
      vscode.window.showErrorMessage(`Context Build Failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(error);
    } finally {
      // Return to Watching state if we are still initialized (not stopped during build)
      if (this.fsWatcher) {
        this.setState(WatcherState.Watching);
      } else {
        this.setState(WatcherState.Idle);
      }
    }
  }
}
