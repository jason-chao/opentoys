// Everything opentoys keeps lives here, in the browser's IndexedDB: settings, saved modes and the journal
// (the usage history). Saved modes and journal entries say which kind of device they belong to; those from
// before that was recorded are the legacy kind's (the ring).
// Nothing leaves the device; export/import go through a file the user saves or opens.
import { exportModes, importAny, type ExportJson, type Mode } from '@opentoys/core';
import { REGISTRY } from './devices/registry.ts';
import { importedSettings, sanitizeSettings, type Settings } from './settings.ts';

export { importedSettings };

export const DB_NAME = 'opentoys';
const DB_VERSION = 1;
export const EXPORT_FORMAT = 'opentoys-export/1';

export interface SavedMode extends Mode {
	id: number;
	createdAt: number;
	/** The kind of device it plays on (a registered id). */
	device: string;
}

export interface JournalEntry {
	id: number;
	/** The kind of device it played on (a registered id). */
	device: string;
	/** Start time (ms since epoch). */
	at: number;
	/** What played, in the device's own terms (the ring: a preset id, 'manual' or 'mode:<id>'; the Coyote: its
	 * pattern ids). */
	what: string;
	durationS: number;
	/** Why it ended (a stop reason). */
	ended: string;
}

export interface ExportFile {
	format: typeof EXPORT_FORMAT;
	exportedAt: string;
	settings: Settings;
	/** Saved modes in the reference implementation's format, so the two apps can swap them. Each also says which device it is
	 * for (`device`, which the reference implementation ignores). */
	modes: ExportJson;
	journal: Omit<JournalEntry, 'id'>[];
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});

const done = (tx: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = tx.onerror = () => reject(tx.error);
	});

export class Storage {
	private constructor(private readonly db: IDBDatabase) {}

	static open(factory: IDBFactory = indexedDB): Promise<Storage> {
		return new Promise((resolve, reject) => {
			const r = factory.open(DB_NAME, DB_VERSION);
			r.onupgradeneeded = () => {
				const db = r.result;
				db.createObjectStore('kv');
				db.createObjectStore('modes', { keyPath: 'id', autoIncrement: true });
				db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at');
			};
			r.onsuccess = () => resolve(new Storage(r.result));
			r.onerror = () => reject(r.error);
			r.onblocked = () => reject(new Error('the database is open in another tab'));
		});
	}

	close(): void {
		this.db.close();
	}

	private store(name: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
		return this.db.transaction(name, mode).objectStore(name);
	}

	async getSettings(): Promise<Settings> {
		return sanitizeSettings(await req(this.store('kv').get('settings')));
	}

	async saveSettings(settings: Settings): Promise<Settings> {
		const clean = sanitizeSettings(settings);
		await req(this.store('kv', 'readwrite').put(clean, 'settings'));
		return clean;
	}

	async listModes(): Promise<SavedMode[]> {
		const all = await req(this.store('modes').getAll() as IDBRequest<SavedMode[]>);
		return all.map((m) => ({ ...m, device: REGISTRY.of(m.device).id }));
	}

	async saveMode(mode: Mode, device: string = REGISTRY.legacy.id): Promise<SavedMode> {
		const [clean] = importAny(exportModes([mode]).modes); // validated like an imported mode
		const record = { ...clean!, createdAt: Date.now(), device: REGISTRY.of(device).id };
		const id = await req(this.store('modes', 'readwrite').add(record));
		return { ...record, id: id as number };
	}

	async renameMode(id: number, name: string): Promise<void> {
		const tx = this.db.transaction('modes', 'readwrite');
		const store = tx.objectStore('modes');
		const mode = (await req(store.get(id))) as SavedMode | undefined;
		if (mode) store.put({ ...mode, name: name.trim().slice(0, 40) || mode.name });
		await done(tx);
	}

	async deleteMode(id: number): Promise<void> {
		await req(this.store('modes', 'readwrite').delete(id));
	}

	async addJournal(entry: Omit<JournalEntry, 'id'>): Promise<number> {
		return (await req(this.store('journal', 'readwrite').add(entry))) as number;
	}

	/** Newest first. Entries written by older versions may carry more fields (a check-in): they are dropped. */
	async listJournal(): Promise<JournalEntry[]> {
		const all = (await req(this.store('journal').getAll())) as JournalEntry[];
		return all
			.map(({ id, device, at, what, durationS, ended }) => ({
				id,
				device: REGISTRY.of(device).id,
				at,
				what,
				durationS,
				ended
			}))
			.sort((a, b) => b.at - a.at);
	}

