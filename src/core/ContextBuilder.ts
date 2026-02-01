import * as fs from 'fs/promises';
import * as path from 'path';
import { Profile } from '../types/config';
import { BuildStats } from '../types/state';
import { TokenCounter } from './TokenCounter';
import { LANGUAGE_MAP } from '../utils/languageMap';
import { Logger } from '../utils/Logger';

type TreeNode = { [key: string]: TreeNode };

export class ContextBuilder {
  constructor(
    private readonly workspaceRoot: string,
    private readonly profile: Profile,
    private readonly files: string[],
    private readonly tokenCounter: TokenCounter,
  ) {}

  public async build(): Promise<BuildStats> {
    const startTime = new Date();
    await this.ensureOutputDirectory();

    // 1. Generate content sections
    const fileSections: string[] = [];
    let totalSizeBytes = 0;
    let successfulFiles = 0;

    for (const filePath of this.files) {
      const result = await this.generateFileSection(filePath);

      // Graceful handling: skip file if read failed (Task 10.1)
      if (!result) {
        continue;
      }

      fileSections.push(result.content);
      totalSizeBytes += result.size;
      successfulFiles++;
    }

    // 2. Build Structural Components
    // Tree shows all files intended for build, or only successful ones?
    // Usually only successful ones to match content.
    // However, keeping original list in tree *might* be misleading if content is missing.
    // Let's filter the file list for the tree generation to match content.
    // Since we iterated `this.files`, we don't have the filtered list readily available for generateTree
    // unless we reconstruct it or filter `this.files` beforehand.
    // For efficiency, we will proceed with the original list in tree,
    // OR ideally, we only include what we could read.
    // Let's stick to simple logic: Tree represents structural intent.
    const treePart = this.profile.options.showFileTree ? this.generateTree(this.files) : '';
    const preamblePart = this.generatePreamble();
    const contentPart = fileSections.join('\n\n');

    // 3. Assembly for final token count
    let body = '';
    if (preamblePart) {
      body += preamblePart + '\n\n';
    }
    if (treePart) {
      body += '# Project Tree\n\n```\n' + treePart + '```\n\n';
    }
    body += '# Processed Files\n\n' + contentPart;

    // 4. Final Stats & Header
    const tempStats: BuildStats = {
      fileCount: successfulFiles,
      totalSizeBytes,
      tokenCount: 0, // Calculated below
      timestamp: startTime,
    };

    // Calculate approximate tokens including header
    const headerPlaceholder = this.generateHeader(tempStats);
    const fullContent = headerPlaceholder + '\n\n' + body;
    const finalTokenCount = this.tokenCounter.count(fullContent);

    // Update stats with real token count
    const finalStats: BuildStats = {
      ...tempStats,
      tokenCount: finalTokenCount,
    };

    const finalHeader = this.generateHeader(finalStats);
    const finalOutput = finalHeader + '\n\n' + body;

    // 5. Write to Disk
    const outputPath = path.join(this.workspaceRoot, this.profile.outputFile);
    await fs.writeFile(outputPath, finalOutput, 'utf-8');

    return finalStats;
  }

  private async ensureOutputDirectory(): Promise<void> {
    const outputDir = path.dirname(path.join(this.workspaceRoot, this.profile.outputFile));
    await fs.mkdir(outputDir, { recursive: true });
  }

  private generateHeader(stats: BuildStats): string {
    return [
      `# Project Context: ${this.profile.name}`,
      `> Generated: ${stats.timestamp.toISOString()}`,
      `> Files: ${stats.fileCount}`,
      `> Total Size: ${(stats.totalSizeBytes / 1024).toFixed(1)} KB`,
      `> Estimated Tokens: ${stats.tokenCount}`,
    ].join('\n');
  }

  private generatePreamble(): string {
    if (!this.profile.options.preamble) {
      return '';
    }
    return `# Preamble\n\n${this.profile.options.preamble}`;
  }

  private generateTree(files: string[]): string {
    const root: TreeNode = {};

    for (const filePath of files) {
      const parts = filePath.split('/');
      let current = root;
      for (const part of parts) {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
    }

    return this.renderTree(root, '');
  }

  private renderTree(node: TreeNode, prefix: string): string {
    const keys = Object.keys(node).sort((a, b) => {
      const aIsLeaf = Object.keys(node[a]).length === 0;
      const bIsLeaf = Object.keys(node[b]).length === 0;

      if (aIsLeaf === bIsLeaf) {
        return a.localeCompare(b);
      }
      return aIsLeaf ? 1 : -1;
    });

    let result = '';
    keys.forEach((key, index) => {
      const isLast = index === keys.length - 1;
      const marker = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      result += `${prefix}${marker}${key}\n`;

      if (Object.keys(node[key]).length > 0) {
        result += this.renderTree(node[key], prefix + childPrefix);
      }
    });

    return result;
  }

  // Changed return type to allow null on error
  private async generateFileSection(filePath: string): Promise<{ content: string; size: number } | null> {
    const absPath = path.join(this.workspaceRoot, filePath);
    let content = '';
    let size = 0;

    try {
      // 10.1: Graceful handling - check access and read
      // We rely on fs.readFile throwing if file doesn't exist or is not readable
      const stats = await fs.stat(absPath);
      size = stats.size;
      content = await fs.readFile(absPath, 'utf-8');
    } catch (error) {
      // 10.1: Log error and skip file
      Logger.error(`Failed to read file: ${filePath}`, error);
      return null;
    }

    const ext = path.extname(filePath);
    const lang = this.getLanguageFromExtension(ext);

    // TODO: Implement comment removal if options.removeComments is true

    const section = [
      `## Path: ${filePath} (Size: ${(size / 1024).toFixed(1)} KB)`,
      '',
      '```' + lang,
      content,
      '```',
    ].join('\n');

    return { content: section, size };
  }

  private getLanguageFromExtension(ext: string): string {
    return LANGUAGE_MAP[ext] || '';
  }
}
