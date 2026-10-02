<script lang="ts">
	// Connecting one device, in every state: not connected (connect, or look around without a device), connected (name,
	// battery, disconnect), looking around (say so, offer to connect), and after a lost connection (reconnect).
	// It says what will happen before the browser's chooser opens, and what went wrong in plain words.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import { pct } from '$lib/app/format';
	import type { DeviceSession } from '$lib/app/devices/types';

	interface Props {
		session: DeviceSession;
		/** Inside another screen: no disclaimer, no Disconnect. */
		compact?: boolean;
		/** Offer "Look around without a device" (not where a real device is needed, e.g. calibration). */
		previewOption?: boolean;
		/** Say the device's name with its state (where no heading right above says it already). */
		named?: boolean;
		/** Show the note that opentoys is independent of the makers (once per screen is enough). */
		legal?: boolean;
		onconnected?: (kind: 'device' | 'preview') => void;
	}
	let {
		session,
		compact = false,
		previewOption = true,
		named = false,
		legal = !compact,
		onconnected
	}: Props = $props();

	const devices = useApp().devices;
	const player = $derived(session);
	const unsupported = $derived(devices.bluetooth === 'unsupported');
	const previewing = $derived(player.preview && player.connection === 'connected');

	async function connect() {
		if (await player.connectBluetooth()) onconnected?.('device');
	}
	// Looking around previews every one of My devices, not only this one.
	async function lookAround() {
		if (await devices.lookAround()) onconnected?.('preview');
	}
</script>

<div class="connect">
	{#if player.real}
		<p class="state">
			{#if named}<strong>{player.kind.name()}</strong>{/if}
			<span class="note">
				{player.battery === null
					? m.device_connected()
					: m.device_connected_battery({ battery: pct(player.battery / 100) })}
			</span>
			{#if player.kind.connectedDetail?.(player)}
				<span class="note">{player.kind.connectedDetail(player)}</span>
			{/if}
		</p>
		{#if !compact}
			<div class="actions">
				<button type="button" class="btn" onclick={() => player.disconnect()}>{m.disconnect()}</button>
			</div>
		{/if}
	{:else if player.connection === 'lost'}
		<!--
			On a page, the alert at the top says what to do, with Reconnect: here only the state. In a sheet the
			alert is underneath and out of reach, so the whole warning and Reconnect are here.
		-->
		{#if compact}
			<p class="state"><strong>{m.lost_title()}</strong></p>
			{#if player.kind.lostAdvice(player)}<p>{player.kind.lostAdvice(player)}</p>{/if}
			<div class="actions">
				<button type="button" class="btn primary" disabled={player.busy} onclick={() => player.reconnect()}
					>{m.lost_reconnect()}</button
				>
			</div>
		{:else}
			<p class="state">{m.status_lost()}</p>
		{/if}
		{#if player.error}
			<p class="error" role="alert">{player.kind.errorText(player.error)}</p>
		{/if}
	{:else}
		{#if unsupported}
			<div class="unsupported" role="note">
				<p><strong>{player.kind.unsupportedTitle()}</strong></p>
				<p>{m.unsupported_body()}</p>
			</div>
		{:else}
			<ul class="before">
				{#each player.kind.connectHints() as hint (hint)}
					<li>{hint}</li>
				{/each}
			</ul>
		{/if}
		<div class="actions">
			<button type="button" class="btn primary" disabled={unsupported || player.busy} onclick={connect}>
				{player.connection === 'connecting' ? m.status_connecting() : m.connect_device()}
			</button>
			{#if previewOption && !previewing}
				<button type="button" class="btn" disabled={player.busy} onclick={lookAround}
					>{m.connect_preview()}</button
				>
			{/if}
		</div>
		{#if player.error}
			<p class="error" role="alert">{player.kind.errorText(player.error)}</p>
		{/if}
		{#if legal}<p class="faint legal">{m.legal_disclaimer()}</p>{/if}
	{/if}
</div>

<style>
	.connect {
		display: grid;
		gap: 0.7rem;
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.8rem;
		margin: 0;
	}
	.before {
		margin: 0;
		padding-left: 1.2rem;
		color: var(--soft);
	}
	.before li + li {
		margin-top: 0.3rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.actions .btn {
		white-space: normal;
		text-align: center;
	}
	.unsupported {
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 0.9rem;
		background: var(--surface);
	}
	.unsupported p {
		margin: 0;
	}
	.unsupported p + p {
		margin-top: 0.3rem;
		color: var(--soft);
	}
	.error {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 0.8rem;
		background: var(--danger-soft);
		color: var(--danger);
		font-weight: 600;
	}
	.note,
	p {
		margin: 0;
	}
	.legal {
		font-size: 0.8rem;
	}
</style>
