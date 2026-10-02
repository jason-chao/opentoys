<script lang="ts">
	// Free control of the ring: set vibration and e-stim directly (the touch pad, or the two sliders), and
	// record that as a saved pattern. A mode of the ring's card on Control.
	import { onDestroy, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { MIN_S, type Recording } from '@opentoys/core';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { clock, duration, pct } from '$lib/app/format';
	import type { RingSession } from './session.svelte';
	import { RING_ID } from './settings';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const player = $derived(session as RingSession);
	const unlocked = $derived(player.estimAvailable);

	// The sliders start at what is being sent right now (read once, when it opens): where free control was
	// left, or the level a pattern is at this moment. The first touch takes over from there.
	const round = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
	const start = untrack(() => {
		if (!player.active || player.calibrating) return { vib: 0, estim: 0 };
		const cur = player.current;
		if (cur?.kind === 'manual') return { vib: cur.vib, estim: cur.estim };
		return { vib: round(player.output.vibration), estim: player.estimInUse ? round(player.output.estim) : 0 };
	});
	let vib = $state(start.vib);
	let estim = $state(start.estim);
	// When output ends (Stop, a lost link), the levels here go back to 0 with it.
	let wasActive = untrack(() => player.active);
	$effect(() => {
		const active = player.active;
		if (wasActive && !active) {
			vib = 0;
			estim = 0;
		}
		wasActive = active;
	});

	function send() {
		player.setManual(vib, unlocked ? estim : 0);
	}

	// The touch pad: vertical position = vibration (top = 100 %).
	let pad = $state<HTMLDivElement>();
	let dragging = false;
	function fromPointer(e: PointerEvent) {
		if (!pad) return;
		const box = pad.getBoundingClientRect();
		vib = Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - box.top) / box.height)) * 100) / 100;
		send();
	}
	function padKey(e: KeyboardEvent) {
		const step = { ArrowUp: 0.05, ArrowDown: -0.05, PageUp: 0.2, PageDown: -0.2 }[e.key];
		if (step === undefined) return;
		e.preventDefault();
		vib = Math.round(Math.min(1, Math.max(0, vib + step)) * 100) / 100;
		send();
	}

	// ----- recording --------------------------------------------------------------------------------------------
	let recElapsed = $state(0);
	let recTimer: ReturnType<typeof setInterval> | undefined;
	let taken = $state<Recording | null>(null);
	let name = $state('');
	let saved = $state<string | null>(null);

	function startRec() {
		taken = null;
		saved = null;
		player.startRecording();
		recElapsed = 0;
		recTimer = setInterval(() => (recElapsed = player.session.recorder.elapsedS), 250);
	}
	function stopRec() {
		clearInterval(recTimer);
		taken = player.takeRecording();
		name = m.manual_default_name({ time: clock(taken.durationS) });
	}
	async function save() {
		if (!taken || !taken.longEnough) return;
		const mode = await app.saveMode(
			{
				name: name.trim() || m.manual_default_name({ time: clock(taken.durationS) }),
				periodMs: taken.periodMs,
				vib: taken.vib,
				estim: taken.estim,
				durationS: taken.durationS
			},
			RING_ID
		);
		saved = mode?.name ?? null;
		taken = null;
	}
	$effect(() => {
		// Recording ends with the output (stop, link lost).
		if (!player.recording) clearInterval(recTimer);
	});
	onDestroy(() => clearInterval(recTimer));
</script>

