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

    // 5. Safety: Excluding output file to prevent recursion (Absolute Path Check)
    files = this.excludeOutputFile(files, this.profile.outputFile);

    // 6. Hard Limit Check: Check the total number of files before heavy operations
    if (files.length > this.globalSettings.maxTotalFiles) {
      throw new Error(
        `Total files (${files.length}) exceeds limit (${this.globalSettings.maxTotalFiles}). Adjust your 'include'/'exclude' patterns.`,
      );
    }

    // 7. Content Safety: Checking size and binarity (Parallel execution)
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
      absolute: false,
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
      return files;
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
    const absoluteOutput = path.resolve(this.workspaceRoot, outputFile);

    return files.filter((f) => {
      const absoluteFile = path.resolve(this.workspaceRoot, f);
      return absoluteFile !== absoluteOutput;
    });
  }

  private async filterByContent(files: string[]): Promise<string[]> {
    const maxBytes = this.globalSettings.maxFileSizeKB * 1024;

    const checks = await Promise.all(
      files.map(async (file) => {
        const absPath = path.join(this.workspaceRoot, file);
        try {
          const stats = await fs.stat(absPath);
          if (stats.size > maxBytes) return null;
          if (await this.isBinary(absPath)) return null;
          return file;
        } catch {
          return null; // Skip deleted/inaccessible files
        }
      }),
    );

    return checks.filter((f): f is string => f !== null);
  }

  private async isBinary(filePath: string): Promise<boolean> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, 8192, 0);

      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true;
      }
      return false;
    } catch {
      return true;
    } finally {
      await handle?.close();
    }
  }
}
