<script lang="ts">
	// The ring's page in Settings: connection, set-up (the vibration levels, e-stim), limits, and what happens
	// when the page is left. Everything about the ring, once.
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { DEFAULT_CAPS, MAX_CAPS } from '@opentoys/core';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { duration, pct } from '$lib/app/format';
	import ConnectPanel from '$lib/components/ConnectPanel.svelte';
	import type { RingSession } from './session.svelte';
	import { RING_ID, type RingSettings } from './settings';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const player = $derived(session as RingSession);
	const s = $derived(player.ring);
	const cal = $derived(player.ring.calibration);

	const set = (patch: Partial<RingSettings>) => void app.updateDevice('ring', patch);
	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

	// Raising the e-stim maximum above 80 % takes a confirmation, made in this browser (never imported).
	let confirmAbove = $state(false);
	let aboveChecked = $state(false);
	function allowAbove80() {
		set({ estimAbove80: true });
		confirmAbove = false;
		aboveChecked = false;
	}
</script>

<section class="card" id="connection" aria-labelledby="h-connection">
	<h2 id="h-connection">{m.settings_connection()}</h2>
	<ConnectPanel {session} legal={false} />
</section>

<section class="card" id="setup" aria-labelledby="h-setup">
	<h2 id="h-setup">{m.settings_setup()}</h2>
	{#if !s.agreed}
		<p><strong>{m.setup_needed()}</strong> {m.ring_setup_needed_help()}</p>
	{:else}
		<p>
			{cal.vibDone
				? m.cal_vib_done({ floor: pct(cal.vibFloor), max: pct(cal.vibMax) })
				: m.cal_vib_default({ floor: pct(cal.vibFloor), max: pct(cal.vibMax) })}
		</p>
		<p>
			{#if s.estimUnlocked}
				<strong>{m.cal_estim_on()}</strong>
				{m.cal_estim_range({ floor: pct(cal.estimFloor), max: pct(cal.estimMax) })}
			{:else}
				<strong>{m.cal_estim_off()}</strong>
				{m.cal_estim_off_help()}
			{/if}
		</p>
	{/if}
	{#if !player.real}<p class="note">{m.cal_needs_device()}</p>{/if}
	<div class="row">
		<button type="button" class="btn small" disabled={!player.real} onclick={() => app.openSetup(RING_ID)}
			>{s.agreed && cal.vibDone ? m.coyote_setup_again() : m.setup_start()}</button
		>
		{#if s.agreed && !s.estimUnlocked}
			<button
				type="button"
				class="btn small"
				disabled={!player.real || s.capEstim <= 0}
				onclick={() => app.openSetup(RING_ID, 'estim')}>{m.cal_estim_start()}</button
			>
		{:else if s.estimUnlocked}
			<button type="button" class="btn small" onclick={() => set({ estimUnlocked: false })}
				>{m.cal_estim_turn_off()}</button
			>
		{/if}
	</div>
</section>

<section class="card" id="limits" aria-labelledby="h-limits">
	<h2 id="h-limits">{m.settings_limits()}</h2>
	<label class="field">
		<span class="top"
			><span>{m.limit_estim_rise()}</span><span class="out"
				>{m.limit_per_second({ value: pct(s.estimRampPctS / 100) })}</span
			></span
		>
		<input
			type="range"
			min="5"
			max="50"
			step="5"
			value={s.estimRampPctS}
			oninput={(e) => set({ estimRampPctS: num(e) })}
		/>
		<span class="note">{m.limit_estim_rise_help()}</span>
	</label>
	<label class="field">
		<span class="top"><span>{m.limit_warmup()}</span><span class="out">{duration(s.warmupS)}</span></span>
		<input
			type="range"
			min="0"
			max="30"
			step="1"
			value={s.warmupS}
			oninput={(e) => set({ warmupS: num(e) })}
		/>
		<span class="note">{m.limit_warmup_help()}</span>
	</label>
	<label class="field">
		<span class="top"><span>{m.limit_cap_vib()}</span><span class="out">{pct(s.capVib)}</span></span>
		<input
			type="range"
			min="0.1"
			max={MAX_CAPS.vib}
			step="0.05"
			value={s.capVib}
			oninput={(e) => set({ capVib: num(e) })}
		/>
	</label>
	<label class="field">
		<span class="top"><span>{m.limit_cap_estim()}</span><span class="out">{pct(s.capEstim)}</span></span>
		<input
			type="range"
			min="0"
			max={s.estimAbove80 ? MAX_CAPS.estim : DEFAULT_CAPS.estim}
			step="0.05"
			value={s.capEstim}
			oninput={(e) => set({ capEstim: num(e) })}
		/>
		<span class="note">{m.limit_caps_help()}</span>
	</label>

	<div class="above" role="group" aria-label={m.limit_above80()}>
		{#if s.estimAbove80}
			<p><strong>{m.limit_above80_on()}</strong></p>
			<button type="button" class="btn small" onclick={() => set({ estimAbove80: false })}
				>{m.limit_above80_off()}</button
			>
		{:else if !confirmAbove}
			<p class="note">{m.limit_above80_help({ max: pct(DEFAULT_CAPS.estim) })}</p>
			<button type="button" class="btn small" onclick={() => (confirmAbove = true)}
				>{m.limit_above80()}</button
			>
		{:else}
			<div class="confirm">
				<p><strong>{m.limit_above80()}</strong></p>
				<p>{m.limit_above80_text()}</p>
				<p class="note">{m.own_risk()}</p>
				<label class="check">
					<input type="checkbox" bind:checked={aboveChecked} />
					<span>{m.limit_above80_box()}</span>
				</label>
				<div class="row">
					<button type="button" class="btn small primary" disabled={!aboveChecked} onclick={allowAbove80}
						>{m.limit_above80_confirm()}</button
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
	<p class="note">{m.leave_lede()}</p>
	<div class="choices" role="radiogroup" aria-labelledby="h-leave">
		<label class="choice">
			<input
				type="radio"
				name="leave"
				checked={!s.stopEverythingOnLeave}
				onchange={() => set({ stopEverythingOnLeave: false })}
			/>
			<span><strong>{m.leave_estim_only()}</strong><span class="note">{m.leave_estim_only_help()}</span></span
			>
		</label>
		<label class="choice">
			<input
				type="radio"
				name="leave"
				checked={s.stopEverythingOnLeave}
				onchange={() => set({ stopEverythingOnLeave: true })}
			/>
			<span><strong>{m.leave_everything()}</strong></span>
		</label>
	</div>
	<p class="note">{m.leave_closed_note()}</p>
</section>

<p class="more-link"><a href="{localizeHref('/about/')}#safety">{m.settings_safety()}</a></p>
