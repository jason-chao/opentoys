import { defineProject, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
	viteConfig,
	defineProject({
		test: { name: 'web', environment: 'node', include: ['src/**/*.test.ts'] }
	})
);
