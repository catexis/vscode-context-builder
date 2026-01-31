import * as vscode from 'vscode';
import { Watcher } from '../core/Watcher';
import { ConfigManager } from '../core/ConfigManager';

export function registerCommands(
  context: vscode.ExtensionContext,
  watcher: Watcher,
  configManager: ConfigManager,
): void {
  // 1. Init Configuration
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.initConfig', async () => {
      if (await configManager.exists()) {
        const overwrite = await vscode.window.showWarningMessage('Config file already exists. Overwrite?', 'Yes', 'No');
        if (overwrite !== 'Yes') return;
      }
      await configManager.createDefault();
      const doc = await vscode.workspace.openTextDocument(configManager.getConfigPath());
      await vscode.window.showTextDocument(doc);
    }),
  );

  // 2. Select Profile
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.selectProfile', async () => {
      const config = await configManager.load();
      const items = config.profiles.map((p) => ({
        label: p.name,
        description: p.description,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a profile to start watching',
      });

      if (selected) {
        await watcher.start(selected.label);
      }
    }),
  );

  // 3. Start Watching
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.startWatching', async () => {
      const config = await configManager.load();
      // Try active profile from config, fallback to first
      let profileName = config.activeProfile;
      const profileExists = config.profiles.find((p) => p.name === profileName);

      if (!profileExists) {
        if (config.profiles.length > 0) {
          profileName = config.profiles[0].name;
        } else {
          vscode.window.showErrorMessage('No profiles defined in config.');
          return;
        }
      }

      await watcher.start(profileName);
      vscode.window.showInformationMessage(`Context Builder: Watching profile "${profileName}"`);
    }),
  );

  // 4. Stop Watching
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.stopWatching', () => {
      watcher.stop();
      vscode.window.showInformationMessage('Context Builder: Stopped.');
    }),
  );

  // 5. Build Once
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.buildOnce', async () => {
      try {
        const config = await configManager.load();
        const profileName = watcher.currentProfile?.name || config.activeProfile;
        await watcher.buildOnce(profileName);
        vscode.window.showInformationMessage('Context Builder: Build complete.');
      } catch (e) {
        vscode.window.showErrorMessage('Build failed. Check config.');
        console.error(e);
      }
    }),
  );
}
