// Fails when the message files drift apart: a key missing or extra in any locale, an empty message, a
// placeholder ({name}) that differs from English, or a key that no source file uses. Also a house rule for the
// copy: no semicolons (; or ；) in any message; write two sentences instead.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const APP = join(ROOT, 'apps/web');
const settings = JSON.parse(readFileSync(join(APP, 'project.inlang/settings.json'), 'utf8'));
const { baseLocale, locales } = settings;

const errors = [];
const load = (locale) => {
	const file = join(APP, 'messages', `${locale}.json`);
	try {
		const messages = JSON.parse(readFileSync(file, 'utf8'));
		delete messages.$schema;
		return messages;
	} catch (e) {
		errors.push(`${relative(ROOT, file)}: ${e.message}`);
		return {};
	}
};
const placeholders = (text) =>
	[...text.matchAll(/\{\s*(\w+)/g)]
		.map((m) => m[1])
		.sort()
		.join(',');

const base = load(baseLocale);
const baseKeys = Object.keys(base);

for (const locale of locales) {
	const messages = locale === baseLocale ? base : load(locale);
	for (const key of baseKeys) {
		if (!(key in messages)) errors.push(`${locale}: missing "${key}"`);
	}
	for (const [key, text] of Object.entries(messages)) {
		if (!(key in base)) errors.push(`${locale}: "${key}" is not in ${baseLocale}`);
		if (typeof text !== 'string' || text.trim() === '') errors.push(`${locale}: "${key}" is empty`);
		else if (/[;；]/.test(text)) errors.push(`${locale}: "${key}" has a semicolon (write two sentences)`);
		else if (key in base && placeholders(text) !== placeholders(base[key]))
			errors.push(
				`${locale}: "${key}" has placeholders {${placeholders(text)}}, ${baseLocale} has {${placeholders(base[key])}}`
			);
	}
}

// Unused keys: every key must be referenced as m.key or m['key'] somewhere in the app's source.
const GENERATED = join(APP, 'src/lib/paraglide');
const sources = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (path === GENERATED) continue;
		if (statSync(path).isDirectory()) walk(path);
		else if (/\.(svelte|ts|js)$/.test(name)) sources.push(readFileSync(path, 'utf8'));
	}
};
walk(join(APP, 'src'));
const code = sources.join('\n');
for (const key of baseKeys) {
	const used = new RegExp(`\\bm\\.${key}\\b|\\bm\\[['"\`]${key}['"\`]\\]`).test(code);
	if (!used) errors.push(`"${key}" is not used anywhere in apps/web/src`);
}

if (errors.length) {
	console.error(`Message check failed:\n  ${errors.join('\n  ')}`);
	process.exit(1);
}
console.log(`Messages OK: ${baseKeys.length} keys × ${locales.length} locales (${locales.join(', ')})`);
