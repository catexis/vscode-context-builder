import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import ignore, { Ignore } from 'ignore';
import { ConfigManager } from './ConfigManager';
import { FileResolver } from './FileResolver';
import { ContextBuilder } from './ContextBuilder';
import { TokenCounter } from './TokenCounter';
import { WatcherState, BuildStats } from '../types/state';
import { Profile } from '../types/config';
import { Logger } from '../utils/Logger';

export class Watcher implements vscode.Disposable {
  private _state: WatcherState = WatcherState.Idle;
  private activeProfile: Profile | null = null;

  private fsWatchers: vscode.FileSystemWatcher[] = [];
  private gitIgnoreWatcher: vscode.FileSystemWatcher | null = null;

  private debounceTimer: NodeJS.Timeout | null = null;
  private lastStats: BuildStats | null = null;

  private isBuilding = false;
  private buildPending = false;

  private tokenCounter: TokenCounter | null = null;
  private gitIgnoreParser: Ignore | null = null;

  private readonly _onStateChange = new vscode.EventEmitter<WatcherState>();
  public readonly onStateChange = this._onStateChange.event;

  private readonly _onBuildFinished = new vscode.EventEmitter<BuildStats>();
  public readonly onBuildFinished = this._onBuildFinished.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly configManager: ConfigManager,
  ) {
    this.configManager.onDidChangeConfig((config) => {
      if (!config) {
        this.stop();
        vscode.window.showErrorMessage('Context Builder: Configuration is invalid. Watching stopped.');
        return;
      }

      if (this.state !== WatcherState.Idle && this.activeProfile) {
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

      if (this.state === WatcherState.Idle && config.activeProfile) {
        const profile = config.profiles.find((p) => p.name === config.activeProfile);
        if (profile) {
          this.start(config.activeProfile);
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
    Logger.info(`Starting watcher for profile: "${profileName}"`);
    const config = await this.configManager.load();
    const profile = this.configManager.getProfile(profileName);

    if (!profile) {
      vscode.window.showErrorMessage(`Profile "${profileName}" not found.`);
      return;
    }

    this.stop(); // Clean previous state

    this.activeProfile = profile;

    this.tokenCounter = new TokenCounter(config.globalSettings.tokenizerModel);

    if (profile.options.useGitIgnore) {
      await this.loadGitIgnore();
      this.startGitIgnoreWatcher();
    }

    this.setState(WatcherState.Watching);

    const resolver = new FileResolver(this.workspaceRoot, profile, config.globalSettings, this.gitIgnoreParser);
    const patterns = resolver.getWatchPatterns();

    this.fsWatchers = patterns.map((pattern) => {
      const relativePattern = new vscode.RelativePattern(this.workspaceRoot, pattern);
      const watcher = vscode.workspace.createFileSystemWatcher(relativePattern);

      const handler = (uri: vscode.Uri) => this.handleFileEvent(uri);
      watcher.onDidChange(handler);
      watcher.onDidCreate(handler);
      watcher.onDidDelete(handler);

      return watcher;
    });

    Logger.info(`Watchers started for ${patterns.length} patterns.`);

    // Initial build
    this.triggerBuild();
  }

  public stop(): void {
    if (this.state !== WatcherState.Idle) {
      Logger.info('Stopping watcher...');
    }

    this.fsWatchers.forEach((w) => w.dispose());
    this.fsWatchers = [];

    this.gitIgnoreWatcher?.dispose();
    this.gitIgnoreWatcher = null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.activeProfile = null;
    this.tokenCounter = null;
    this.gitIgnoreParser = null;

    this.isBuilding = false;
    this.buildPending = false;

    this.setState(WatcherState.Idle);
  }

  public async buildOnce(profileName?: string): Promise<void> {
    const targetProfileName = profileName || this.activeProfile?.name;
    if (!targetProfileName) {
      vscode.window.showErrorMessage('No profile selected for build.');
      return;
    }

    const wasIdle = this.state === WatcherState.Idle;

    if (wasIdle || this.activeProfile?.name !== targetProfileName) {
      const config = await this.configManager.load();
      const profile = this.configManager.getProfile(targetProfileName);
      if (!profile) return;

      this.activeProfile = profile;
      this.tokenCounter = new TokenCounter(config.globalSettings.tokenizerModel);
      if (profile.options.useGitIgnore) {
        await this.loadGitIgnore();
      }
    }

    await this.triggerBuild();

    if (wasIdle) {
      this.activeProfile = null;
      this.tokenCounter = null;
      this.gitIgnoreParser = null;
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

  private async loadGitIgnore(): Promise<void> {
    const gitIgnorePath = path.join(this.workspaceRoot, '.gitignore');
    try {
      const content = await fs.readFile(gitIgnorePath, 'utf-8');
      this.gitIgnoreParser = ignore().add(content);
    } catch {
      this.gitIgnoreParser = null;
    }
  }

  private startGitIgnoreWatcher() {
    const pattern = new vscode.RelativePattern(this.workspaceRoot, '.gitignore');
    this.gitIgnoreWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      await this.loadGitIgnore();
      this.handleFileEvent(vscode.Uri.file(path.join(this.workspaceRoot, '.gitignore')));
    };

    this.gitIgnoreWatcher.onDidChange(reload);
    this.gitIgnoreWatcher.onDidCreate(reload);
    this.gitIgnoreWatcher.onDidDelete(() => {
      this.gitIgnoreParser = null;
      this.handleFileEvent(vscode.Uri.file(path.join(this.workspaceRoot, '.gitignore')));
    });
  }

  private handleFileEvent(uri: vscode.Uri): void {
    if (!this.activeProfile) return;

    const absoluteOutput = path.normalize(path.join(this.workspaceRoot, this.activeProfile.outputFile));
    const currentPath = path.normalize(uri.fsPath);

    if (currentPath === absoluteOutput) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.setState(WatcherState.Debouncing);

    const delay = this.configManager.getDebounceMs();

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.triggerBuild();
    }, delay);
  }

  private async triggerBuild(): Promise<void> {
    if (this.isBuilding) {
      this.buildPending = true;
      return;
    }

    if (!this.activeProfile || !this.tokenCounter) return;

    this.isBuilding = true;
    this.setState(WatcherState.Building);

    try {
      const config = await this.configManager.load();

      const resolver = new FileResolver(
        this.workspaceRoot,
        this.activeProfile,
        config.globalSettings,
        this.gitIgnoreParser,
      );

      const files = await resolver.resolve();
      Logger.info(`Resolved ${files.length} files. Starting assembly...`);

      const builder = new ContextBuilder(this.workspaceRoot, this.activeProfile, files, this.tokenCounter);

      const stats = await builder.build();
      this.lastStats = stats;
      this._onBuildFinished.fire(stats);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Context Build Failed: ${msg}`);
      Logger.error('Build process failed', error, true);
    } finally {
      this.isBuilding = false;

      if (this.buildPending) {
        this.buildPending = false;
        setTimeout(() => this.triggerBuild(), 100);
      } else {
        if (this.fsWatchers.length > 0) {
          this.setState(WatcherState.Watching);
        } else {
          this.setState(WatcherState.Idle);
        }
      }
    }
  }
}
