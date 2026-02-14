import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { modify, applyEdits } from 'jsonc-parser';
import { ContextConfig, FileConfig, Profile, ProfileOptions } from '../types/config';
import {
  CONFIG_PATH,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_FILE_SIZE_KB,
  DEFAULT_MAX_TOTAL_FILES,
  KEY_ACTIVE_PROFILE,
  KEY_WATCHER_ENABLED,
} from '../utils/constants';
import { Logger } from '../utils/Logger';

export class ConfigManager implements vscode.Disposable {
  private configWatcher: vscode.FileSystemWatcher | null = null;
  private readonly _onConfigChanged = new vscode.EventEmitter<ContextConfig | null>();
  public readonly onDidChangeConfig = this._onConfigChanged.event;

  private currentConfig: ContextConfig | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly memento: vscode.Memento,
  ) {}

  public getConfigPath(): string {
    return path.join(this.workspaceRoot, CONFIG_PATH);
  }

  public async exists(): Promise<boolean> {
    try {
      await fs.access(this.getConfigPath());
      return true;
    } catch {
      return false;
    }
  }

  public async load(): Promise<ContextConfig> {
    const configPath = this.getConfigPath();
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const parsedFileConfig = JSON.parse(content);

      if (!this.validateFileConfig(parsedFileConfig)) {
        throw new Error('Invalid configuration structure');
      }

      // Merge file config with Memento state
      const activeProfileName = this.memento.get<string>(KEY_ACTIVE_PROFILE);
      const watcherEnabled = this.memento.get<boolean>(KEY_WATCHER_ENABLED, false);

      // Resolve active profile
      let finalActiveProfile = activeProfileName;
      if (!finalActiveProfile || !parsedFileConfig.profiles.find((p: Profile) => p.name === finalActiveProfile)) {
        if (parsedFileConfig.profiles.length > 0) {
          finalActiveProfile = parsedFileConfig.profiles[0].name;
        } else {
          finalActiveProfile = '';
        }
        // Update memento if we fell back to default
        if (finalActiveProfile) {
          await this.memento.update(KEY_ACTIVE_PROFILE, finalActiveProfile);
        }
      }

      const fullConfig: ContextConfig = {
        ...parsedFileConfig,
        activeProfile: finalActiveProfile,
        watcherEnabled: watcherEnabled,
      };

      this.currentConfig = fullConfig;
      return fullConfig;
    } catch (error) {
      this.currentConfig = null;
      throw error;
    }
  }

  public getProfile(name: string): Profile | undefined {
    return this.currentConfig?.profiles.find((p) => p.name === name);
  }

  public getActiveProfile(): Profile | undefined {
    if (!this.currentConfig) return undefined;
    return this.getProfile(this.currentConfig.activeProfile);
  }

  public async createDefault(): Promise<void> {
    // We only write FileConfig to disk
    const defaultConfig: FileConfig = {
      globalSettings: {
        debounceMs: DEFAULT_DEBOUNCE_MS,
        maxFileSizeKB: DEFAULT_MAX_FILE_SIZE_KB,
        maxTotalFiles: DEFAULT_MAX_TOTAL_FILES,
        tokenizerModel: 'gpt-4o',
      },
      profiles: [
        {
          name: 'default',
          description: 'Default context profile',
          outputFile: '.context/context.md',
          include: ['src/**/*.{ts,js,py,md}', 'package.json', 'README.md'],
          exclude: ['**/*.test.ts'],
          forceInclude: [],
          options: {
            useGitIgnore: true,
            removeComments: false,
            showTokenCount: true,
            showFileTree: true,
            preamble: 'Project context for LLM.',
          },
        },
      ],
    };

    const configPath = this.getConfigPath();
    const configDir = path.dirname(configPath);

    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');

    // Reset state
    await this.memento.update(KEY_ACTIVE_PROFILE, 'default');
    await this.memento.update(KEY_WATCHER_ENABLED, false);
  }

  public startWatching(): void {
    if (this.configWatcher) {
      return;
    }

    Logger.info('Starting config watcher...');

    const pattern = new vscode.RelativePattern(this.workspaceRoot, CONFIG_PATH);
    this.configWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      try {
        Logger.info('Config file changed/created. Reloading...');
        const config = await this.load();
        this._onConfigChanged.fire(config);
        Logger.info(`Config loaded. Active profile: ${config.activeProfile}`);
      } catch (error) {
        this._onConfigChanged.fire(null);
        Logger.error('Config reload failed', error);

        const message = error instanceof Error ? error.message : String(error);
        const action = await vscode.window.showErrorMessage('Invalid config: ' + message, { title: 'Open Config' });

        if (action?.title === 'Open Config') {
          try {
            const doc = await vscode.workspace.openTextDocument(this.getConfigPath());
            await vscode.window.showTextDocument(doc);
          } catch (e) {
            Logger.error('Failed to open config file', e);
          }
        }
      }
    };

    this.configWatcher.onDidChange(reload);
    this.configWatcher.onDidCreate(reload);
    this.configWatcher.onDidDelete(() => {
      this.currentConfig = null;
      this._onConfigChanged.fire(null);
    });

    // Initial load attempt
    reload();
  }

  public dispose(): void {
    this.configWatcher?.dispose();
    this._onConfigChanged.dispose();
  }

  public getDebounceMs(): number {
    return this.currentConfig?.globalSettings.debounceMs || DEFAULT_DEBOUNCE_MS;
  }

  public async updateActiveProfile(profileName: string): Promise<void> {
    if (this.currentConfig && this.currentConfig.activeProfile === profileName) return;

    // Update Memento
    await this.memento.update(KEY_ACTIVE_PROFILE, profileName);
    Logger.info(`Updated activeProfile to "${profileName}" in Memento.`);

    // Refresh internal state and notify listeners
    if (this.currentConfig) {
      this.currentConfig.activeProfile = profileName;
      this._onConfigChanged.fire(this.currentConfig);
    } else {
      // If config wasn't loaded, try loading it now
      try {
        const config = await this.load();
        this._onConfigChanged.fire(config);
      } catch (e) {
        // Ignore load error here
      }
    }
  }

  public async setWatcherEnabled(enabled: boolean): Promise<void> {
    if (this.currentConfig && this.currentConfig.watcherEnabled === enabled) return;

    await this.memento.update(KEY_WATCHER_ENABLED, enabled);
    Logger.info(`Updated watcherEnabled to "${enabled}" in Memento.`);

    if (this.currentConfig) {
      this.currentConfig.watcherEnabled = enabled;
      this._onConfigChanged.fire(this.currentConfig);
    } else {
      try {
        const config = await this.load();
        this._onConfigChanged.fire(config);
      } catch (e) {}
    }
  }

  public async addProfile(profileName: string): Promise<void> {
    const configPath = this.getConfigPath();
    const content = await fs.readFile(configPath, 'utf-8');

    if (this.getProfile(profileName)) {
      throw new Error(`Profile "${profileName}" already exists.`);
    }

    const newProfile: Profile = {
      name: profileName,
      description: 'New configuration profile',
      outputFile: `.context/${profileName}.md`,
      include: ['src/**/*.{ts,js,json}', 'README.md'],
      exclude: ['**/*.test.ts', 'dist/**'],
      forceInclude: [],
      options: {
        useGitIgnore: true,
        removeComments: false,
        showTokenCount: true,
        showFileTree: true,
        preamble: '',
      },
    };

    const edits = modify(content, ['profiles', -1], newProfile, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    });

    const newContent = applyEdits(content, edits);
    await fs.writeFile(configPath, newContent, 'utf-8');
    Logger.info(`Profile "${profileName}" added to config.`);
  }

  private validateFileConfig(config: unknown): config is FileConfig {
    if (!config || typeof config !== 'object') return false;

    // Safe cast to access properties for check
    const c = config as Record<string, unknown>;

    // Validate globalSettings
    if (!c.globalSettings || typeof c.globalSettings !== 'object') return false;
    const gs = c.globalSettings as Record<string, unknown>;

    if (
      typeof gs.debounceMs !== 'number' ||
      typeof gs.maxFileSizeKB !== 'number' ||
      typeof gs.maxTotalFiles !== 'number' ||
      typeof gs.tokenizerModel !== 'string'
    ) {
      return false;
    }

    // Validate profiles array
    if (!Array.isArray(c.profiles)) return false;

    for (const profile of c.profiles) {
      if (!this.isProfile(profile)) return false;
    }

    return true;
  }

  private isProfile(profile: unknown): profile is Profile {
    if (!profile || typeof profile !== 'object') return false;
    const p = profile as Record<string, unknown>;

    return (
      typeof p.name === 'string' &&
      typeof p.description === 'string' &&
      typeof p.outputFile === 'string' &&
      Array.isArray(p.include) &&
      Array.isArray(p.exclude) &&
      Array.isArray(p.forceInclude) &&
      typeof p.options === 'object' &&
      this.validateProfileOptions(p.options)
    );
  }

  private validateProfileOptions(options: unknown): options is ProfileOptions {
    if (!options || typeof options !== 'object') return false;
    const o = options as Record<string, unknown>;

    return (
      typeof o.useGitIgnore === 'boolean' &&
      typeof o.removeComments === 'boolean' &&
      typeof o.showTokenCount === 'boolean' &&
      typeof o.showFileTree === 'boolean' &&
      typeof o.preamble === 'string'
    );
  }
}
