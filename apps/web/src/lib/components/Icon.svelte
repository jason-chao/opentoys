<script lang="ts">
	// A few line icons, drawn here (no icon font, nothing fetched). Always decorative: the text says what it is.
	type Name =
		| 'patterns'
		| 'manual'
		| 'saved'
		| 'settings'
		| 'stop'
		| 'play'
		| 'back'
		| 'lock'
		| 'bolt'
		| 'palette'
		| 'star'
		| 'globe'
		| 'close'
		| 'about'
		| 'chevron'
		| 'github';
	/** `filled` is for the star: a favourite. */
	let { name, size = 22, filled = false }: { name: Name; size?: number; filled?: boolean } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'patterns'}
		<path d="M2 12h3l2.5-6 4 12 3-9 2 3H22" />
	{:else if name === 'manual'}
		<circle cx="12" cy="12" r="3" />
		<circle cx="12" cy="12" r="7.5" opacity="0.55" />
		<path d="M12 1.5v2M12 20.5v2" />
	{:else if name === 'saved'}
		<path d="M6 3h12v18l-6-4-6 4z" />
	{:else if name === 'settings'}
		<path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
		<circle cx="16" cy="7" r="2" />
		<circle cx="10" cy="17" r="2" />
	{:else if name === 'stop'}
		<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
	{:else if name === 'play'}
		<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />
	{:else if name === 'back'}
		<path d="M15 5l-7 7 7 7" />
	{:else if name === 'lock'}
		<rect x="5" y="11" width="14" height="9" rx="2" />
		<path d="M8 11V8a4 4 0 0 1 8 0v3" />
	{:else if name === 'bolt'}
		<path d="M13 2L5 13h6l-1 9 8-11h-6z" />
	{:else if name === 'palette'}
		<path
			d="M12 3a9 9 0 1 0 0 18c1.4 0 2.2-1 2.2-2.1 0-.6-.3-1.1-.6-1.5-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 6.2 17 3 12 3z"
		/>
		<circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
		<circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
		<circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none" />
		<circle cx="17.5" cy="10" r="1" fill="currentColor" stroke="none" />
	{:else if name === 'star'}
		<path
			d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.6l6.1-.8z"
			fill={filled ? 'currentColor' : 'none'}
		/>
	{:else if name === 'globe'}
		<circle cx="12" cy="12" r="9" />
		<path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6L6 18" />
	{:else if name === 'about'}
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v6" />
		<circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
	{:else if name === 'chevron'}
		<path d="M9 5l7 7-7 7" />
	{:else if name === 'github'}
		<!-- GitHub's mark (Octicons, MIT), scaled from its 16-unit grid: it links to the source on GitHub. -->
		<path
			transform="translate(2 2) scale(1.25)"
			fill="currentColor"
			stroke="none"
			d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
		/>
	{/if}
</svg>
