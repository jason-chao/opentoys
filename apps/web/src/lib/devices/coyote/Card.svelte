<script lang="ts">
	// The Coyote on Control: its name, what it is doing, and one row per channel (the shared OutputRow). "More"
	// on a row opens what belongs to that channel: its pattern, the full graph, the burst, random pauses and slow
	// increase, and turning it off.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { duration } from '$lib/app/format';
	import Icon from '$lib/components/Icon.svelte';
	import LiveGraph from '$lib/components/LiveGraph.svelte';
	import OutputRow from '$lib/components/OutputRow.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import { patternName, PATTERNS } from './catalogue';
	import { channelName, COYOTE } from './kind';
	import type { CoyoteDeviceSession } from './session.svelte';
	import { CHANNELS, COYOTE_ID, PAUSE_SHORTEST_S, type Channel, type CoyoteSettings } from './settings';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const coyote = $derived(session as CoyoteDeviceSession);
	const s = $derived(coyote.coyote);
	const connected = $derived(coyote.connection === 'connected');

	let more = $state<Channel | null>(null);
	// The dot by each row: its thread's colour in the orb, in a shade that stands out on the card.
	const THREAD: Record<Channel, string> = { a: '--dot-a', b: '--dot-b' };

	const set = (patch: Partial<CoyoteSettings>) => void app.updateDevice('coyote', patch);
	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

	const stateText = $derived.by(() => {
		if (coyote.connection === 'connecting') return m.status_connecting();
		if (coyote.connection === 'lost') return m.status_lost();
		if (!connected) return m.card_not_connected();
		if (coyote.needsSetup) return m.setup_needed();
		if (coyote.silencing) return m.coyote_stopping();
		if (coyote.playing) return m.now_playing();
		// After leaving the page the note below says what happened: the state doesn't say it again.
		if (coyote.hasPlayed && coyote.stopped && !coyote.leftPage) return COYOTE.stopText(coyote.stopped);
		return m.card_ready();
	});

	// What the device as a whole needs is said once, in the card's header, with the one thing to do about it.
	// The rows below speak only of their own output.
	const blocked = $derived(!connected || coyote.needsSetup);
	const deviceAction = $derived.by(() => {
		if (coyote.connection === 'idle') return { label: m.status_idle(), run: () => app.connect(COYOTE_ID) };
		if (coyote.needsSetup) return { label: m.setup_to_start(), run: () => app.openSetup(COYOTE_ID) };
		return null;
	});

	/** What a channel's row says under its name. */
	function status(ch: Channel): string {
		const v = coyote[ch];
		if (blocked) return '';
		if (coyote.maxima[ch] === 0) return m.row_not_used();
		if (v.pattern === null) return m.coyote_pattern_none();
		const name = patternName(v.pattern);
		if (v.burst) return m.row_status_with({ name, state: m.coyote_burst_on({ value: v.intensity }) });
		if (v.pausing) return m.row_status_with({ name, state: m.coyote_pausing() });
		return name;
	}

	/** What stands in the way of stepping a channel, as the one thing to do about it. */
	function action(ch: Channel) {
		if (blocked) return null;
		if (coyote.maxima[ch] === 0) return { label: m.setup_to_start(), run: () => app.openSetup(COYOTE_ID) };
		if (coyote[ch].pattern === null) return { label: m.row_choose_pattern(), run: () => (more = ch) };
		return null;
	}

	function choose(channel: Channel, id: string) {
		if (id === '') coyote.off(channel);
		else coyote.play([channel], id);
	}

	/** The burst lasts as long as the button is held (pointer or key). */
	function burstButton(node: HTMLButtonElement, channel: Channel) {
		const on = () => coyote.burst(channel, true);
		const off = () => coyote.burst(channel, false);
		const down = (e: PointerEvent) => {
			if (e.button !== 0 || node.disabled) return;
			try {
				node.setPointerCapture(e.pointerId);
			} catch {
				// a pointer that is already gone: the release still ends the burst
			}
			on();
		};
		const key = (e: KeyboardEvent) => {
			if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
				e.preventDefault();
				on();
			}
		};
		const keyUp = (e: KeyboardEvent) => {
			if (e.key === ' ' || e.key === 'Enter') off();
		};
		node.addEventListener('pointerdown', down);
		node.addEventListener('keydown', key);
		node.addEventListener('keyup', keyUp);
		for (const type of ['pointerup', 'pointercancel', 'blur']) node.addEventListener(type, off);
		return { destroy: off };
	}
