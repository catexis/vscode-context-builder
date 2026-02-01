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

  // Added 'focus' parameter
  public static error(message: string, error?: unknown, focus: boolean = false): void {
    this.log('ERROR', message);
    if (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(`      Stack: ${error.stack || error.message}`);
      } else {
        this.outputChannel.appendLine(`      Detail: ${String(error)}`);
      }
    }

    if (focus) {
      this.show();
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
