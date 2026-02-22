import * as vscode from 'vscode';
import { ConfigManager } from './core/ConfigManager';
import { Watcher } from './core/Watcher';
import { StatusBar } from './ui/StatusBar';
import { registerCommands } from './ui/Commands';
import { WatcherState } from './types/state';
import { Logger } from './utils/Logger';
import { KEY_SELECTED_WORKSPACE } from './utils/constants';

let sessionDisposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext) {
  // Init Logger FIRST
  Logger.activate(context);
  Logger.info('Extension "Context Builder" is activating...');

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    Logger.warn('No workspace folder found. Extension disabled.');
    return;
  }

  // Initialize UI immediately so it's visible regardless of selection state
  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const switchWorkspace = async () => {
    const selectedFolder = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Context Builder: Select workspace folder to monitor',
      ignoreFocusOut: true,
    });

    if (selectedFolder) {
      await startSession(selectedFolder.uri.fsPath);
    } else {
      // User cancelled picker
      // Check if we have an active session. If not, ensure status bar prompts for selection.
      const currentRoot = context.workspaceState.get<string>(KEY_SELECTED_WORKSPACE);
      if (!currentRoot) {
        statusBar.showSelectWorkspace();
      }
    }
  };

  // Register globally to allow switching at any time
  context.subscriptions.push(vscode.commands.registerCommand('context-builder.switchWorkspace', switchWorkspace));

  const startSession = async (workspaceRoot: string) => {
    Logger.info(`Starting session for root: ${workspaceRoot}`);

    // Dispose previous session resources
    if (sessionDisposables.length > 0) {
      Logger.info('Disposing previous session resources...');
      sessionDisposables.forEach((d) => d.dispose());
      sessionDisposables = [];
    }

    // Persist selection
    await context.workspaceState.update(KEY_SELECTED_WORKSPACE, workspaceRoot);

    // Initialize Core Components
    const configManager = new ConfigManager(workspaceRoot, context.workspaceState);
    const watcher = new Watcher(workspaceRoot, configManager);

    // Bind StatusBar to Session (Reset command to menu)
    statusBar.setCommand('context-builder.showMenu');
    // Ensure it shows Idle state initially
    statusBar.update(WatcherState.Idle);

    // Create a proxy context to capture subscriptions for this session.
    // NOTE: We DO NOT use `...context` here because spreading the context object triggers
    // access to proposed APIs (like extensionRuntime) which causes a crash.
    // We only explicitly pass properties required by registerCommands.
    const sessionContext = {
      subscriptions: sessionDisposables,
      workspaceState: context.workspaceState,
      extensionPath: context.extensionPath,
      extensionUri: context.extensionUri,
      storageUri: context.storageUri,
      globalState: context.globalState,
      secrets: context.secrets,
      extensionMode: context.extensionMode,
      asAbsolutePath: context.asAbsolutePath.bind(context),
      environmentVariableCollection: context.environmentVariableCollection,
      logUri: context.logUri,
      storagePath: context.storagePath,
      globalStorageUri: context.globalStorageUri,
      logPath: context.logPath,
    } as vscode.ExtensionContext;

    // Initialize Commands (registering context-builder.showMenu happens here)
    registerCommands(sessionContext, watcher, configManager, workspaceRoot);

    // Add core components to session disposables
    // NOTE: statusBar is NOT here, it is global.
    sessionDisposables.push(configManager, watcher);

    // Hook up Status Bar to Watcher events
    watcher.onStateChange((state) => {
      const profileName = watcher.currentProfile?.name;
      const stats = watcher.currentStats;
      const format = watcher.currentProfile?.options.outputFormat;
      statusBar.update(state, profileName, stats?.fileCount, format);
      Logger.info(`State changed: ${state}`);
    });

    watcher.onBuildFinished((stats) => {
      Logger.info(`Build finished: ${stats.fileCount} files, ${stats.tokenCount} tokens`);
      if (watcher.state === WatcherState.Watching) {
        const profileName = watcher.currentProfile?.name;
        const format = watcher.currentProfile?.options.outputFormat;
        statusBar.update(WatcherState.Watching, profileName, stats.fileCount, format);
      }
    });

    // Check if config exists, if not - prompt user
    if (!(await configManager.exists())) {
      const selection = await vscode.window.showInformationMessage(
        'Context Builder configuration missing in this workspace. Create default?',
        'Yes',
        'No',
      );

      if (selection === 'Yes') {
        try {
          await configManager.createDefault();
          vscode.window.showInformationMessage('Configuration created.');
        } catch (error) {
          vscode.window.showErrorMessage('Failed to create configuration.');
          Logger.error('Failed to create default config', error);
        }
      }
    }

    configManager.startWatching();
  };

  // Logic to determine initial root
  const savedRoot = context.workspaceState.get<string>(KEY_SELECTED_WORKSPACE);
  let initialRoot: string | undefined;

  // Validate saved root exists in current folders
  if (savedRoot && workspaceFolders.some((f) => f.uri.fsPath === savedRoot)) {
    initialRoot = savedRoot;
  } else if (workspaceFolders.length === 1) {
    initialRoot = workspaceFolders[0].uri.fsPath;
  }

  if (initialRoot) {
    await startSession(initialRoot);
  } else {
    // If no saved root and multiple folders
    statusBar.showSelectWorkspace();
    await switchWorkspace();
  }
}

export function deactivate() {
  Logger.info('Extension deactivated.');
  sessionDisposables.forEach((d) => d.dispose());
}
