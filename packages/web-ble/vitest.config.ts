import { defineProject } from 'vitest/config';

export default defineProject({
	test: { name: 'web-ble', environment: 'node', include: ['src/**/*.test.ts'], passWithNoTests: true }
});