	async deleteJournalEntry(id: number): Promise<void> {
		await req(this.store('journal', 'readwrite').delete(id));
	}

	async exportAll(): Promise<ExportFile> {
		const [settings, modes, journal] = await Promise.all([
			this.getSettings(),
			this.listModes(),
			this.listJournal()
		]);
		return {
			format: EXPORT_FORMAT,
			exportedAt: new Date().toISOString(),
			settings,
			modes: withDevices(exportModes(modes), modes),
			journal: journal.map(({ device, at, what, durationS, ended }) => ({
				device,
				at,
				what,
				durationS,
				ended
			}))
		};
	}

	/**
	 * An opentoys export (settings replaced, modes and journal added), or any mode file the reference implementation accepts
	 * (modes added). Returns how many modes and journal entries were added. Throws on anything unreadable.
	 *
	 * A file never enables anything that needs a confirmation in this browser (settings.ts, importedSettings).
	 * Files from before devices were recorded are read as the ring's.
	 */
	async importFile(data: unknown): Promise<{ modes: number; journal: number; settings: boolean }> {
		const isExport = data !== null && typeof data === 'object' && (data as Obj).format === EXPORT_FORMAT;
		const file = isExport ? (data as Obj) : null;
		// An export with no saved patterns is still a good file (settings and history).
		const modes = file && noModes(file.modes) ? [] : importAny(file ? file.modes : data);
		const journal = file && Array.isArray(file.journal) ? file.journal.flatMap(sanitizeJournal) : [];
		// What this browser has now: 18 or over is what the person importing confirmed here, not what the file
		// says, and a file never raises a limit that is set here.
		const current = file ? await this.getSettings() : null;
		const tx = this.db.transaction(['kv', 'modes', 'journal'], 'readwrite');
		const now = Date.now();
		const devices = modeDevices(file ? file.modes : data);
		modes.forEach((m, i) =>
			tx.objectStore('modes').add({ ...m, createdAt: now, device: REGISTRY.of(devices[i]).id })
		);
		for (const j of journal) tx.objectStore('journal').add(j);
		if (file)
			tx.objectStore('kv').put(
				importedSettings(file.settings, REGISTRY, current?.adult ?? false, current ?? undefined),
				'settings'
			);
		await done(tx);
		return { modes: modes.length, journal: journal.length, settings: !!file };
	}

	/** Remove every stored thing: the database and the remembered language. */
	async deleteEverything(factory: IDBFactory = indexedDB): Promise<void> {
		this.db.close();
		await req(factory.deleteDatabase(DB_NAME));
		try {
			localStorage.clear();
		} catch {
			// no storage access: nothing stored there either
		}
	}
}

type Obj = Record<string, unknown>;

/** The exported modes, each with the device it is for. */
function withDevices(json: ExportJson, modes: readonly SavedMode[]): ExportJson {
	return { ...json, modes: json.modes.map((mode, i) => ({ ...mode, device: modes[i]?.device })) };
}

/** The device each mode of a file says it is for, in the file's order (null where it doesn't say). */
function modeDevices(x: unknown): (string | null)[] {
	const list = Array.isArray(x) ? x : x && typeof x === 'object' ? (x as Obj).modes : null;
	if (!Array.isArray(list)) return [];
	return list.map((item) => {
		const device = item && typeof item === 'object' ? (item as Obj).device : null;
		return typeof device === 'string' ? device : null;
	});
}

function noModes(x: unknown): boolean {
	if (x === undefined || x === null) return true;
	const list = Array.isArray(x) ? x : (x as Obj).modes;
	return Array.isArray(list) && list.length === 0;
}

function sanitizeJournal(j: unknown): Omit<JournalEntry, 'id'>[] {
	if (!j || typeof j !== 'object') return [];
	const { device, at, what, durationS, ended } = j as Obj;
	if (typeof at !== 'number' || !Number.isFinite(at) || typeof what !== 'string') return [];
	return [
		{
			device: REGISTRY.of(typeof device === 'string' ? device : null).id,
			at,
			what: what.slice(0, 80),
			durationS: typeof durationS === 'number' && Number.isFinite(durationS) ? Math.max(0, durationS) : 0,
			ended: typeof ended === 'string' ? ended.slice(0, 40) : ''
		}
	];
}
