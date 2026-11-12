import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir:'tests/browser', testMatch:'*.spec.ts', fullyParallel:false, workers:1,
    timeout:60000, retries:0, reporter:'list',
    use:{baseURL:'http://127.0.0.1:5178',trace:'retain-on-failure',screenshot:'only-on-failure'},
    webServer:{command:'node scripts/browser-server.mjs',url:'http://127.0.0.1:5178',reuseExistingServer:false,gracefulShutdown:{signal:'SIGTERM',timeout:3000}}
});
