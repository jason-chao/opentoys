// Paraglide options, shared by the Vite plugin (vite.config.ts) and `npm run check`
// (scripts/compile-messages.mjs), so type-checking always sees messages compiled the same way.
/** @type {import('@inlang/paraglide-js').CompilerOptions} */
export const paraglideOptions = {
	project: './project.inlang',
	outdir: './src/lib/paraglide',
	emitTsDeclarations: true,
	// The locale comes from the URL prefix only; the bare root picks one in the browser (routes/lang).
	strategy: ['url', 'baseLocale'],
	// Every page lives under a locale prefix: /en/…, /zh-hant/…, /zh-hans/…. The bare root (/) is not
	// localized; it only sends the visitor on to their language (see routes/lang).
	urlPatterns: [
		{
			pattern: '/:path(.*)?',
			localized: [
				['en', '/en/:path(.*)?'],
				['zh-Hant', '/zh-hant/:path(.*)?'],
				['zh-Hans', '/zh-hans/:path(.*)?']
			]
		}
	],
	trailingSlash: 'always'
};
