<script lang="ts">
	// The devices' status, under the header on every screen: one item per device in My devices, with its full
	// name and its state. Tapping does the obvious thing for that state: connect, reconnect, set up, or open the
	// device's page. One line under it says when what plays is a preview.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { pct } from '$lib/app/format';

	const app = useApp();
	const devices = app.devices;

	type State = 'idle' | 'connecting' | 'lost' | 'preview' | 'setup' | 'connected';
	const stateOf = (d: DeviceSession): State =>
		d.connection === 'connecting'
			? 'connecting'
			: d.connection === 'lost'
				? 'lost'
				: d.connection !== 'connected'
					? 'idle'
					: d.preview
						? 'preview'
						: d.needsSetup
							? 'setup'
							: 'connected';

	function text(d: DeviceSession): string {
		switch (stateOf(d)) {
			case 'connecting':
				return m.status_connecting();
			case 'lost':
				return m.status_lost();
			case 'preview':
				return m.status_preview_short();
			case 'setup':
				return m.setup_needed();
			case 'connected':
				return d.battery === null
					? m.device_connected()
					: m.strip_connected_battery({ battery: pct(d.battery / 100) });
			default:
				return m.status_idle();
		}
	}

	function act(d: DeviceSession) {
		const id = d.kind.id;
		switch (stateOf(d)) {
			case 'idle':
			case 'preview':
				return app.connect(id);
			case 'lost':
				return void d.reconnect();
			case 'setup':
				return app.openSetup(id);
			case 'connected':
				return app.navigate(`/settings/device/?id=${id}`);
		}
	}
</script>

{#if devices.mine.length}
	<div class="strip" role="group" aria-label={m.strip_label()}>
		{#each devices.mine as d (d.kind.id)}
			{@const st = stateOf(d)}
			<button type="button" class="item {st}" data-device={d.kind.id} data-state={st} onclick={() => act(d)}>
				<span class="dot" aria-hidden="true"></span>
				<span class="text">
					<span class="name">{d.kind.name()}</span>
					<span class="state">{text(d)}</span>
				</span>
			</button>
		{/each}
	</div>
	{#if devices.sessions.some((d) => d.connection === 'connected' && d.preview)}
		<p class="preview" role="note">{m.preview_notice()}</p>
	{/if}
{/if}

<style>
	.strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.3rem 0.4rem;
		padding: 0.4rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--bg);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 48px;
		padding: 0.25rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 0.9rem;
		background: transparent;
		font-size: 0.82rem;
		line-height: 1.25;
		text-align: left;
		color: var(--soft);
		cursor: pointer;
	}
	/* The full name, always: it wraps where it must, it is never cut. */
	.text {
		display: grid;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dot {
		flex: none;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		border: 2px solid var(--faint);
	}
	.name {
		font-weight: 700;
		color: var(--text);
	}
	.connected .dot,
	.preview .dot,
	.setup .dot {
		border-color: var(--accent);
		background: var(--accent);
	}
	.preview .dot {
		background: transparent;
	}
	.setup .state {
		font-weight: 700;
		color: var(--accent);
	}
	.lost {
		border-color: var(--danger);
	}
	.lost .dot {
		border-color: var(--danger);
	}
	.lost .state {
		font-weight: 700;
		color: var(--danger);
	}
	p.preview {
		margin: 0;
		padding: 0.35rem 1rem;
		border-bottom: 1px dashed var(--line);
		font-size: 0.85rem;
		color: var(--soft);
	}
	@media (min-width: 900px) {
		.strip,
		p.preview {
			padding-inline: 1.5rem;
		}
	}
</style>
