<script lang="ts">
	// The Coyote's set-up, one flow: its safety notes with a single agreement, then for each channel a steady
	// pattern raised from 0 (press and hold, or the device's own wheel) to the strongest level the user ever
	// wants (that is the channel's maximum, and a channel can be marked "not used"), then a one-line summary,
	// where the Coyote is enabled. It opens where the Coyote was connected, and from Settings to do it again.
	// It needs a real device: a preview can't be felt, so nothing can be set (and nothing is stored).
	import { onDestroy, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { hold } from '$lib/app/hold';
	import ConnectPanel from '$lib/components/ConnectPanel.svelte';
	import { channelName } from './kind';
	import SafetyNotes from './SafetyNotes.svelte';
	import type { CoyoteDeviceSession } from './session.svelte';
	import { capOf, type Channel } from './settings';

	let { session, ondone }: { session: DeviceSession; ondone: () => void } = $props();
	const app = useApp();
	const coyote = $derived(session as CoyoteDeviceSession);
	const cap = $derived(capOf(coyote.coyote.above100));

	type Step = 'safety' | Channel | 'summary';
	let step = $state<Step>(untrack(() => (coyote.coyote.agreed ? 'a' : 'safety')));
	let agreed = $state(false);
	/** The maximum found per channel (0 = not used). */
	let found = $state<Record<Channel, number>>({ a: 0, b: 0 });

	const channel = $derived(step === 'a' || step === 'b' ? step : null);
	const running = $derived(channel !== null && coyote.setup === channel && coyote.playing);
	const level = $derived(channel ? coyote[channel].base : 0);

	async function agree() {
		if (!agreed) return;
		await app.updateDevice('coyote', { agreed: true });
		step = 'a';
	}
	function next() {
		step = step === 'a' ? 'b' : 'summary';
	}
	function thisIsMax() {
		if (!channel || level <= 0) return;
		found[channel] = level;
		coyote.endSetup();
		next();
	}
	function skip() {
		if (!channel) return;
		found[channel] = 0;
		coyote.endSetup();
		next();
	}
	async function enable() {
		if (found.a <= 0 && found.b <= 0) return;
		await app.updateDevice('coyote', { maxA: found.a, maxB: found.b, enabled: true });
		ondone();
	}
	onDestroy(() => coyote.endSetup());
</script>

<div class="setup" data-step={step}>
	{#if !coyote.real}
		<p><strong>{m.coyote_setup_needs_device()}</strong></p>
		<ConnectPanel {session} compact previewOption={false} />
	{:else if step === 'safety'}
		<p class="lead">{m.setup_safety_lead()}</p>
		<SafetyNotes />
		<label class="check">
			<input type="checkbox" bind:checked={agreed} />
			<span>{m.setup_agree()}</span>
		</label>
		<div class="actions">
			<button type="button" class="btn primary" disabled={!agreed} onclick={agree}>{m.next()}</button>
		</div>
	{:else if channel}
		<h3>{channelName(channel)}</h3>
		<p>{m.coyote_setup_channel_help({ channel: channelName(channel), cap })}</p>
		{#if !running}
			<div class="actions">
				<button
					type="button"
					class="btn primary"
					disabled={coyote.playing || coyote.silencing}
					onclick={() => coyote.beginSetup(channel)}
					>{m.coyote_setup_start({ channel: channelName(channel) })}</button
				>
				<button type="button" class="btn" onclick={skip}
					>{m.coyote_setup_skip({ channel: channelName(channel) })}</button
				>
			</div>
			{#if coyote.playing && coyote.setup === null}
				<p class="note">{m.coyote_setup_stop_first()}</p>
			{/if}
		{:else}
			<div class="level">
				<button
					type="button"
					class="round"
					aria-label={m.cal_lower()}
					disabled={level <= 0}
					use:hold={() => coyote.step(channel, -1)}>−</button
				>
				<p class="value" role="status">
					<span class="val">{level}</span>
					<span class="lbl">{m.coyote_intensity()}</span>
				</p>
				<button
					type="button"
					class="round"
					aria-label={m.cal_higher()}
					disabled={level >= cap}
					use:hold={() => coyote.step(channel, 1)}>+</button
				>
			</div>
			<p class="note">{m.coyote_setup_dial_note()}</p>
			<div class="actions">
				<button type="button" class="btn primary" disabled={level <= 0} onclick={thisIsMax}
					>{m.cal_this_max()}</button
				>
			</div>
		{/if}
	{:else}
		<h3>{m.setup_summary()}</h3>
		<p>
			{m.coyote_setup_result({
				a: found.a > 0 ? String(found.a) : m.coyote_not_used(),
				b: found.b > 0 ? String(found.b) : m.coyote_not_used()
			})}
		</p>
		{#if found.a <= 0 && found.b <= 0}
			<p>{m.coyote_setup_nothing()}</p>
			<div class="actions">
				<button type="button" class="btn primary" onclick={() => (step = 'a')}
					>{m.coyote_setup_again()}</button
				>
				<button type="button" class="btn" onclick={ondone}>{m.setup_not_now()}</button>
			</div>
		{:else}
			<p class="note">{m.coyote_setup_confirm_text()}</p>
			<p class="note">{m.coyote_device_keeps()}</p>
			<div class="actions">
				<button type="button" class="btn primary" onclick={enable}>{m.coyote_enable()}</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.setup {
		display: grid;
		gap: var(--space-card);
		justify-items: start;
	}
	.setup p,
	h3 {
		margin: 0;
	}
	h3 {
		font-size: 1.1rem;
	}
	.lead {
		font-weight: 650;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.level {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 1rem;
		width: 100%;
		max-width: 22rem;
	}
	.round {
		width: 64px;
		height: 64px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: var(--surface);
		font-size: 1.8rem;
		line-height: 1;
		cursor: pointer;
		touch-action: manipulation;
		user-select: none;
	}
	.round:disabled {
		opacity: 0.4;
	}
	.value {
		display: grid;
		justify-items: center;
	}
	.val {
		font-size: 2.6rem;
		font-weight: 700;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}
	.lbl {
		font-size: 0.85rem;
		font-weight: 650;
		color: var(--soft);
	}
</style>
