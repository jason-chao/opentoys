<script lang="ts">
	// "Back" to the list a page was opened from: through history when the user came from there (so the list
	// is as they left it: device, section, filter, scroll), a plain link otherwise (lib/app/back.ts).
	import { backUsesHistory } from '$lib/app/back';
	import { useApp } from '$lib/app/app.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		href: string;
		label: string;
		/** Before following the plain link (e.g. show the right device's list). */
		onfollow?: () => void;
	}
	let { href, label, onfollow }: Props = $props();
	const app = useApp();

	function go(e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		if (backUsesHistory(app.previousPath, new URL(href, location.href).pathname)) {
			e.preventDefault();
			history.back();
		} else onfollow?.();
	}
</script>

<!-- In the capture phase, so it runs before the router sees the click (which would follow the link). -->
<a class="back" {href} onclickcapture={go}><Icon name="back" size={18} />{label}</a>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 44px;
		font-weight: 600;
		text-decoration: none;
		color: var(--soft);
	}
</style>
