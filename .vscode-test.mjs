import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder: './test/fixtures',
  // CI also tests the oldest version that `engines.vscode` allows.
  version: process.env.VSCODE_VERSION ?? 'stable',
  // The YAML extension must provide `registerHoverTransformer`; point this at a checkout that does.
  extensionDevelopmentPath: ['.', process.env.VSCODE_YAML_PATH ?? '../vscode-yaml'],
  mocha: {
    ui: 'bdd',
    timeout: 20_000,
  },
});
