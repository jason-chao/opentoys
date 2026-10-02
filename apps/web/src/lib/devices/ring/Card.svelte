<script lang="ts">
	// The ring on Control: its name, what it is doing, and one row per output (the shared OutputRow): vibration
	// and e-stim, each as a percentage. "More" opens what belongs to an output: the pattern, the full graph,
	// "intensify slowly", using e-stim or not. Free control (the touch pad, and recording) opens from the card.
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import { ITEM_BY_ID, itemsIn, presetName, SECTIONS } from '$lib/app/catalogue';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { pct } from '$lib/app/format';
	import { SECTION_TEXT } from '$lib/app/text';
	import LiveGraph from '$lib/components/LiveGraph.svelte';
	import OutputRow from '$lib/components/OutputRow.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import FreeControl from './FreeControl.svelte';
	import { playingName, RING } from './kind';
	import type { RingSession } from './session.svelte';
	import { RING_ID } from './settings';
	import { defaultParams, usesEstim } from './text';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const ring = $derived(session as RingSession);
	const connected = $derived(ring.connection === 'connected');
	const cur = $derived(ring.current);
	const preset = $derived(cur?.kind === 'preset' ? cur : null);
	const item = $derived(preset ? ITEM_BY_ID.get(preset.id) : undefined);
	const patternHasEstim = $derived(usesEstim(item, preset?.params ?? null));
	// Something is running on it that is not the set-up.
	const live = $derived(ring.active && !ring.calibrating);

	let more = $state<'vibration' | 'estim' | null>(null);
	let free = $state(false);

	const stateText = $derived.by(() => {
		if (ring.connection === 'connecting') return m.status_connecting();
		if (ring.connection === 'lost') return m.status_lost();
		if (!connected) return m.card_not_connected();
		if (ring.needsSetup) return m.setup_needed();
		if (live) return m.now_playing();
		if (ring.hasPlayed && ring.stopped && !ring.calibrating) return RING.stopText(ring.stopped);
		return m.card_ready();
	});

	// What the device as a whole needs is said once, in the card's header, with the one thing to do about it.
	// The rows below speak only of their own output.
	const blocked = $derived(!connected || ring.needsSetup);
	const deviceAction = $derived.by(() => {
		if (ring.connection === 'idle') return { label: m.status_idle(), run: () => app.connect(RING_ID) };
		if (ring.needsSetup) return { label: m.setup_to_start(), run: () => app.openSetup(RING_ID) };
		return null;
	});

	const vibStatus = $derived.by(() => {
		if (blocked) return '';
		if (!live) return m.coyote_pattern_none();
		return playingName(cur);
	});
	const vibAction = $derived.by(() => {
		if (blocked) return null;
		if (!live) return { label: m.row_choose_pattern(), run: () => (more = 'vibration') };
		return null;
	});

	// E-stim on a real ring needs its own set-up. In a preview it is shown without one.
	const estimLocked = $derived(connected && !ring.needsSetup && !ring.estimAvailable);
	const estimStatus = $derived.by(() => {
		if (blocked) return '';
		if (estimLocked) return m.ring_estim_disabled();
		if (!live) return m.coyote_pattern_none();
		// Paused after leaving the page: the note above says so, with the way back. Here it is simply off.
		if (ring.estimHeld) return m.row_off();
		if (preset)
			return !patternHasEstim
				? m.ring_estim_not_in_pattern()
				: preset.estimOn
					? m.ring_estim_on()
					: m.row_off();
		if (cur?.kind === 'mode') return m.ring_estim_recorded();
		return m.ring_estim_on();
	});
	const estimAction = $derived.by(() => {
		if (blocked) return null;
		if (estimLocked) return { label: m.setup_to_start(), run: () => app.openSetup(RING_ID, 'estim') };
		if (live && preset && patternHasEstim && !preset.estimOn)
			return { label: m.now_estim_toggle(), run: () => ring.adjust({ estimOn: true }) };
		return null;
	});

	function choose(id: string) {
		if (id === '') return ring.stop();
		const it = ITEM_BY_ID.get(id);
		if (!it) return;
		const params = defaultParams(it);
		ring.play(id, { params, estimOn: usesEstim(it, params) && ring.estimAvailable });
	}
</script>

