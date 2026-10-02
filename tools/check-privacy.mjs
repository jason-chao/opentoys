// Nothing we ship may reach another origin. Scans the source and the built site for URLs, and checks that
// every built page carries the CSP. Strings that are never fetched are allowed by exact pattern only.
// The runtime guarantee is the CSP (connect-src 'self'); Playwright also asserts no request leaves the origin.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BUILD = join(ROOT, 'apps/web/build');
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'`<>)\]}]+/g;
const TEXT = /\.(ts|js|mjs|svelte|css|html|json|svg|txt|webmanifest|md|yaml|yml|conf|sh)$|(^|\/)Dockerfile$/;

// [path prefix (relative to the repo), URL prefix, why it is harmless]
const ALLOWED = [
	['', 'http://www.w3.org/', 'XML/SVG namespace identifier'],
	['', 'http://localhost', 'local development'],
	['', 'http://127.0.0.1', 'local development'],
	['apps/web/messages/', 'https://inlang.com/schema/', 'JSON schema id for editors; not shipped'],
	['apps/web/project.inlang/', 'https://inlang.com/schema/', 'JSON schema id for editors; not shipped'],
	['apps/web/build/_app/', 'https://svelte.dev/e/', "Svelte's error-message links; text only"],
	['apps/web/build/_app/', 'https://paraglidejs.com/errors', "Paraglide's error-message links; text only"],
	[
		'apps/web/build/_app/',
		'https://example.com',
		'URL parsing base (URLPattern polyfill, Paraglide); never fetched'
	],
	['apps/web/build/workbox-', 'https://bit.ly/wb-precache', "Workbox's error-message link; text only"],
	['apps/web/build/_app/', 'http://example.com', 'URL parsing base (Paraglide); never fetched'],
	// Self-hosted fonts ship with their licence text (SIL OFL 1.1), which names the licence and the font
	// projects. Exact URLs, only in the fonts folders; never fetched.
	...['apps/web/static/fonts/', 'apps/web/build/fonts/'].flatMap((path) =>
		['http://scripts.sil.org/OFL', 'https://github.com/sharanda/manrope'].map((url) => [
			path,
			url,
			'font licence text (OFL.txt); never fetched'
		])
	),
	[
		'apps/web/build/_app/',
		'http://fallback.com',
		"Paraglide's origin outside a browser (prerender); never fetched"
	],
	// The one outward link: About's "Source code on GitHub". A link the user taps (no referrer); the page never
	// fetches it. Exact URL, in the About page and the build only.
	...['apps/web/src/routes/about/', 'apps/web/build/'].map((path) => [
		path,
		'https://github.com/jason-chao/opentoys',
		'the link to the source code on About; never fetched'
	])
];

const SCAN = [
	'packages',
	'apps/web/src',
	'apps/web/static',
	'apps/web/messages',
	'apps/web/project.inlang/settings.json',
	'apps/web/vite.config.ts',
	'deploy'
];
const SKIP = new Set(['node_modules', 'paraglide', '.svelte-kit']);

const files = [];
const walk = (path) => {
	if (!existsSync(path)) return;
	if (statSync(path).isDirectory()) {
		for (const name of readdirSync(path)) if (!SKIP.has(name)) walk(join(path, name));
	} else if (TEXT.test(path)) files.push(path);
};
SCAN.forEach((p) => walk(join(ROOT, p)));
const built = existsSync(BUILD);
if (built) walk(BUILD);

const bad = [];
for (const file of files) {
	const rel = relative(ROOT, file);
	for (const [url] of readFileSync(file, 'utf8').matchAll(URL_RE)) {
		const ok = ALLOWED.some(([path, prefix]) => rel.startsWith(path) && url.startsWith(prefix));
		if (!ok) bad.push(`${rel}: ${url}`);
	}
}

if (built) {
	const pages = files.filter((f) => f.startsWith(BUILD) && f.endsWith('.html'));
	if (pages.length === 0) bad.push('apps/web/build: no pages');
	for (const page of pages) {
		const csp = readFileSync(page, 'utf8').match(
			/http-equiv="content-security-policy" content="([^"]+)"/
		)?.[1];
		if (!csp || !csp.includes("default-src 'self'") || !csp.includes("connect-src 'self'"))
			bad.push(`${relative(ROOT, page)}: missing or weak Content-Security-Policy`);
	}
}

if (bad.length) {
	console.error(`Privacy check failed (external URLs or missing CSP):\n  ${bad.join('\n  ')}`);
	process.exit(1);
}
console.log(
	`Privacy OK: ${files.length} files scanned${built ? ', build included' : ' (no build found: source only)'}`
);
