import { defineConfig, devices } from '@playwright/test';

// Runs against the static build, as it will be served. Phone first (Android Chrome), then desktop.
export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	// The device tests go through whole set-ups, step by step, on two projects at once.
	timeout: 60_000,
	reporter: process.env.CI ? 'github' : 'list',
	webServer: {
		command: 'npm run build && npm run preview -- --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
	use: { baseURL: 'http://localhost:4173' },
	projects: [
		{ name: 'phone', use: { ...devices['Pixel 7'] } },
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }
	]
});
