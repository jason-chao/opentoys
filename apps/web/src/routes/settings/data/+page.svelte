<script lang="ts">
	// Settings → Your data: export, import, delete everything. All of it lives in this browser only.
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import { download, readJsonFile } from '$lib/app/files';
	import BackLink from '$lib/components/BackLink.svelte';
	import '$lib/styles/settings.css';

	const app = useApp();

	let confirmWipe = $state(false);
	let wipeChecked = $state(false);
	let dataMessage = $state<{ ok: boolean; text: string } | null>(null);

	async function exportAll() {
		download(await app.exportAll(), `opentoys-${new Date().toISOString().slice(0, 10)}.json`);
	}
	async function importAll(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		try {
			const r = await app.importFile(await readJsonFile(file));
			dataMessage = { ok: true, text: m.data_imported({ modes: r.modes, history: r.journal }) };
		} catch {
			dataMessage = { ok: false, text: m.import_failed() };
		}
	}
	async function wipe() {
		await app.deleteEverything();
		confirmWipe = false;
		await goto(localizeHref('/welcome/'), { replaceState: true });
	}
</script>

<svelte:head>
	<title>{m.settings_data()} · opentoys</title>
</svelte:head>

<div class="page settings">
	<BackLink href={localizeHref('/settings/')} label={m.nav_settings()} />
	<h1>{m.settings_data()}</h1>
	<section class="card" id="data">
		<p>{m.data_lede()}</p>
		{#if app.storageFailed}<p class="warn">{m.data_storage_failed()}</p>{/if}
		<div class="row">
			<button type="button" class="btn small" onclick={exportAll}>{m.data_export()}</button>
			<label class="btn small file">
				{m.data_import()}
				<input class="visually-hidden" type="file" accept="application/json,.json" onchange={importAll} />
			</label>
		</div>
		<p class="note">{m.data_import_note()}</p>
		{#if dataMessage}<p class={dataMessage.ok ? 'ok' : 'warn'} role="status">{dataMessage.text}</p>{/if}
	</section>
	<section class="card" id="delete">
		{#if !confirmWipe}
			<button type="button" class="btn small danger" onclick={() => (confirmWipe = true)}
				>{m.data_delete_all()}</button
			>
		{:else}
			<div class="confirm" role="group" aria-label={m.data_delete_all()}>
				<p><strong>{m.data_delete_confirm_title()}</strong></p>
				<p>{m.data_delete_confirm_text()}</p>
				<label class="check">
					<input type="checkbox" bind:checked={wipeChecked} />
					<span>{m.data_delete_confirm_box()}</span>
				</label>
				<div class="row">
					<button type="button" class="btn small danger" disabled={!wipeChecked} onclick={wipe}
						>{m.data_delete_now()}</button
					>
					<button
						type="button"
						class="btn small"
						onclick={() => ((confirmWipe = false), (wipeChecked = false))}>{m.cancel()}</button
					>
				</div>
			</div>
		{/if}
	</section>
</div>
