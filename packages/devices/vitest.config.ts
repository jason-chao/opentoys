import { defineProject } from 'vitest/config';

export default defineProject({
	test: { name: 'devices', environment: 'node', include: ['src/**/*.test.ts'], passWithNoTests: true }
});
