import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		// apps/web runs its own Vitest: SvelteKit resolves its files from the working directory.
		projects: ['packages/*']
	}
});
