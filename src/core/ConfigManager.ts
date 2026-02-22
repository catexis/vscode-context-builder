import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { modify, applyEdits } from 'jsonc-parser';
import {
  ContextConfig,
  FileConfig,
  Profile,
  ProfileOptions,
  OutputFormat,
  FORMAT_EXTENSION_MAP,
  SUPPORTED_FORMATS,
} from '../types/config';
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
      let content = await fs.readFile(configPath, 'utf-8');
      const parsedFileConfig = JSON.parse(content);
      let needsMigration = false;

      // IMPORTANT: `content` is mutated each iteration. `modify()` computes edit
      // positions against the current `content` value, so sequential application is safe
      // as long as `content` is updated before the next `modify()` call.
      if (Array.isArray(parsedFileConfig.profiles)) {
        parsedFileConfig.profiles.forEach((p: any, index: number) => {
          if (p.options && !p.options.outputFormat) {
            p.options.outputFormat = 'markdown';
            const edits = modify(content, ['profiles', index, 'options', 'outputFormat'], 'markdown', {
              formattingOptions: { insertSpaces: true, tabSize: 2 },
            });
            content = applyEdits(content, edits);
            needsMigration = true;
          }
        });
      }

      if (needsMigration) {
        await fs.writeFile(configPath, content, 'utf-8');
      }

      if (!this.validateFileConfig(parsedFileConfig)) {
        throw new Error('Invalid configuration structure');
      }

      const activeProfileName = this.memento.get<string>(KEY_ACTIVE_PROFILE);
      const watcherEnabled = this.memento.get<boolean>(KEY_WATCHER_ENABLED, false);

      let finalActiveProfile = activeProfileName;
      if (!finalActiveProfile || !parsedFileConfig.profiles.find((p: Profile) => p.name === finalActiveProfile)) {
        if (parsedFileConfig.profiles.length > 0) {
          finalActiveProfile = parsedFileConfig.profiles[0].name;
        } else {
          finalActiveProfile = '';
        }
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
    const defaultFormat: OutputFormat = 'markdown';
    const ext = FORMAT_EXTENSION_MAP[defaultFormat];
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
          outputFile: `.context/context${ext}`,
          include: ['src/**/*.{ts,js,py,md}', 'package.json', 'README.md'],
          exclude: ['**/*.test.ts'],
          forceInclude: [],
          options: {
            useGitIgnore: true,
            removeComments: false,
            showTokenCount: true,
            showFileTree: true,
            preamble: 'Project context for LLM.',
            outputFormat: defaultFormat,
          },
        },
      ],
    };

    const configPath = this.getConfigPath();
    const configDir = path.dirname(configPath);

    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');

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
        Logger.info('Config file event detected. Reloading...');
        const config = await this.load();
        this._onConfigChanged.fire(config);
        Logger.info(`Config loaded. Active profile: ${config.activeProfile}`);
      } catch (error) {
        this._onConfigChanged.fire(null);

        const err = error as { code?: string; message: string };
        if (err.code === 'ENOENT') {
          Logger.info('Config file not found. Waiting for creation...');
          return;
        }

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

    await this.memento.update(KEY_ACTIVE_PROFILE, profileName);
    Logger.info(`Updated activeProfile to "${profileName}" in Memento.`);

    if (this.currentConfig) {
      this.currentConfig.activeProfile = profileName;
      this._onConfigChanged.fire(this.currentConfig);
    } else {
      try {
        const config = await this.load();
        this._onConfigChanged.fire(config);
      } catch (e) {}
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

    const defaultFormat: OutputFormat = 'markdown';
    const ext = FORMAT_EXTENSION_MAP[defaultFormat];

    const newProfile: Profile = {
      name: profileName,
      description: 'New configuration profile',
      outputFile: `.context/${profileName}${ext}`,
      include: ['src/**/*.{ts,js,json}', 'README.md'],
      exclude: ['**/*.test.ts', 'dist/**'],
      forceInclude: [],
      options: {
        useGitIgnore: true,
        removeComments: false,
        showTokenCount: true,
        showFileTree: true,
        preamble: '',
        outputFormat: defaultFormat,
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

  public async removeProfile(profileName: string): Promise<void> {
    const configPath = this.getConfigPath();
    let content = await fs.readFile(configPath, 'utf-8');

    const config = await this.load();

    if (config.profiles.length <= 1) {
      throw new Error('Cannot delete the last remaining profile.');
    }

    const profileIndex = config.profiles.findIndex((p) => p.name === profileName);
    if (profileIndex === -1) {
      throw new Error(`Profile "${profileName}" not found.`);
    }

    const removeEdits = modify(content, ['profiles', profileIndex], undefined, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    });

    content = applyEdits(content, removeEdits);

    if (config.activeProfile === profileName) {
      const remainingProfiles = config.profiles.filter((p) => p.name !== profileName);
      const newActiveProfile = remainingProfiles[0].name;

      const updateActiveEdits = modify(content, ['activeProfile'], newActiveProfile, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      });

      content = applyEdits(content, updateActiveEdits);

      await this.memento.update(KEY_ACTIVE_PROFILE, newActiveProfile);
      Logger.info(`Active profile automatically switched to "${newActiveProfile}" after deletion.`);
    }

    await fs.writeFile(configPath, content, 'utf-8');
    Logger.info(`Profile "${profileName}" removed from config.`);
  }

  public async updateProfileFormat(profileName: string, format: OutputFormat): Promise<void> {
    const configPath = this.getConfigPath();
    let content = await fs.readFile(configPath, 'utf-8');
    const config = await this.load();

    const profileIndex = config.profiles.findIndex((p) => p.name === profileName);
    if (profileIndex === -1) {
      throw new Error(`Profile "${profileName}" not found.`);
    }

    const oldOutputFile = config.profiles[profileIndex].outputFile;

    const edits = modify(content, ['profiles', profileIndex, 'options', 'outputFormat'], format, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });

    content = applyEdits(content, edits);

    const newExt = FORMAT_EXTENSION_MAP[format];
    const currentOutputFile = config.profiles[profileIndex].outputFile;

    if (newExt && currentOutputFile) {
      const parsedPath = path.parse(currentOutputFile);
      parsedPath.base = parsedPath.name + newExt;
      parsedPath.ext = newExt;
      const newOutputFile = path.format(parsedPath);

      if (newOutputFile !== currentOutputFile) {
        const fileEdits = modify(content, ['profiles', profileIndex, 'outputFile'], newOutputFile, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        content = applyEdits(content, fileEdits);
      }
    }

    await fs.writeFile(configPath, content, 'utf-8');

    if (oldOutputFile) {
      const oldAbsPath = path.join(this.workspaceRoot, oldOutputFile);
      try {
        await fs.unlink(oldAbsPath);
        Logger.info(`Removed old output file: ${oldAbsPath}`);
      } catch {
        // Ignored if file does not exist
      }
    }

    Logger.info(`Profile "${profileName}" format updated to "${format}".`);
  }

  private validateFileConfig(config: unknown): config is FileConfig {
    if (!config || typeof config !== 'object') return false;

    const c = config as Record<string, unknown>;

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
      typeof o.preamble === 'string' &&
      SUPPORTED_FORMATS.includes(o.outputFormat as string)
    );
  }
}
