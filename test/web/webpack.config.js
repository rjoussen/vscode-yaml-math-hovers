// @ts-check
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = {
  mode: 'none',
  target: 'webworker',
  entry: './test/web/index.ts',
  output: {
    path: path.resolve(__dirname, '..', '..', 'out', 'web'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [{ test: /\.ts$/, exclude: /node_modules/, use: 'ts-loader' }],
  },
};
