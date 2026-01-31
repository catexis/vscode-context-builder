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

export interface ContextConfig {
  activeProfile: string;
  globalSettings: GlobalSettings;
  profiles: Profile[];
}