<div class="free">
	<p class="note">{m.manual_lede()}</p>
	<div class="grid">
		<div
			class="pad"
			bind:this={pad}
			role="slider"
			tabindex="0"
			aria-label={m.manual_pad_label()}
			aria-orientation="vertical"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(vib * 100)}
			aria-valuetext={pct(vib)}
			onkeydown={padKey}
			onpointerdown={(e) => {
				dragging = true;
				pad?.setPointerCapture(e.pointerId);
				fromPointer(e);
			}}
			onpointermove={(e) => dragging && fromPointer(e)}
			onpointerup={() => (dragging = false)}
			onpointercancel={() => (dragging = false)}
		>
			<div class="fill" style="height: {vib * 100}%"></div>
			<div class="pad-text" aria-hidden="true">
				<span class="pad-val">{pct(vib)}</span>
				<span>{m.channel_vibration()}</span>
			</div>
			<span class="pad-hint" aria-hidden="true">{m.manual_pad_hint()}</span>
		</div>

		<div class="controls">
			<label class="slider">
				<span class="top"><span>{m.channel_vibration()}</span><span class="out">{pct(vib)}</span></span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					bind:value={vib}
					aria-valuetext={pct(vib)}
					oninput={send}
				/>
			</label>
			<label class="slider">
				<span class="top"
					><span>{m.channel_estim()}</span><span class="out">{unlocked ? pct(estim) : m.readout_off()}</span
					></span
				>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					bind:value={estim}
					disabled={!unlocked}
					aria-valuetext={pct(estim)}
					oninput={send}
				/>
			</label>
			<p class="note sending">
				{m.manual_sending({
					vib: pct(player.output.vibration),
					estim: player.estimInUse ? pct(player.output.estim) : m.readout_off()
				})}
			</p>
		</div>
	</div>

	<section class="rec" aria-labelledby="rec-title">
		<h3 id="rec-title">{m.manual_record_title()}</h3>
		<p class="note">{m.manual_record_help({ min: duration(MIN_S) })}</p>
		{#if player.recording}
			<p class="rec-live" role="status">
				<span class="dot" aria-hidden="true"></span>{m.manual_recording({ time: clock(recElapsed) })}
			</p>
			<button type="button" class="btn small" onclick={stopRec}>{m.manual_record_stop()}</button>
		{:else if taken}
			{#if taken.longEnough}
				<label class="name">
					<span>{m.manual_name_label()}</span>
					<input type="text" maxlength="40" bind:value={name} />
				</label>
				<div class="row">
					<button type="button" class="btn small primary" onclick={save}>{m.manual_save()}</button>
					<button type="button" class="btn small" onclick={() => (taken = null)}>{m.manual_discard()}</button>
				</div>
			{:else}
				<p class="warn" role="alert">{m.manual_too_short({ min: duration(MIN_S) })}</p>
				<button type="button" class="btn small" onclick={startRec}>{m.manual_record_start()}</button>
			{/if}
		{:else}
			<button type="button" class="btn small" onclick={startRec}>{m.manual_record_start()}</button>
			{#if saved}
				<p class="ok" role="status">
					{m.manual_saved({ name: saved })} <a href={localizeHref('/saved/')}>{m.manual_to_saved()}</a>
				</p>
			{/if}
		{/if}
	</section>
</div>

<style>
	.free {
		display: grid;
		gap: var(--space-card);
	}
	.free .note {
		margin: 0;
	}
	.grid {
		display: grid;
		gap: 0.8rem;
	}
	.pad {
		position: relative;
		height: 30svh;
		min-height: 11rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 1.4rem;
		background: var(--surface);
		touch-action: none;
		cursor: ns-resize;
	}
	.fill {
		position: absolute;
		inset: auto 0 0;
		background: linear-gradient(180deg, var(--vib), var(--vib-fill));
		opacity: 0.8;
	}
	.pad-text {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		font-weight: 650;
		pointer-events: none;
	}
	.pad-val {
		font-size: 2.6rem;
		font-weight: 300;
		font-variant-numeric: tabular-nums;
	}
	.pad-hint {
		position: absolute;
		top: 0.7rem;
		left: 0;
		right: 0;
		text-align: center;
		font-size: 0.8rem;
		color: var(--soft);
	}
	.pad:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 3px;
	}
	.controls {
		display: grid;
		gap: 0.3rem;
	}
	.slider {
		display: grid;
	}
	.top {
		display: flex;
		justify-content: space-between;
		font-weight: 650;
	}
	.out {
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.rec {
		display: grid;
		gap: var(--space-line);
		justify-items: start;
		padding-top: var(--space-card);
		border-top: 1px solid var(--line);
	}
	.rec h3 {
		margin: 0;
		font-size: 1rem;
	}
	.rec p {
		margin: 0;
	}
	.rec-live {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--danger);
	}
	.name {
		display: grid;
		gap: 0.3rem;
		width: 100%;
		font-weight: 600;
	}
	.name input {
		min-height: 44px;
		padding: 0 0.8rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--surface);
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.warn {
		color: var(--danger);
		font-weight: 600;
	}
	.ok {
		font-weight: 600;
	}
	@media (min-width: 560px) {
		.grid {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}
</style>
