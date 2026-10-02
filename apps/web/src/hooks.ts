import type { Reroute } from '@sveltejs/kit';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

// /en/…, /zh-hant/… and /zh-hans/… all render the same routes. The bare root has no locale and goes to the
// language picker, which forwards the visitor to their language.
export const reroute: Reroute = ({ url }) => (url.pathname === '/' ? '/lang/' : deLocalizeUrl(url).pathname);