</script>

<section class="card device" data-device={COYOTE_ID} aria-labelledby="card-coyote">
	<header>
		<div class="title">
			<h2 id="card-coyote">{COYOTE.name()}</h2>
			<p class="state" role="status">{stateText}</p>
		</div>
		{#if deviceAction}
			<button type="button" class="btn small primary act" onclick={deviceAction.run}
				>{deviceAction.label}</button
			>
		{/if}
	</header>
	{#if coyote.leftPage && !coyote.playing}
		<p class="alert" role="alert">{m.coyote_left_page()}</p>
	{/if}
	{#each CHANNELS as ch (ch)}
		{@const v = coyote[ch]}
		{@const max = coyote.maxima[ch]}
		{@const live = v.pattern !== null && coyote.canUse(ch)}
		<OutputRow
			id={ch}
			name={channelName(ch)}
			status={status(ch)}
			value={blocked ? null : String(v.intensity)}
			canDown={live && v.base > 0}
			canUp={live && v.base < max}
			ondown={() => coyote.step(ch, -1)}
			onup={() => coyote.step(ch, 1)}
			action={action(ch)}
			trace={coyote.traces[ch]}
			tone="estim"
			thread={THREAD[ch]}
			onmore={connected && !coyote.needsSetup && max > 0 ? () => (more = ch) : undefined}
		/>
	{/each}
</section>

{#if more}
	{@const ch = more}
	{@const v = coyote[ch]}
	{@const max = coyote.maxima[ch]}
	{@const live = v.pattern !== null}
	<Sheet
		title={m.more_title({ device: COYOTE.name(), output: channelName(ch) })}
		onclose={() => (more = null)}
	>
		<div class="more" data-more={ch}>
			<label class="pick">
				<span>{m.coyote_pattern_label()}</span>
				<select
					value={v.pattern ?? ''}
					disabled={!coyote.canUse(ch)}
					onchange={(e) => choose(ch, e.currentTarget.value)}
				>
					<option value="">{m.coyote_pattern_none()}</option>
					{#each PATTERNS as p (p.id)}
						<option value={p.id}>{patternName(p.id)}</option>
					{/each}
				</select>
			</label>

			<p class="status" role="status">
				{#if !live}
					{m.coyote_pick_first()}
				{:else if v.dial !== null}
					{m.coyote_dial_note({ value: v.dial })}
				{:else if v.added > 0}
					{m.coyote_added_note({ set: v.base, added: v.added })}
				{:else if v.base === 0}
					{m.coyote_at_zero()}
				{:else}
					{m.coyote_playing_at({ value: v.intensity })} · {m.coyote_of_max({ max })}
				{/if}
			</p>

			<div class="graph">
				<LiveGraph trace={coyote.traces[ch]} tone="estim" />
				<p class="legend" aria-hidden="true">
					<span><span class="key"></span>{m.coyote_lane_strength()}</span>
					<span><span class="key dashed"></span>{m.coyote_intensity()}</span>
				</p>
			</div>

			<button
				type="button"
				class="btn burst"
				class:held={v.burst}
				disabled={!live || v.base <= 0 || !coyote.canUse(ch)}
				use:burstButton={ch}
			>
				<Icon name="bolt" size={18} />{m.coyote_burst_hold({ extra: s.burst })}
			</button>

			<div class="block">
				<label class="toggle">
					<input
						type="checkbox"
						role="switch"
						checked={v.pauses}
						disabled={!live}
						onchange={(e) => coyote.setPauses(ch, e.currentTarget.checked)}
					/>
					<span>{m.coyote_pauses()}</span>
				</label>
				<p class="note">
					{m.coyote_pauses_help({ min: PAUSE_SHORTEST_S, work: s.pauseWorkS, pause: s.pausePauseS })}
				</p>
				<details>
					<summary>{m.more_timing()}</summary>
					<label class="slider">
						<span class="slider-top"
							><span>{m.coyote_pauses_work()}</span><span class="out">{duration(s.pauseWorkS)}</span></span
						>
						<input
							type="range"
							min="10"
							max="120"
							step="5"
							value={s.pauseWorkS}
							oninput={(e) => set({ pauseWorkS: num(e) })}
						/>
					</label>
					<label class="slider">
						<span class="slider-top"
							><span>{m.coyote_pauses_pause()}</span><span class="out">{duration(s.pausePauseS)}</span></span
						>
						<input
							type="range"
							min="10"
							max="120"
							step="5"
							value={s.pausePauseS}
							oninput={(e) => set({ pausePauseS: num(e) })}
						/>
					</label>
				</details>
			</div>

			<div class="block">
				<label class="toggle">
					<input
						type="checkbox"
						role="switch"
						checked={v.increase}
						disabled={!live}
						onchange={(e) => coyote.setIncrease(ch, e.currentTarget.checked)}
					/>
					<span>{m.coyote_increase()}</span>
				</label>
				<p class="note">{m.coyote_increase_help({ every: s.increaseEveryS, upTo: s.increaseUpTo })}</p>
				<details>
					<summary>{m.more_timing()}</summary>
					<label class="slider">
						<span class="slider-top"
							><span>{m.coyote_increase_every()}</span><span class="out">{duration(s.increaseEveryS)}</span
							></span
						>
						<input
							type="range"
							min="10"
							max="300"
							step="10"
							value={s.increaseEveryS}
							oninput={(e) => set({ increaseEveryS: num(e) })}
						/>
					</label>
					<label class="slider">
						<span class="slider-top"
							><span>{m.coyote_increase_upto()}</span><span class="out">+{s.increaseUpTo}</span></span
						>
						<input
							type="range"
							min="1"
							max="50"
							step="1"
							value={s.increaseUpTo}
							oninput={(e) => set({ increaseUpTo: num(e) })}
						/>
					</label>
					<p class="note">{m.coyote_more_both()}</p>
				</details>
			</div>

			<button type="button" class="btn" disabled={!live} onclick={() => coyote.off(ch)}
				>{m.coyote_channel_off({ channel: channelName(ch) })}</button
			>
		</div>
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
	.act {
		flex: none;
		padding: 0 0.8rem;
	}
	.alert {
		margin: 0 0 0.5rem;
		padding: 0.5rem 0.7rem;
		border: 2px solid var(--estim);
		border-radius: 0.8rem;
		font-size: 0.9rem;
	}
	.more {
		display: grid;
		gap: var(--space-card);
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
	.status {
		margin: 0;
		color: var(--soft);
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
		border-top: 3px solid var(--estim);
	}
	.key.dashed {
		border-top: 3px dashed var(--text);
	}
	.burst {
		min-height: 56px;
		white-space: normal;
		touch-action: none;
		user-select: none;
	}
	.burst.held {
		border-color: var(--estim);
		background: color-mix(in srgb, var(--estim) 22%, transparent);
	}
	.block {
		padding-top: var(--space-line);
		border-top: 1px solid var(--line);
	}
	.block .note {
		margin: 0.1rem 0 0;
	}
	summary {
		display: flex;
		align-items: center;
		min-height: 44px;
		font-size: 0.9rem;
		font-weight: 650;
		color: var(--soft);
		cursor: pointer;
	}
	.slider {
		display: grid;
		margin-top: 0.3rem;
	}
	.slider-top {
		display: flex;
		justify-content: space-between;
		font-weight: 600;
	}
	.out {
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
</style>
