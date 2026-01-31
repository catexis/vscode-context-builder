import * as fs from 'fs/promises';
import { getEncoding, encodingForModel, Tiktoken, TiktokenModel } from 'js-tiktoken';

export class TokenCounter {
  private encoder: Tiktoken | null = null;

  constructor(modelName: string) {
    try {
      // Attempt to load the encoding for a specific model (e.g. gpt-4o uses o200k_base)
      this.encoder = encodingForModel(modelName as TiktokenModel);
    } catch {
      try {
        // Fallback to standard encoding for GPT-3.5/4
        this.encoder = getEncoding('cl100k_base');
      } catch (e) {
        console.warn('TokenCounter: Failed to initialize tokenizer. Using heuristic fallback.', e);
        this.encoder = null;
      }
    }
  }

  /**
   * Counts tokens in a string.
   * If the encoder is not initialized, uses a rough estimate (1 token ~= 4 characters).
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
   * Read errors (e.g., deleted file) return 0.
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
