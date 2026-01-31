import * as fs from 'fs/promises';
import { getEncoding, encodingForModel, Tiktoken, TiktokenModel } from 'js-tiktoken';

export class TokenCounter {
  // Static cache to avoid re-parsing BPE ranks on every instantiation
  private static encoderCache = new Map<string, Tiktoken>();

  private encoder: Tiktoken | null = null;

  constructor(modelName: string) {
    if (TokenCounter.encoderCache.has(modelName)) {
      this.encoder = TokenCounter.encoderCache.get(modelName)!;
      return;
    }

    try {
      this.encoder = encodingForModel(modelName as TiktokenModel);
      TokenCounter.encoderCache.set(modelName, this.encoder);
    } catch {
      try {
        // Fallback checks standard encodings if model name fails
        const fallback = getEncoding('cl100k_base');
        this.encoder = fallback;
        // Do not cache generic fallback under the specific model name to allow retry
      } catch (e) {
        console.warn('TokenCounter: Failed to initialize tokenizer. Using heuristic fallback.', e);
        this.encoder = null;
      }
    }
  }

  /**
   * Counts tokens in a string.
   */
  public count(text: string): number {
    if (!this.encoder) {
      return Math.ceil(text.length / 4);
    }
    try {
      return this.encoder.encode(text).length;
    } catch (e) {
      console.warn('TokenCounter: Error encoding text, using fallback.', e);
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Reads a file and counts tokens.
   */
  public async countFile(filePath: string): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.count(content);
    } catch {
      return 0;
    }
  }
}
