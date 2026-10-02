<script lang="ts">
	// The ring's set-up, one flow: its safety notes with a single agreement, then vibration (the lowest level
	// felt and the comfortable maximum, on one screen), then "Also set up e-stim?", and a one-line summary. It
	// opens where the ring was connected, and from Settings to do it again. It needs a real ring: a preview
	// can't be felt, so nothing can be set (and nothing is stored).
	//
	// What can be skipped: the vibration levels (the ring then runs on the default ones) and e-stim (it stays
	// off). What cannot: the agreement. Without it nothing starts on a real ring.
	import { onDestroy, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { pct } from '$lib/app/format';
	import { hold } from '$lib/app/hold';
	import ConnectPanel from '$lib/components/ConnectPanel.svelte';
	import SafetyNotes from './SafetyNotes.svelte';
	import type { CalibrationChannel, RingSession } from './session.svelte';

	interface Props {
		session: DeviceSession;
		/** 'estim': straight to e-stim. 'vibration': the vibration levels only. Otherwise the whole flow. */
		part?: string;
		ondone: () => void;
	}
	let { session, part, ondone }: Props = $props();

	const app = useApp();
	const player = $derived(session as RingSession);
	const ring = $derived(player.ring);

	type Step = 'safety' | 'vibration' | 'ask' | 'estim' | 'summary';
	// E-stim always begins with the safety notes. So does everything before they were agreed to.
	let step = $state<Step>(untrack(() => (part === 'estim' || !player.ring.agreed ? 'safety' : 'vibration')));
	let agreed = $state(false);
	/** The safety notes were shown in this flow, and where they lead. E-stim never starts without them. */
	let sawSafety = false;
	let after: Step = untrack(() => (part === 'estim' ? 'estim' : 'vibration'));
	/** Where the level being found stands, and the lowest level felt once it is marked. */
	let level = $state(0);
	let floor = $state<number | null>(null);
	let started = $state(false);
	/** What was found for e-stim, kept until it is enabled on the summary. */
	let estim = $state<{ floor: number; max: number } | null>(null);

	const channel = $derived<CalibrationChannel | null>(
		step === 'vibration' ? 'vibration' : step === 'estim' ? 'estim' : null
	);
	const cap = $derived(channel === 'estim' ? ring.capEstim : ring.capVib);
	const name = $derived(channel === 'estim' ? m.channel_estim() : m.channel_vibration());
	const sending = $derived(channel === 'estim' ? player.output.estim : player.output.vibration);

	// It was offered: after this it only opens by itself again while the agreement is missing.
	$effect(() => {
		if (!untrack(() => ring.setupOffered)) void app.updateDevice('ring', { setupOffered: true });
	});

	async function agree() {
		if (!agreed) return;
		await app.updateDevice('ring', { agreed: true });
		sawSafety = true;
		begin(after);
	}
	function toEstim() {
		if (sawSafety) return begin('estim');
		player.endCalibration();
		after = 'estim';
		agreed = false;
		step = 'safety';
	}
	function begin(next: Step) {
		player.endCalibration();
		level = 0;
		floor = null;
		started = false;
		step = next;
	}
	function set(v: number) {
		if (!channel) return;
		level = Math.round(Math.min(cap, Math.max(floor ?? 0, v)) * 100) / 100;
		player.calibrate(channel, level);
		started = true;
	}
	function feelIt() {
		if (level > 0) floor = level;
	}
	async function thatsMax() {
		if (floor === null || !channel) return;
		const max = Math.max(level, floor, 0.02);
		const lowest = floor;
		player.endCalibration();
		const c = $state.snapshot(ring.calibration);
		if (channel === 'vibration') {
			await app.updateDevice('ring', { calibration: { ...c, vibFloor: lowest, vibMax: max, vibDone: true } });
			begin(part === 'vibration' ? 'summary' : 'ask');
		} else {
			estim = { floor: lowest, max };
			begin('summary');
		}
	}
	function skipVibration() {
		begin(part === 'vibration' ? 'summary' : 'ask');
	}
	async function finish() {
		// E-stim is enabled here, with what was just found on the ring, and only here.
		if (estim) {
			const c = $state.snapshot(ring.calibration);
			await app.updateDevice('ring', {
				calibration: { ...c, estimFloor: estim.floor, estimMax: estim.max, estimDone: true },
				estimUnlocked: true
			});
		}
		ondone();
	}
	onDestroy(() => player.endCalibration());
</script>

<div class="setup" data-step={step}>
	{#if !player.real}
		<p><strong>{m.cal_needs_device()}</strong></p>
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
		<h3>{name}</h3>
		<!-- The instruction for the stage at hand only: once the lowest level is marked, the line below says the rest. -->
		{#if floor === null}
			<p>{channel === 'estim' ? m.ring_setup_estim_help() : m.ring_setup_vib_help()}</p>
		{/if}
		{#if !started}
			<div class="actions">
				<button type="button" class="btn primary" onclick={() => set(0)}>{m.cal_start()}</button>
				{#if channel === 'vibration'}
					<button type="button" class="btn" onclick={skipVibration}>{m.welcome_skip_cal()}</button>
				{:else}
					<button type="button" class="btn" onclick={() => begin('summary')}>{m.setup_not_now()}</button>
				{/if}
			</div>
		{:else}
			<div class="level">
				<button
					type="button"
					class="round"
					aria-label={m.cal_lower()}
					disabled={level <= (floor ?? 0)}
					use:hold={() => set(level - 0.01)}>−</button
				>
				<p class="value" role="status">
					<span class="val">{pct(level)}</span>
					<span class="lbl">{m.cal_sending({ channel: name, level: pct(sending) })}</span>
				</p>
				<button
					type="button"
					class="round"
					aria-label={m.cal_higher()}
					disabled={level >= cap}
					use:hold={() => set(level + 0.01)}>+</button
				>
			</div>
			<p class="note">
				{floor === null
					? m.setup_hold_hint()
					: m.ring_setup_floor_marked({ floor: pct(floor), cap: pct(cap) })}
			</p>
			{#if channel === 'estim'}
				<p class="note">{m.cal_estim_slow({ rate: pct(ring.estimRampPctS / 100) })}</p>
			{/if}
			<div class="actions">
				{#if floor === null}
					<button type="button" class="btn primary" disabled={level <= 0} onclick={feelIt}
						>{m.cal_feel_it()}</button
					>
				{:else}
					<button type="button" class="btn primary" onclick={thatsMax}>{m.cal_this_max()}</button>
				{/if}
			</div>
		{/if}
	{:else if step === 'ask'}
		<h3>{m.ring_setup_ask()}</h3>
		<p>{m.ring_setup_ask_help()}</p>
		<div class="actions">
			<button type="button" class="btn primary" onclick={toEstim}>{m.cal_estim_start()}</button>
			<button type="button" class="btn" onclick={() => begin('summary')}>{m.setup_not_now()}</button>
		</div>
	{:else}
		<h3>{m.setup_summary()}</h3>
		<ul class="summary">
			<li>
				{ring.calibration.vibDone
					? m.cal_vib_done({ floor: pct(ring.calibration.vibFloor), max: pct(ring.calibration.vibMax) })
					: m.cal_vib_default({ floor: pct(ring.calibration.vibFloor), max: pct(ring.calibration.vibMax) })}
			</li>
			<li>
				{#if estim}
					{m.cal_estim_result({ floor: pct(estim.floor), max: pct(estim.max) })}
				{:else if ring.estimUnlocked}
					{m.cal_estim_on()}
				{:else}
					{m.cal_estim_off()}
				{/if}
			</li>
		</ul>
		<div class="actions">
			<button type="button" class="btn primary" onclick={finish}
				>{estim ? m.cal_estim_turn_on() : m.done()}</button
			>
			{#if estim}
				<button type="button" class="btn" onclick={ondone}>{m.setup_not_now()}</button>
			{/if}
		</div>
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
		color: var(--soft);
		font-variant-numeric: tabular-nums;
	}
	.summary {
		display: grid;
		gap: var(--space-line);
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
