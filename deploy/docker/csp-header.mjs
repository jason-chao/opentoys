// Prints an nginx add_header line with the site's Content-Security-Policy: the policy SvelteKit put in each
// page's <meta>, with the inline-script hashes of every page merged, plus frame-ancestors (not allowed in a
// <meta>). The header and the meta then say the same thing, and both are enforced.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: csp-header.mjs <build dir>');

const pages = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path);
		else if (name.endsWith('.html')) pages.push(path);
	}
};
walk(root);

const directives = new Map();
for (const page of pages) {
	const csp = readFileSync(page, 'utf8').match(/http-equiv="content-security-policy" content="([^"]+)"/)?.[1];
	if (!csp) continue;
	for (const part of csp.split(';')) {
		const [name, ...values] = part.trim().split(/\s+/);
		if (!name) continue;
		const set = directives.get(name) ?? new Set();
		values.forEach((v) => set.add(v));
		directives.set(name, set);
	}
}
if (!directives.has('default-src')) throw new Error(`no CSP <meta> found in ${root}`);
directives.set('frame-ancestors', new Set(["'none'"]));

const policy = [...directives].map(([name, values]) => [name, ...values].join(' ')).join('; ');
console.log(`add_header Content-Security-Policy "${policy}" always;`);
