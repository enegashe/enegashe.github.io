const path = require('path');
const Dotenv = require('dotenv-webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true, // optional: cleans dist on each build
  },
  plugins: [
    new Dotenv(),
    new HtmlWebpackPlugin({
      template: './html/index.html', // your main HTML file
    }),
    // Copy the static folder to dist
    new CopyWebpackPlugin({
      patterns: [
        { from: 'html', to: 'html' },
        { from: 'static', to: 'static' },
        { from: 'css', to: 'css' },
      ],
    }),
  ],
};