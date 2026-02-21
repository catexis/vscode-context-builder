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

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.selectProfile', async () => {
      try {
        const config = await configManager.load();
        const items = config.profiles.map((p) => ({
          label: p.name,
          description: p.description,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a profile',
        });

        if (selected) {
          await configManager.updateActiveProfile(selected.label);
        }
      } catch (error) {
        Logger.error('Failed to select profile', error);
        vscode.window.showErrorMessage('Failed to load profiles. Check config.');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.startWatching', async () => {
      await configManager.setWatcherEnabled(true);
      vscode.window.showInformationMessage('Context Builder: Watching enabled.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.stopWatching', async () => {
      await configManager.setWatcherEnabled(false);
      vscode.window.showInformationMessage('Context Builder: Watching stopped.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.buildOnce', async () => {
      try {
        const config = await configManager.load();
        const profileName = watcher.currentProfile?.name || config.activeProfile;

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

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.createProfile', async () => {
      try {
        await configManager.load();

        const nameInput = await vscode.window.showInputBox({
          prompt: 'Enter profile name (leave empty for timestamp)',
          placeHolder: 'e.g., frontend-build',
        });

        if (nameInput === undefined) return;

        let finalName = nameInput.trim();

        if (!finalName) {
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const hours = String(now.getHours()).padStart(2, '0');
          const minutes = String(now.getMinutes()).padStart(2, '0');
          const seconds = String(now.getSeconds()).padStart(2, '0');
          finalName = `${year}${month}${day}_${hours}${minutes}${seconds}`;
        }

        await configManager.addProfile(finalName);

        const selection = await vscode.window.showInformationMessage(
          `Profile "${finalName}" created. Switch to it?`,
          'Yes',
          'No',
        );

        if (selection === 'Yes') {
          await configManager.updateActiveProfile(finalName);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to create profile: ${msg}`);
        Logger.error('Create Profile failed', error);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.removeProfile', async () => {
      try {
        const config = await configManager.load();

        if (config.profiles.length <= 1) {
          vscode.window.showWarningMessage('Cannot delete the last remaining profile.');
          return;
        }

        const items = config.profiles.map((p) => ({
          label: p.name,
          description: p.description,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a profile to delete',
        });

        if (!selected) return;

        const answer = await vscode.window.showWarningMessage(
          `Are you sure you want to delete profile "${selected.label}"?`,
          'Yes',
          'No',
        );

        if (answer === 'Yes') {
          await configManager.removeProfile(selected.label);
          vscode.window.showInformationMessage(`Profile "${selected.label}" removed.`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to remove profile: ${msg}`);
        Logger.error('Remove Profile failed', error);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.selectFormat', async () => {
      try {
        const config = await configManager.load();
        const profileName = watcher.currentProfile?.name || config.activeProfile;

        if (!profileName) {
          vscode.window.showErrorMessage('No active profile found.');
          return;
        }

        const items: vscode.QuickPickItem[] = [
          { label: 'markdown', description: 'Standard Markdown output' },
          { label: 'xml', description: 'Structured XML output' },
        ];

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Select output format for profile "${profileName}"`,
        });

        if (selected) {
          await configManager.updateProfileFormat(profileName, selected.label as 'markdown' | 'xml');
          vscode.window.showInformationMessage(
            `Output format changed to ${selected.label} for profile "${profileName}".`,
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to change output format: ${msg}`);
        Logger.error('Select Format failed', error);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('context-builder.showMenu', async () => {
      const isIdle = watcher.state === WatcherState.Idle;

      const items: vscode.QuickPickItem[] = [];

      if (isIdle) {
        items.push(
          { label: '$(play) Start Watching', description: 'Enable auto-build on file changes' },
          { label: '$(tools) Build Once', description: 'One-off build without watching' },
          { label: '$(settings-gear) Select Profile', description: 'Choose active profile' },
          { label: '$(code) Select Format', description: 'Change output format (Markdown/XML)' },
          { label: '$(plus) Create Profile', description: 'Add new configuration profile' },
          { label: '$(trash) Delete Profile', description: 'Remove a configuration profile' },
          { label: '$(file) Init Configuration', description: 'Create default config file' },
          { label: '$(root-folder) Switch Workspace', description: 'Change monitored workspace folder' },
        );
      } else {
        items.push(
          { label: '$(stop) Stop Watching', description: 'Disable auto-build' },
          { label: '$(sync) Build Now', description: 'Force rebuild immediately' },
          { label: '$(clippy) Copy Output Path', description: 'Copy absolute path to clipboard' },
          { label: '$(arrow-swap) Switch Profile', description: 'Change profile and restart watcher' },
          { label: '$(code) Select Format', description: 'Change output format (Markdown/XML)' },
          { label: '$(plus) Create Profile', description: 'Add new configuration profile' },
          { label: '$(trash) Delete Profile', description: 'Remove a configuration profile' },
          { label: '$(root-folder) Switch Workspace', description: 'Change monitored workspace folder' },
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
        case 'Select Format':
          vscode.commands.executeCommand('context-builder.selectFormat');
          break;
        case 'Create Profile':
          vscode.commands.executeCommand('context-builder.createProfile');
          break;
        case 'Delete Profile':
          vscode.commands.executeCommand('context-builder.removeProfile');
          break;
        case 'Copy Output Path':
          vscode.commands.executeCommand('context-builder.copyOutputPath');
          break;
        case 'Init Configuration':
          vscode.commands.executeCommand('context-builder.initConfig');
          break;
        case 'Switch Workspace':
          vscode.commands.executeCommand('context-builder.switchWorkspace');
          break;
      }
    }),
  );
}
