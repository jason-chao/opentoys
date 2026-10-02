// Back from a page to the list it was opened from (a pattern → Patterns, a Settings page → the hub).
//
// When the user came from that list, Back goes back in history: the browser then restores the list as it was
// left (the device shown, the section and filter in its URL, the scroll position). When they came from
// somewhere else (a link, a reload, Control's "pattern page" link), there is no such entry to return to, and
// Back is a plain link to the list.

/** Just the path of a URL or path, without query, hash or a trailing "index". */
const pathOf = (url: string): string => {
	const path = url.replace(/[?#].*$/, '');
	return path.endsWith('/') ? path : `${path}/`;
};

/**
 * Whether Back should go back in history instead of following its link: only when the page before this one
 * was the very list the link leads to.
 */
export function backUsesHistory(previous: string | null | undefined, target: string): boolean {
	return !!previous && pathOf(previous) === pathOf(target);
}
