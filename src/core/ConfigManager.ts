import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ContextConfig, Profile } from '../types/config';
import {
  CONFIG_PATH,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_FILE_SIZE_KB,
  DEFAULT_MAX_TOTAL_FILES,
} from '../utils/constants';

export class ConfigManager implements vscode.Disposable {
  private configWatcher: vscode.FileSystemWatcher | null = null;
  private readonly _onConfigChanged = new vscode.EventEmitter<ContextConfig | null>();
  public readonly onDidChangeConfig = this._onConfigChanged.event;

  private currentConfig: ContextConfig | null = null;

  constructor(private readonly workspaceRoot: string) {}

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
      const parsed = JSON.parse(content);

      if (!this.validate(parsed)) {
        throw new Error('Invalid configuration structure');
      }

      this.currentConfig = parsed;
      return parsed;
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
    const defaultConfig: ContextConfig = {
      activeProfile: 'default',
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
  }

  public startWatching(): void {
    if (this.configWatcher) {
      return;
    }

    const pattern = new vscode.RelativePattern(this.workspaceRoot, CONFIG_PATH);
    this.configWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      try {
        const config = await this.load();
        this._onConfigChanged.fire(config);
      } catch (error) {
        this._onConfigChanged.fire(null);
        const action = await vscode.window.showErrorMessage(
          `Context Builder Config Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'Open Config',
        );
        if (action === 'Open Config') {
          const doc = await vscode.workspace.openTextDocument(this.getConfigPath());
          await vscode.window.showTextDocument(doc);
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

  private validate(config: any): config is ContextConfig {
    if (!config || typeof config !== 'object') return false;

    // Validate globalSettings
    if (!config.globalSettings || typeof config.globalSettings !== 'object') return false;
    const { debounceMs, maxFileSizeKB, maxTotalFiles, tokenizerModel } = config.globalSettings;
    if (
      typeof debounceMs !== 'number' ||
      typeof maxFileSizeKB !== 'number' ||
      typeof maxTotalFiles !== 'number' ||
      typeof tokenizerModel !== 'string'
    ) {
      return false;
    }

    // Validate activeProfile
    if (typeof config.activeProfile !== 'string') return false;

    // Validate profiles array
    if (!Array.isArray(config.profiles)) return false;
    for (const profile of config.profiles) {
      if (
        typeof profile.name !== 'string' ||
        typeof profile.description !== 'string' ||
        typeof profile.outputFile !== 'string' ||
        !Array.isArray(profile.include) ||
        !Array.isArray(profile.exclude) ||
        !Array.isArray(profile.forceInclude) ||
        typeof profile.options !== 'object'
      ) {
        return false;
      }
    }

    return true;
  }
}
