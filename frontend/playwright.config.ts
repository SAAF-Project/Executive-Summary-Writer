import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 10000 },
  use: { baseURL, ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL, trace: "retain-on-failure" },
  reporter: "list",
  webServer: { command: `npm run dev -- --port ${new URL(baseURL).port || "3000"}`, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60000 },
});
