<script lang="ts">
	// The ring's saved patterns (recorded in free control, or imported): play, rename, delete, export, import.
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { exportModes } from '@opentoys/core';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import type { SavedMode } from '$lib/app/storage';
	import { dateTime, duration } from '$lib/app/format';
	import { download, readJsonFile } from '$lib/app/files';
	import { downsample } from '$lib/app/waveform';
	import Waveform from '$lib/components/Waveform.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { RingSession } from './session.svelte';
	import { RING_ID } from './settings';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const player = $derived(session as RingSession);
	const modes = $derived(app.modes.filter((x) => x.device === RING_ID));

	let renaming = $state<number | null>(null);
	let newName = $state('');
	let confirmDelete = $state<number | null>(null);
	let message = $state<{ ok: boolean; text: string } | null>(null);

	function play(mode: SavedMode) {
		player.playMode(mode.id, $state.snapshot(mode));
		void goto(localizeHref('/control/'));
	}

	async function rename(id: number) {
		await app.renameMode(id, newName);
		renaming = null;
	}

	function exportSaved() {
		download(exportModes($state.snapshot(modes)), 'opentoys-saved-patterns.json');
	}

	async function importSaved(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		try {
			const result = await app.importFile(await readJsonFile(file));
			message = { ok: true, text: m.saved_imported({ count: result.modes }) };
		} catch {
			message = { ok: false, text: m.import_failed() };
		}
	}
</script>

<section aria-labelledby="mine-title">
	<h2 id="mine-title">{m.saved_mine_of({ device: player.kind.name() })}</h2>
	{#if modes.length === 0}
		<p class="note">
			{m.saved_empty()} <a href={localizeHref('/control/')}>{m.saved_empty_link()}</a>
		</p>
	{:else}
		<ul class="list">
			{#each modes as mode (mode.id)}
				<li class="item">
					<span class="thumb">
						<Waveform vib={downsample(mode.vib)} estim={downsample(mode.estim)} seconds={mode.durationS} />
					</span>
					<div class="body">
						{#if renaming === mode.id}
							<label class="rename">
								<span class="visually-hidden">{m.saved_rename_label()}</span>
								<input type="text" maxlength="40" bind:value={newName} />
							</label>
							<div class="actions">
								<button type="button" class="btn small primary" onclick={() => rename(mode.id)}
									>{m.save()}</button
								>
								<button type="button" class="btn small" onclick={() => (renaming = null)}>{m.cancel()}</button
								>
							</div>
						{:else}
							<p class="name">{mode.name}</p>
							<p class="faint small">
								{m.saved_meta({ time: duration(mode.durationS), date: dateTime(mode.createdAt) })}
							</p>
							{#if confirmDelete === mode.id}
								<p class="small">{m.saved_delete_confirm({ name: mode.name })}</p>
								<div class="actions">
									<button type="button" class="btn small danger" onclick={() => app.deleteMode(mode.id)}
										>{m.delete()}</button
									>
									<button type="button" class="btn small" onclick={() => (confirmDelete = null)}
										>{m.cancel()}</button
									>
								</div>
							{:else}
								<div class="actions">
									<button
										type="button"
										class="btn small primary"
										disabled={player.connection !== 'connected'}
										onclick={() => play(mode)}
									>
										<Icon name="play" size={16} />{m.play()}
									</button>
									<button
										type="button"
										class="btn small"
										onclick={() => {
											renaming = mode.id;
											newName = mode.name;
										}}>{m.rename()}</button
									>
									<button type="button" class="btn small" onclick={() => (confirmDelete = mode.id)}
										>{m.delete()}</button
									>
								</div>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if player.connection !== 'connected'}
			<p class="note">
				{m.saved_connect_to_play()}
				<button type="button" class="inline" onclick={() => app.connect(RING_ID)}>{m.status_idle()}</button>
			</p>
		{/if}
	{/if}
	<div class="actions files">
		<button type="button" class="btn small" disabled={modes.length === 0} onclick={exportSaved}
			>{m.saved_export()}</button
		>
		<label class="btn small">
			{m.saved_import()}
			<input class="visually-hidden" type="file" accept="application/json,.json" onchange={importSaved} />
		</label>
	</div>
	{#if message}
		<p class={message.ok ? 'ok' : 'warn'} role="status">{message.text}</p>
	{/if}
</section>

<style>
	section {
		margin-top: 1.8rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.3rem;
	}
	.list {
		display: grid;
		gap: 0.5rem;
		margin: 0.6rem 0;
		padding: 0;
		list-style: none;
	}
	.item {
		display: grid;
		grid-template-columns: 6rem 1fr;
		gap: 0.9rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: var(--surface);
	}
	.thumb {
		height: 3.4rem;
		padding: 0.25rem;
		border-radius: 0.6rem;
		background: var(--surface);
	}
	.body {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.name {
		margin: 0;
		font-weight: 700;
	}
	.small {
		margin: 0;
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.2rem;
	}
	.files {
		margin-top: 0.8rem;
	}
	.files label {
		position: relative;
	}
	.files label:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.inline {
		min-height: 44px;
		padding: 0;
		border: 0;
		background: transparent;
		font-weight: 650;
		text-decoration: underline;
		cursor: pointer;
	}
	.rename input {
		width: 100%;
		min-height: 44px;
		padding: 0 0.8rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--surface);
	}
	.ok {
		font-weight: 600;
	}
	.warn {
		color: var(--danger);
		font-weight: 600;
	}
</style>
