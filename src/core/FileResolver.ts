import * as fs from 'fs/promises';
import * as path from 'path';
import fg from 'fast-glob';
import * as mm from 'micromatch';
import ignore from 'ignore';
import { Profile, GlobalSettings } from '../types/config';
import { HARDCODED_EXCLUDES } from '../utils/constants';

export class FileResolver {
  constructor(
    private readonly workspaceRoot: string,
    private readonly profile: Profile,
    private readonly globalSettings: GlobalSettings,
  ) {}

  public async resolve(): Promise<string[]> {
    // 1. Scan: Getting the initial list of files
    let files = await this.scanIncluded();

    // 2. Filter (Explicit): Exclude files using exclude and hardcoded patterns
    files = this.applyExclude(files);

    // 3. Filter (Git): Filter by .gitignore (if enabled)
    if (this.profile.options.useGitIgnore) {
      files = await this.applyGitIgnore(files);
    }

    // 4. Merge (Force): Force adding files (bypasses filters above)
    files = await this.mergeForceInclude(files);

    // 5. Safety: Excluding output file to prevent recursion
    files = this.excludeOutputFile(files, this.profile.outputFile);

    // 6. Hard Limit Check: Check the total number of files before heavy operations
    if (files.length > this.globalSettings.maxTotalFiles) {
      throw new Error(
        `Total files (${files.length}) exceeds limit (${this.globalSettings.maxTotalFiles}). Adjust your 'include'/'exclude' patterns.`,
      );
    }

    // 7. Content Safety: Checking size and binarity
    files = await this.filterByContent(files);

    return files.sort();
  }

  public getWatchPatterns(): string[] {
    return [...this.profile.include, ...this.profile.forceInclude];
  }

  private async scanIncluded(): Promise<string[]> {
    return fg(this.profile.include, {
      cwd: this.workspaceRoot,
      dot: true,
      onlyFiles: true,
      absolute: false, // Working with relative paths for clarity
    });
  }

  private applyExclude(files: string[]): string[] {
    const allExcludes = [...this.profile.exclude, ...HARDCODED_EXCLUDES];
    return mm.not(files, allExcludes);
  }

  private async applyGitIgnore(files: string[]): Promise<string[]> {
    const gitIgnorePath = path.join(this.workspaceRoot, '.gitignore');
    try {
      await fs.access(gitIgnorePath);
    } catch {
      return files; // If there is no .gitignore, return as is
    }

    const gitIgnoreContent = await fs.readFile(gitIgnorePath, 'utf-8');
    const ig = ignore().add(gitIgnoreContent);
    return ig.filter(files);
  }

  private async mergeForceInclude(files: string[]): Promise<string[]> {
    if (this.profile.forceInclude.length === 0) {
      return files;
    }

    const fileSet = new Set(files);

    // forceInclude can also contain glob patterns
    const forceFiles = await fg(this.profile.forceInclude, {
      cwd: this.workspaceRoot,
      dot: true,
      onlyFiles: true,
      absolute: false,
    });

    for (const file of forceFiles) {
      fileSet.add(file);
    }

    return Array.from(fileSet);
  }

  private excludeOutputFile(files: string[], outputFile: string): string[] {
    // Normalize paths for cross-platform comparison
    const normalizedOutput = outputFile.replace(/\\/g, '/');
    return files.filter((f) => f !== normalizedOutput);
  }

  private async filterByContent(files: string[]): Promise<string[]> {
    const validFiles: string[] = [];
    const maxBytes = this.globalSettings.maxFileSizeKB * 1024;

    for (const file of files) {
      const absPath = path.join(this.workspaceRoot, file);
      try {
        const stats = await fs.stat(absPath);

        // Exclude overly large files
        if (stats.size > maxBytes) {
          continue;
        }

        // Excluding binary files
        if (await this.isBinary(absPath)) {
          continue;
        }

        validFiles.push(file);
      } catch (e) {
        // The file could have been deleted during scanning, skipping
        continue;
      }
    }
    return validFiles;
  }

  private async isBinary(filePath: string): Promise<boolean> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(8192); // Read the first 8KB
      const { bytesRead } = await handle.read(buffer, 0, 8192, 0);

      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          // Null byte detection
          return true;
        }
      }
      return false;
    } catch {
      return true; // If there is a reading error, we consider it binary to be on the safe side.
    } finally {
      await handle?.close();
    }
  }
}
