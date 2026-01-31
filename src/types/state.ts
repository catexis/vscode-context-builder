export enum WatcherState {
  Idle = 'Idle', // Monitoring disabled
  Watching = 'Watching', // Waiting for file system changes
  Debouncing = 'Debouncing', // Timer started, accumulating changes
  Building = 'Building', // File assembly and writing process
}

export interface BuildStats {
  fileCount: number;
  totalSizeBytes: number;
  tokenCount: number;
  timestamp: Date;
}
