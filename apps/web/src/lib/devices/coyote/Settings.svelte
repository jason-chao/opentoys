<script lang="ts">
	// The Coyote's page in Settings: connection, set-up, limits (a maximum can only be lowered here: it is
	// raised by setting up again, where the new level is felt), and what happens when the page is left.
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import ConnectPanel from '$lib/components/ConnectPanel.svelte';
	import { channelName } from './kind';
	import type { CoyoteDeviceSession } from './session.svelte';
	import {
		CHANNELS,
		COYOTE_ID,
		DEFAULT_CAP,
		INTENSITY_MAX,
		maxOf,
		type Channel,
		type CoyoteSettings
	} from './settings';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const coyote = $derived(session as CoyoteDeviceSession);
	const s = $derived(coyote.coyote);

	const set = (patch: Partial<CoyoteSettings>) => void app.updateDevice('coyote', patch);
	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

	// Only ever down: applied when the slider is let go, and the slider then ends at the new maximum.
	function lower(ch: Channel, value: number) {
		const v = Math.min(maxOf(s, ch), Math.max(0, Math.trunc(value)));
		set(ch === 'a' ? { maxA: v } : { maxB: v });
	}

	// Allowing a maximum above 100 takes a confirmation, made in this browser (never imported).
	let confirmAbove = $state(false);
	let aboveChecked = $state(false);
	function allowAbove() {
		set({ above100: true });
		confirmAbove = false;
		aboveChecked = false;
	}
	const max = (v: number) => (v > 0 ? String(v) : m.coyote_not_used());
</script>

<section class="card" id="connection" aria-labelledby="h-connection">
	<h2 id="h-connection">{m.settings_connection()}</h2>
	<ConnectPanel {session} legal={false} />
</section>

<section class="card" id="setup" aria-labelledby="h-setup">
	<h2 id="h-setup">{m.settings_setup()}</h2>
	<p>
		{#if s.enabled}
			<!-- The maximums are under Limits, right below: not said twice. -->
			<strong>{m.coyote_enabled()}</strong>
		{:else}
			<strong>{m.coyote_disabled()}</strong>
			{m.coyote_disabled_help()}
		{/if}
	</p>
	{#if !coyote.real}<p class="note">{m.coyote_setup_needs_device()}</p>{/if}
	<div class="row">
		<button type="button" class="btn small" disabled={!coyote.real} onclick={() => app.openSetup(COYOTE_ID)}
			>{s.enabled ? m.coyote_setup_again() : m.setup_start()}</button
		>
		{#if s.enabled}
			<button type="button" class="btn small" onclick={() => set({ enabled: false })}
				>{m.coyote_disable()}</button
			>
		{/if}
	</div>
</section>

<section class="card" id="limits" aria-labelledby="h-limits">
	<h2 id="h-limits">{m.settings_limits()}</h2>
	{#each CHANNELS as ch (ch)}
		<label class="field">
			<span class="top"
				><span>{m.coyote_limit_max({ channel: channelName(ch) })}</span><span class="out"
					>{max(maxOf(s, ch))}</span
				></span
			>
			<input
				type="range"
				min="0"
				max={maxOf(s, ch)}
				step="1"
				value={maxOf(s, ch)}
				disabled={maxOf(s, ch) === 0}
				onchange={(e) => lower(ch, num(e))}
			/>
		</label>
	{/each}
	<p class="note">{m.coyote_limit_max_help()}</p>
	<p class="note">{m.coyote_device_keeps()}</p>

	<label class="field">
		<span class="top"><span>{m.coyote_limit_burst()}</span><span class="out">+{s.burst}</span></span>
		<input type="range" min="1" max="50" step="1" value={s.burst} oninput={(e) => set({ burst: num(e) })} />
		<span class="note">{m.coyote_limit_burst_help()}</span>
	</label>

	<div class="above" role="group" aria-label={m.coyote_above100()}>
		{#if s.above100}
			<p><strong>{m.coyote_above100_on()}</strong></p>
			<button type="button" class="btn small" onclick={() => set({ above100: false })}
				>{m.coyote_above100_off()}</button
			>
		{:else if !confirmAbove}
			<p class="note">{m.coyote_above100_help({ max: DEFAULT_CAP, top: INTENSITY_MAX })}</p>
			<button type="button" class="btn small" onclick={() => (confirmAbove = true)}
				>{m.coyote_above100()}</button
			>
		{:else}
			<div class="confirm">
				<p><strong>{m.coyote_above100()}</strong></p>
				<p>{m.coyote_above100_text()}</p>
				<p class="note">{m.own_risk()}</p>
				<label class="check">
					<input type="checkbox" bind:checked={aboveChecked} />
					<span>{m.coyote_above100_box()}</span>
				</label>
				<div class="row">
					<button type="button" class="btn small primary" disabled={!aboveChecked} onclick={allowAbove}
						>{m.coyote_above100_confirm()}</button
					>
					<button
						type="button"
						class="btn small"
						onclick={() => ((confirmAbove = false), (aboveChecked = false))}>{m.cancel()}</button
					>
				</div>
			</div>
		{/if}
	</div>
</section>

<section class="card" id="leaving" aria-labelledby="h-leave">
	<h2 id="h-leave">{m.settings_leave()}</h2>
	<p>{m.coyote_leave()}</p>
</section>

<p class="more-link"><a href="{localizeHref('/about/')}#safety">{m.settings_safety()}</a></p>
