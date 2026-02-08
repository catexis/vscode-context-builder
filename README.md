# Context Builder

Context Builder is a VS Code extension that automates the creation of a project context file. It aggregates source code files into a single Markdown document, making it easier to provide context to Large Language Models (LLMs).

## Features

- **File Aggregation**: Combines multiple source files into one structured Markdown file.
- **Watch Mode**: Monitors file changes in real-time and automatically rebuilds the context file.
- **Profiles**: Supports multiple configurations (e.g., backend, frontend) via a JSON config file.
- **Smart Filtering**: Respects `.gitignore` rules, excludes binary files, and filters by file size.
- **Token Counting**: Calculates estimated token count (using `cl100k_base` encoding) for the generated context.
- **Structure Visualization**: Generates a text-based file tree of the included files.

## Usage

1.  Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2.  Run **Context Builder: Init Configuration**. This creates a `.vscode/context-config.json` file.
3.  Edit the configuration file to define your profiles and file patterns.
4.  Run **Context Builder: Start Watching** or click the status bar item to begin monitoring.

The extension will generate the output file (e.g., `.context/context.md`) whenever a relevant file changes.

## Configuration

The extension is configured via `.vscode/context-config.json`.

### Global Settings

- `debounceMs`: Time in milliseconds to wait after a file change before rebuilding (default: 3000).
- `maxFileSizeKB`: Maximum size of a single file to include (default: 1024).
- `maxTotalFiles`: Maximum number of files allowed in a build (default: 500).
- `tokenizerModel`: Model used for token counting (default: "gpt-4o").

### Profiles

Define sets of rules for different contexts.

- `name`: Unique identifier for the profile.
- `outputFile`: Path to the generated Markdown file.
- `include`: Glob patterns for files to include.
- `exclude`: Glob patterns for files to exclude.
- `forceInclude`: Specific files to include regardless of exclude patterns or `.gitignore`.
- `options`:
  - `useGitIgnore`: If true, ignores files listed in `.gitignore`.
  - `showTokenCount`: Displays token count in the output header.
  - `showFileTree`: Includes a project structure tree in the output.
  - `preamble`: Custom text instructions added to the beginning of the output file.

### Example Configuration

```json
{
  "activeProfile": "default",
  "globalSettings": {
    "debounceMs": 3000,
    "maxFileSizeKB": 1024,
    "maxTotalFiles": 500,
    "tokenizerModel": "gpt-4o"
  },
  "profiles": [
    {
      "name": "default",
      "description": "Core source files",
      "outputFile": ".context/context.md",
      "include": ["src/**/*.{ts,js,json}", "README.md"],
      "exclude": ["**/*.test.ts", "dist/**"],
      "forceInclude": [],
      "options": {
        "useGitIgnore": true,
        "removeComments": false,
        "showTokenCount": true,
        "showFileTree": true,
        "preamble": "Project context for code analysis."
      }
    }
  ]
}
```

## Commands

- `Context Builder: Init Configuration`: Creates a default configuration file.
- `Context Builder: Select Profile`: Switches the active profile.
- `Context Builder: Start Watching`: Enables auto-build on file changes.
- `Context Builder: Stop Watching`: Disables auto-build.
- `Context Builder: Build Once`: Generates the context file immediately without watching.
- `Context Builder: Copy Output Path`: Copies the absolute path of the generated context file to the clipboard.

## Status Bar

The status bar item (bottom right) shows the current state:

- **Context: Off**: Extension is idle.
- **[Profile Name] (X files)**: Watching for changes.
- **Building...**: Currently generating the context file.
