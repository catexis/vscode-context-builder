# Context Builder

Context Builder is a VS Code extension that automates the creation of a project context file. It aggregates source code files into a single structured document, making it easier to provide context to Large Language Models (LLMs).

## Features

- **File Aggregation**: Combines multiple source files into one structured document.
- **Multiple Output Formats**: Supports output generation in `markdown` and `xml` formats.
- **Watch Mode**: Monitors file changes in real-time and automatically rebuilds the context file.
- **Profiles**: Supports multiple configurations via a JSON config file. Create, switch, and remove profiles dynamically.
- **Workspace Management**: Supports switching the active workspace folder in multi-root environments.
- **Smart Filtering**: Respects `.gitignore` rules, excludes binary files, and filters by file size.
- **Token Counting**: Calculates estimated token count (using `cl100k_base` encoding) for the generated context.
- **Structure Visualization**: Generates a text-based file tree of the included files.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **Context Builder: Init Configuration**. This creates a `.vscode/context-config.json` file.
3. Edit the configuration file to define your profiles and file patterns.
4. Run **Context Builder: Start Watching** or click the status bar item to begin monitoring.

The extension will generate the output file whenever a relevant file changes.

## Configuration

The extension is configured via `.vscode/context-config.json`.

### Global Settings

- `debounceMs`: Time in milliseconds to wait after a file change before rebuilding.
- `maxFileSizeKB`: Maximum size of a single file to include.
- `maxTotalFiles`: Maximum number of files allowed in a build.
- `tokenizerModel`: Model used for token counting.

### Profiles

Define sets of rules for different contexts.

- `name`: Unique identifier for the profile.
- `outputFile`: Path to the generated file.
- `include`: Glob patterns for files to include.
- `exclude`: Glob patterns for files to exclude.
- `forceInclude`: Specific files to include regardless of exclude patterns or `.gitignore`.
- `options`:
  - `useGitIgnore`: If true, ignores files listed in `.gitignore`.
  - `showTokenCount`: Displays token count in the output header.
  - `showFileTree`: Includes a project structure tree in the output.
  - `preamble`: Custom text instructions added to the beginning of the output file.
  - `outputFormat`: Sets the format of the output file (`markdown` or `xml`).

## Commands

- `Context Builder: Init Configuration`: Creates a default configuration file.
- `Context Builder: Select Profile`: Switches the active profile.
- `Context Builder: Switch Workspace`: Changes the monitored workspace folder.
- `Context Builder: Start Watching`: Enables auto-build on file changes.
- `Context Builder: Stop Watching`: Disables auto-build.
- `Context Builder: Build Once`: Generates the context file immediately without watching.
- `Context Builder: Copy Output Path`: Copies the absolute path of the generated context file to the clipboard.
- `Context Builder: Show Menu`: Displays the extension control menu.
- `Context Builder: Create Profile`: Creates a new profile configuration.
- `Context Builder: Remove Profile`: Deletes a profile from the configuration.
- `Context Builder: Select Output Format`: Changes the output format for the active profile.

## Status Bar

The status bar item (bottom right) shows the current state:

- **Context: Off**: Extension is idle.
- **Context: Select Workspace**: Prompt to select a workspace folder.
- **[Profile Name] [Format] (X files)**: Watching for changes.
- **Building...**: Currently generating the context file.
- **Waiting...**: Accumulating file changes before build.

## Development

This project uses Taskfile (`taskfile.yaml`) for local development automation.

- `task reinstall`: Removes the old package, builds a new VSIX package, and forces installation in the local VS Code instance.
- `task codequality`: Runs Prettier formatting, TypeScript type checking, and ESLint verification.
- `task tree`: Generates a JSON representation of the project structure.
