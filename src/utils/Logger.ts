import * as vscode from 'vscode';

export class Logger {
  private static outputChannel: vscode.OutputChannel;

  public static activate(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('Context Builder');
    context.subscriptions.push(this.outputChannel);
  }

  public static info(message: string): void {
    this.log('INFO', message);
  }

  public static warn(message: string): void {
    this.log('WARN', message);
  }

  public static error(message: string, error?: unknown): void {
    this.log('ERROR', message);
    if (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(`      Stack: ${error.stack || error.message}`);
      } else {
        this.outputChannel.appendLine(`      Detail: ${String(error)}`);
      }
    }
  }

  public static show(): void {
    this.outputChannel?.show();
  }

  private static log(level: string, message: string): void {
    if (!this.outputChannel) return;
    const time = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${time}] [${level}] ${message}`);
  }
}
