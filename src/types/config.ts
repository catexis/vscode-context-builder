export type OutputFormat = 'markdown' | 'xml';

export interface GlobalSettings {
  debounceMs: number;
  maxFileSizeKB: number;
  maxTotalFiles: number;
  tokenizerModel: string;
}

export interface ProfileOptions {
  useGitIgnore: boolean;
  removeComments: boolean;
  showTokenCount: boolean;
  showFileTree: boolean;
  preamble: string;
  outputFormat: OutputFormat;
}

export interface Profile {
  name: string;
  description: string;
  outputFile: string;
  include: string[];
  exclude: string[];
  forceInclude: string[];
  options: ProfileOptions;
}

export interface FileConfig {
  globalSettings: GlobalSettings;
  profiles: Profile[];
}

export interface ContextConfig extends FileConfig {
  activeProfile: string;
  watcherEnabled: boolean;
}
