import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { htmlLang } from '$lib/i18n/locales';

// Runs only while prerendering (the site is static): renders each page in the locale of its URL.
export const handle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', htmlLang[locale])
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});
