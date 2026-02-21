import * as fs from 'fs/promises';
import * as path from 'path';
import { Profile, OutputFormat } from '../types/config';
import { BuildStats } from '../types/state';
import { TokenCounter } from './TokenCounter';
import { LANGUAGE_MAP } from '../utils/languageMap';
import { Logger } from '../utils/Logger';

type TreeNode = { [key: string]: TreeNode };

export interface FileData {
  path: string;
  content: string;
  size: number;
  lang: string;
}

export interface IContextFormatter {
  format(
    filesData: FileData[],
    treePart: string,
    preamblePart: string,
    stats: BuildStats,
    profileName: string,
    workspaceRoot: string,
  ): string;
}

export class MarkdownFormatter implements IContextFormatter {
  public format(
    filesData: FileData[],
    treePart: string,
    preamblePart: string,
    stats: BuildStats,
    profileName: string,
    _workspaceRoot: string,
  ): string {
    const header = [
      `# Project Context: ${profileName}`,
      `> Generated: ${stats.timestamp.toISOString()}`,
      `> Files: ${stats.fileCount}`,
      `> Total Size: ${(stats.totalSizeBytes / 1024).toFixed(1)} KB`,
      `> Estimated Tokens: ${stats.tokenCount}`,
    ].join('\n');

    let body = '';
    if (preamblePart) {
      body += `# Preamble\n\n${preamblePart}\n\n`;
    }
    if (treePart) {
      body += '# Project Tree\n\n```\n' + treePart + '```\n\n';
    }
    body += '# Processed Files\n\n';

    const fileSections = filesData.map((fd) => {
      return [
        `## Path: ${fd.path} (Size: ${(fd.size / 1024).toFixed(1)} KB)`,
        '',
        '```' + fd.lang,
        fd.content,
        '```',
      ].join('\n');
    });

    body += fileSections.join('\n\n');

    return header + '\n\n' + body;
  }
}

export class XmlFormatter implements IContextFormatter {
  public format(
    filesData: FileData[],
    treePart: string,
    preamblePart: string,
    stats: BuildStats,
    _profileName: string,
    workspaceRoot: string,
  ): string {
    const parts: string[] = [];
    parts.push(`<project_context>`);
    parts.push(`  <metadata>`);
    parts.push(`    <generated_at>${stats.timestamp.toISOString()}</generated_at>`);
    parts.push(
      `    <stats files="${stats.fileCount}" size="${(stats.totalSizeBytes / 1024).toFixed(1)} KB" tokens="${stats.tokenCount}" />`,
    );
    parts.push(`  </metadata>`);

    if (preamblePart) {
      parts.push(`  <instructions>`);
      parts.push(`    <![CDATA[\n${this.escapeCdata(preamblePart)}\n    ]]>`);
      parts.push(`  </instructions>`);
    }

    if (treePart) {
      parts.push(`  <file_tree>`);
      parts.push(`    <![CDATA[\n${this.escapeCdata(treePart)}    ]]>`);
      parts.push(`  </file_tree>`);
    }

    parts.push(`  <files>`);
    parts.push(`    <root path="${this.escapeXmlAttr(workspaceRoot)}">`);

    for (const fd of filesData) {
      parts.push(
        `      <file path="${this.escapeXmlAttr(fd.path)}" language="${this.escapeXmlAttr(fd.lang)}" size="${(fd.size / 1024).toFixed(1)} KB">`,
      );
      parts.push(`        <![CDATA[\n${this.escapeCdata(fd.content)}\n        ]]>`);
      parts.push(`      </file>`);
    }

    parts.push(`    </root>`);
    parts.push(`  </files>`);
    parts.push(`</project_context>`);

    return parts.join('\n');
  }

  private escapeCdata(text: string): string {
    return text.replace(/]]>/g, ']]]]><![CDATA[>');
  }

  private escapeXmlAttr(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export class FormatterFactory {
  public static getFormatter(format: OutputFormat): IContextFormatter {
    switch (format) {
      case 'xml':
        return new XmlFormatter();
      case 'markdown':
      default:
        return new MarkdownFormatter();
    }
  }
}

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

    const filesData: FileData[] = [];
    let totalSizeBytes = 0;

    for (const filePath of this.files) {
      const data = await this.readFileData(filePath);
      if (!data) continue;

      filesData.push(data);
      totalSizeBytes += data.size;
    }

    const treePart = this.profile.options.showFileTree ? this.generateTree(this.files) : '';
    const preamblePart = this.profile.options.preamble || '';

    const tempStats: BuildStats = {
      fileCount: filesData.length,
      totalSizeBytes,
      tokenCount: 0,
      timestamp: startTime,
    };

    const format: OutputFormat = this.profile.options.outputFormat || 'markdown';
    const formatter = FormatterFactory.getFormatter(format);

    const tempOutput = formatter.format(
      filesData,
      treePart,
      preamblePart,
      tempStats,
      this.profile.name,
      this.workspaceRoot,
    );

    const finalTokenCount = this.tokenCounter.count(tempOutput);

    const finalStats: BuildStats = {
      ...tempStats,
      tokenCount: finalTokenCount,
    };

    const finalOutput = formatter.format(
      filesData,
      treePart,
      preamblePart,
      finalStats,
      this.profile.name,
      this.workspaceRoot,
    );

    const outputPath = path.join(this.workspaceRoot, this.profile.outputFile);
    await fs.writeFile(outputPath, finalOutput, 'utf-8');

    return finalStats;
  }

  private async ensureOutputDirectory(): Promise<void> {
    const outputDir = path.dirname(path.join(this.workspaceRoot, this.profile.outputFile));
    await fs.mkdir(outputDir, { recursive: true });
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

  private async readFileData(filePath: string): Promise<FileData | null> {
    const absPath = path.join(this.workspaceRoot, filePath);
    try {
      const stats = await fs.stat(absPath);
      const content = await fs.readFile(absPath, 'utf-8');
      const ext = path.extname(filePath);
      const lang = this.getLanguageFromExtension(ext);

      return {
        path: filePath,
        content,
        size: stats.size,
        lang,
      };
    } catch (error) {
      Logger.error(`Failed to read file: ${filePath}`, error);
      return null;
    }
  }

  private getLanguageFromExtension(ext: string): string {
    return LANGUAGE_MAP[ext] || '';
  }
}
