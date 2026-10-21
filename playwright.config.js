// @ts-check
const { defineConfig } = require('@playwright/test');

const PORT = 47213;

module.exports = defineConfig({
  testDir: 'tests/web',
  testMatch: ['**/makan-*.spec.js'],
  timeout: 30000,
  globalSetup: require.resolve('./tests/support/global-setup.js'),
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:' + PORT,
    browserName: 'chromium'
  },
  // Static server (Whisper later needs http, not file://)
  webServer: {
    command: 'node tests/support/static-server.js',
    url: 'http://127.0.0.1:' + PORT + '/index.html',
    reuseExistingServer: true,
    timeout: 15000
  }
});