<section class="card device" data-device={RING_ID} aria-labelledby="card-ring">
	<header>
		<div class="title">
			<h2 id="card-ring">{RING.name()}</h2>
			<p class="state" role="status">{stateText}</p>
		</div>
		{#if deviceAction}
			<button type="button" class="btn small primary free" onclick={deviceAction.run}
				>{deviceAction.label}</button
			>
		{:else if connected}
			<button type="button" class="btn small free" onclick={() => (free = true)}
				>{m.ring_free_control()}</button
			>
		{/if}
	</header>
	{#if ring.estimHeld && ring.active}
		<div class="alert" role="alert">
			<p>{m.now_estim_held()}</p>
			<button type="button" class="btn small" onclick={() => ring.adjust({ estimOn: true })}
				>{m.now_estim_resume()}</button
			>
		</div>
	{/if}
	<OutputRow
		id="vibration"
		name={m.channel_vibration()}
		status={vibStatus}
		value={ring.vibSetting === null ? null : pct(ring.vibSetting)}
		live={live ? m.row_now({ value: pct(ring.output.vibration) }) : null}
		canDown={(ring.vibSetting ?? 0) > 0}
		canUp={ring.vibSetting !== null && ring.vibSetting < 1}
		ondown={() => ring.stepVibration(-1)}
		onup={() => ring.stepVibration(1)}
		action={vibAction}
		trace={ring.trace}
		tone="ring"
		lane="first"
		onmore={connected && !ring.needsSetup ? () => (more = 'vibration') : undefined}
	/>
	<OutputRow
		id="estim"
		name={m.channel_estim()}
		status={estimStatus}
		value={ring.estimSetting === null || ring.estimHeld ? null : pct(ring.estimSetting)}
		live={live && ring.estimInUse ? m.row_now({ value: pct(ring.output.estim) }) : null}
		canDown={!ring.estimHeld && (ring.estimSetting ?? 0) > 0}
		canUp={!ring.estimHeld && ring.estimSetting !== null && ring.estimSetting < 1}
		ondown={() => ring.stepEstim(-1)}
		onup={() => ring.stepEstim(1)}
		action={estimAction}
		trace={ring.trace}
		tone="ring"
		lane="second"
		thread="--dot-ring"
		onmore={connected && !ring.needsSetup && !estimLocked ? () => (more = 'estim') : undefined}
	/>
</section>

{#if more === 'vibration'}
	<Sheet
		title={m.more_title({ device: RING.name(), output: m.channel_vibration() })}
		onclose={() => (more = null)}
	>
		<div class="more" data-more="vibration">
			<label class="pick">
				<span>{m.coyote_pattern_label()}</span>
				<select value={live && preset ? preset.id : ''} onchange={(e) => choose(e.currentTarget.value)}>
					<option value="">{live && !preset ? playingName(cur) : m.coyote_pattern_none()}</option>
					{#each SECTIONS as section (section)}
						<optgroup label={SECTION_TEXT[section].title()}>
							{#each itemsIn(section) as it (it.id)}
								<option value={it.id}>{presetName(it.id)}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
			{#if live && preset}
				<a class="link" href="{localizeHref('/pattern/')}?id={preset.id}" onclick={() => (more = null)}
					>{m.more_pattern_page()}</a
				>
			{/if}
			<p class="note">{m.start_note()}</p>
			<div class="graph">
				<LiveGraph trace={ring.trace} tone="ring" />
				<p class="legend" aria-hidden="true">
					<span><span class="key vib"></span>{m.channel_vibration()}</span>
					<span><span class="key estim"></span>{m.channel_estim()}</span>
				</p>
			</div>
			{#if live && preset}
				<div class="block">
					<label class="toggle">
						<input
							type="checkbox"
							role="switch"
							checked={preset.intensify}
							onchange={(e) => ring.adjust({ intensify: e.currentTarget.checked })}
						/>
						<span>{m.now_intensify()}</span>
					</label>
					<p class="note">{m.now_intensify_help()}</p>
				</div>
			{:else if live && cur?.kind === 'mode'}
				<p class="note">{m.now_saved_note()}</p>
			{/if}
			{#if ring.real && !ring.ring.calibration.vibDone}
				<button
					type="button"
					class="link"
					onclick={() => ((more = null), app.openSetup(RING_ID, 'vibration'))}>{m.ring_levels_offer()}</button
				>
			{/if}
			<button type="button" class="btn" disabled={!live} onclick={() => ring.stop()}>{m.ring_off()}</button>
		</div>
	</Sheet>
{:else if more === 'estim'}
	<Sheet
		title={m.more_title({ device: RING.name(), output: m.channel_estim() })}
		onclose={() => (more = null)}
	>
		<div class="more" data-more="estim">
			{#if live && preset && patternHasEstim}
				<label class="toggle">
					<input
						type="checkbox"
						role="switch"
						checked={preset.estimOn}
						onchange={(e) => ring.adjust({ estimOn: e.currentTarget.checked })}
					/>
					<span>{m.now_estim_toggle()}</span>
				</label>
			{:else if live && preset}
				<p class="note">{m.now_estim_none()}</p>
			{:else if !live}
				<p class="note">{m.ring_estim_follows()}</p>
			{/if}
			<p class="note">{m.now_estim_help({ rate: pct(ring.ring.estimRampPctS / 100) })}</p>
			<div class="graph">
				<LiveGraph trace={ring.trace} tone="ring" lane="second" />
			</div>
		</div>
	</Sheet>
{/if}

{#if free}
	<Sheet tall title={m.ring_free_control()} onclose={() => (free = false)}>
		<FreeControl {session} />
	</Sheet>
{/if}

<style>
	.device {
		padding: 0.45rem 0.7rem 0.15rem;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0 0.5rem;
		padding-bottom: 0.25rem;
	}
	.title {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.6rem;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-size: 0.95rem;
	}
	.state {
		margin: 0;
		font-size: 0.85rem;
		color: var(--soft);
	}
	.alert {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
		margin: 0 0 0.5rem;
		padding: 0.5rem 0.7rem;
		border: 2px solid var(--estim);
		border-radius: 0.8rem;
		font-size: 0.9rem;
	}
	.alert p {
		flex: 1 1 12rem;
		margin: 0;
	}
	.free {
		flex: none;
		padding: 0 0.7rem;
		font-size: 0.85rem;
	}
	.link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 0.9rem;
		font-weight: 600;
		text-align: left;
		text-decoration: underline;
		color: var(--soft);
		cursor: pointer;
	}
	.more {
		display: grid;
		gap: var(--space-card);
	}
	.more .note {
		margin: 0;
	}
	.pick {
		display: grid;
		gap: 0.25rem;
		font-weight: 650;
	}
	select {
		min-height: 48px;
		padding: 0 0.7rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--surface);
		font-weight: 500;
	}
	.legend {
		display: flex;
		gap: 1.2rem;
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--soft);
	}
	.legend > span {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.key {
		display: inline-block;
		width: 1.1rem;
		border-top: 3px solid var(--vib);
	}
	.key.estim {
		border-top: 3px dashed var(--estim);
	}
	.block {
		padding-top: var(--space-line);
		border-top: 1px solid var(--line);
	}
</style>
