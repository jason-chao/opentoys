import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { paraglideOptions } from './paraglide.config.js';

// /now/ and /manual/ became /control/: they stay as pages that forward there, for stored links and shortcuts.
const ROUTES = [
	'/',
	'/pattern/',
	'/control/',
	'/now/',
	'/manual/',
	'/saved/',
	'/settings/',
	'/settings/device/',
	'/settings/devices/',
	'/settings/playback/',
	'/settings/data/',
	'/about/',
	'/welcome/'
];

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in Svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			// Fully static: every page is prerendered, there is no server.
			adapter: adapter({ strict: true }),
			prerender: {
				// Every page, in every language (the app's own links reach most of them, but not all).
				entries: [
					'/',
					...['en', 'zh-hant', 'zh-hans'].flatMap((l) => ROUTES.map((r) => `/${l}${r}` as const))
				],
				handleMissingId: 'fail',
				handleHttpError: 'fail'
			},
			// Emitted as a <meta> tag with hashes for SvelteKit's inline bootstrap script. The server adds the
			// directives a <meta> CSP can't carry (frame-ancestors) and repeats the rest as a header.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			}
		}),

		paraglideVitePlugin(paraglideOptions),

		// Installable and offline: a service worker precaches the whole (small, static) site. Updates are
		// offered, never forced: a reload would drop the Bluetooth connection mid-session (lib/app/app.svelte.ts).
		SvelteKitPWA({
			strategies: 'generateSW',
			// The site is served at the root; SvelteKit's relative paths would register /en/sw.js.
			base: '/',
			scope: '/',
			registerType: 'prompt',
			injectRegister: false,
			includeAssets: ['favicon.svg', 'robots.txt', 'icons/apple-touch-icon.png'],
			manifest: {
				id: '/',
				name: 'opentoys',
				short_name: 'opentoys',
				description:
					'Control intimate toys over Bluetooth in your browser. Your usage history and settings stay in this browser.',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				orientation: 'portrait',
				background_color: '#0b0610',
				theme_color: '#0b0610',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
				]
			},
			workbox: {
				globPatterns: ['client/**/*.{js,css,svg,png,woff2,webmanifest,json}', 'prerendered/**/*.html'],
				// Pages are precached; nothing is fetched from anywhere else, so no runtime caching.
				navigateFallback: null,
				cleanupOutdatedCaches: true
			},
			kit: { trailingSlash: 'always', includeVersionFile: true }
		})
	]
});
