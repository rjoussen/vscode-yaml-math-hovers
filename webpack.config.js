// @ts-check
'use strict';

const path = require('path');

// The bundle runs unchanged in the desktop and the web extension host. Resolve the production builds of
// dependencies in every mode, since the development builds of micromark need Node's `debug` package.
const conditionNames = ['webpack', 'production', 'worker', 'browser'];

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'webworker',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  devtool: 'nosources-source-map',
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // Sources import TypeScript files with `.js` extensions, as Node16 module resolution requires.
    extensionAlias: { '.js': ['.ts', '.js'] },
    alias: {
      // MathJax selects its default font through a package import map that webpack does not resolve.
      '#default-font/svg/default.js': require.resolve('@mathjax/mathjax-tex-font/js/svg/default.js'),
    },
    byDependency: {
      esm: { conditionNames: ['import', 'module', ...conditionNames] },
      commonjs: { conditionNames: ['require', 'module', ...conditionNames] },
    },
  },
  module: {
    rules: [{ test: /\.ts$/, exclude: /node_modules/, use: 'ts-loader' }],
  },
  performance: {
    hints: false,
  },
};
