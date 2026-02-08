import * as vscode from 'vscode';
import * as path from 'path';
import { Watcher } from '../core/Watcher';
import { ConfigManager } from '../core/ConfigManager';
import { WatcherState } from '../types/state';
import { Logger } from '../utils/Logger';

export function registerCommands(
  context: vscode.ExtensionContext,
  watcher: Watcher,
  configManager: ConfigManager,
  workspaceRoot: string,
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
        await configManager.updateActiveProfile(selected.label);
      }
    }),
  );

  // 3. Start Watching
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.startWatching', async () => {
      const config = await configManager.load();
      let profileName = config.activeProfile;

      // If active profile is not found in profiles list, try first available
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

        // Ensure profile exists before building
        const profile = configManager.getProfile(profileName);
        if (!profile) {
          vscode.window.showErrorMessage(`Profile "${profileName}" not found.`);
          return;
        }

        await watcher.buildOnce(profileName);
        vscode.window.showInformationMessage('Context Builder: Build complete.');
      } catch (e) {
        vscode.window.showErrorMessage('Build failed. Check config.');
        Logger.error('Command buildOnce failed', e, true);
      }
    }),
  );

  // 6. Copy Output Path
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.copyOutputPath', async () => {
      const profile = watcher.currentProfile || configManager.getActiveProfile();

      if (!profile) {
        vscode.window.showErrorMessage('No active profile found.');
        return;
      }

      const absolutePath = path.resolve(workspaceRoot, profile.outputFile);
      await vscode.env.clipboard.writeText(absolutePath);
      vscode.window.showInformationMessage(`Path copied: ${absolutePath}`);
    }),
  );

  // 7. Show Menu (Status Bar Interaction)
  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.showMenu', async () => {
      const isIdle = watcher.state === WatcherState.Idle;

      const items: vscode.QuickPickItem[] = [];

      if (isIdle) {
        items.push(
          { label: '$(play) Start Watching', description: 'Enable auto-build on file changes' },
          { label: '$(tools) Build Once', description: 'One-off build without watching' },
          { label: '$(settings-gear) Select Profile', description: 'Choose active profile' },
          { label: '$(plus) Create Profile', description: 'Add new configuration profile' },
          { label: '$(file) Init Configuration', description: 'Create default config file' },
        );
      } else {
        items.push(
          { label: '$(stop) Stop Watching', description: 'Disable auto-build' },
          { label: '$(sync) Build Now', description: 'Force rebuild immediately' },
          { label: '$(clippy) Copy Output Path', description: 'Copy absolute path to clipboard' },
          { label: '$(arrow-swap) Switch Profile', description: 'Change profile and restart watcher' },
          { label: '$(plus) Create Profile', description: 'Add new configuration profile' },
        );
      }

      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: `Context Builder (${isIdle ? 'Idle' : 'Active'})`,
      });

      if (!selection) return;

      const label = selection.label.replace(/\$\([a-z-]+\)\s/, '');

      switch (label) {
        case 'Start Watching':
          vscode.commands.executeCommand('context-builder.startWatching');
          break;
        case 'Stop Watching':
          vscode.commands.executeCommand('context-builder.stopWatching');
          break;
        case 'Build Once':
        case 'Build Now':
          vscode.commands.executeCommand('context-builder.buildOnce');
          break;
        case 'Select Profile':
        case 'Switch Profile':
          vscode.commands.executeCommand('context-builder.selectProfile');
          break;
        case 'Create Profile':
          vscode.commands.executeCommand('context-builder.createProfile');
          break;
        case 'Copy Output Path':
          vscode.commands.executeCommand('context-builder.copyOutputPath');
          break;
        case 'Init Configuration':
          vscode.commands.executeCommand('context-builder.initConfig');
          break;
      }
    }),
  );
}
