import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_COYOTE } from '$lib/devices/coyote/settings';
import { EXPORT_FORMAT, importedSettings, Storage } from './storage';

const RING = 'dragon-s1';

const mode = (name: string) => ({
	name,
	periodMs: 100,
	vib: [0, 0.5, 1],
	estim: [0, 0.2, 0],
	durationS: 0.3
});

let factory: IDBFactory;
let db: Storage;
beforeEach(async () => {
	factory = new IDBFactory();
	db = await Storage.open(factory);
});

describe('Storage (IndexedDB)', () => {
	it('starts with default settings and stores changes sanitised', async () => {
		expect((await db.getSettings()).adult).toBe(false);
		const now = await db.getSettings();
		const saved = await db.saveSettings({ ...now, adult: true, ring: { ...now.ring, capEstim: 5 } });
		expect(saved.ring.capEstim).toBe(0.8);
		expect((await db.getSettings()).adult).toBe(true);
	});

	it('saves, renames and deletes patterns', async () => {
		const a = await db.saveMode(mode('First'));
		await db.saveMode(mode('Second'));
		expect((await db.listModes()).map((m) => m.name)).toEqual(['First', 'Second']);
		await db.renameMode(a.id, '  Renamed  ');
		await db.deleteMode((await db.listModes())[1].id);
		expect((await db.listModes()).map((m) => m.name)).toEqual(['Renamed']);
	});

	it('keeps the history newest first', async () => {
		const first = await db.addJournal({ device: RING, at: 1000, what: 'wave', durationS: 60, ended: 'user' });
		await db.addJournal({ device: RING, at: 2000, what: 'manual', durationS: 5, ended: 'page_hidden' });
		const list = await db.listJournal();
		expect(list.map((j) => j.what)).toEqual(['manual', 'wave']);
		await db.deleteJournalEntry(first);
		expect(await db.listJournal()).toHaveLength(1);
	});

	it('reads entries from older versions and files without their check-in', async () => {
		// An entry as it was stored when sessions ended with "How was it?", before entries said which device.
		const old = { at: 1, what: 'wave', durationS: 9, ended: 'user', checkIn: { answer: 'good', note: 'x' } };
		await db.addJournal(old as never);
		const [entry] = await db.listJournal();
		expect(entry).toEqual({ id: entry.id, device: RING, at: 1, what: 'wave', durationS: 9, ended: 'user' });
		expect((await db.exportAll()).journal).toEqual([
			{ device: RING, at: 1, what: 'wave', durationS: 9, ended: 'user' }
		]);

		const other = await Storage.open(new IDBFactory());
		await other.importFile({ format: EXPORT_FORMAT, settings: {}, modes: [], journal: [old] });
		expect(await other.listJournal()).toEqual([
			{ id: expect.any(Number), device: RING, at: 1, what: 'wave', durationS: 9, ended: 'user' }
		]);
	});

	it('exports everything and imports it again elsewhere', async () => {
		const now = await db.getSettings();
		await db.saveSettings({ ...now, adult: true, ring: { ...now.ring, warmupS: 7 } });
		await db.saveMode(mode('Mine'));
		await db.addJournal({ device: RING, at: 5, what: 'tide', durationS: 30, ended: 'user' });
		const file = JSON.parse(JSON.stringify(await db.exportAll()));
		expect(file.format).toBe(EXPORT_FORMAT);

		const other = await Storage.open(new IDBFactory());
		const result = await other.importFile(file);
		expect(result).toEqual({ modes: 1, journal: 1, settings: true });
		expect((await other.getSettings()).ring.warmupS).toBe(7);
		expect((await other.listModes())[0].name).toBe('Mine');
		expect((await other.listJournal())[0].what).toBe('tide');
	});

	it('never lets an imported file raise the e-stim maximum above 80 %', async () => {
		// Allowed and raised here, after the confirmation in this browser.
		const now = await db.getSettings();
		const mine = await db.saveSettings({
			...now,
			ring: {
				...now.ring,
				estimAbove80: true,
				capEstim: 1,
				calibration: { ...now.ring.calibration, estimMax: 0.95, estimDone: true },
				estimUnlocked: true
			}
		});
		expect(mine.ring.capEstim).toBe(1);
		expect(mine.ring.calibration.estimMax).toBe(0.95);
		const file = JSON.parse(JSON.stringify(await db.exportAll()));
		expect(file.settings.ring.estimAbove80).toBe(true);

		// Another browser imports that file: the confirmation does not travel. (That browser had raised its own
		// limit too, so nothing but the missing confirmation holds the file's values down.)
		const other = await Storage.open(new IDBFactory());
		await other.saveSettings(mine);
		await other.importFile(file);
		const imported = await other.getSettings();
		expect(imported.ring.estimAbove80).toBe(false);
		expect(imported.ring.capEstim).toBe(0.8);
		expect(imported.ring.calibration.estimMax).toBe(0.8);
		expect(importedSettings({ capEstim: 1, estimAbove80: true }).ring.capEstim).toBe(0.8);
		// ... and never enables e-stim: that needs its own confirmation in this browser.
		expect(
			importedSettings({ estimUnlocked: true, calibration: { estimDone: true, estimMax: 0.5 } }).ring
				.estimUnlocked
		).toBe(false);
	});

	it('imports a file exported before settings were per device, losing nothing', async () => {
		// What an earlier version exported: flat settings, favourites as ids, history without a device.
		const old = {
			format: EXPORT_FORMAT,
			exportedAt: '2026-09-30T10:00:00.000Z',
			settings: {
				onboarded: true,
				calibration: {
					vibFloor: 0.1,
					vibMax: 0.5,
					estimFloor: 0.05,
					estimMax: 0.3,
					vibDone: true,
					estimDone: true
				},
				estimUnlocked: true,
				estimRampPctS: 10,
				warmupS: 6,
				sessionMaxMin: 45,
				capVib: 0.7,
				capEstim: 0.6,
				estimAbove80: false,
				stopEverythingOnLeave: true,
				leadIn: true,
				favourites: ['wave'],
				knownHeaders: { 'dragon-s1': 0x56 }
			},
			modes: { format: 'ring-link-modes/1', modes: [] },
			journal: [{ at: 7, what: 'wave', durationS: 12, ended: 'user' }]
		};
		const other = await Storage.open(new IDBFactory());
		expect(await other.importFile(old)).toEqual({ modes: 0, journal: 1, settings: true });
		expect(await other.getSettings()).toEqual({
			adult: false, // 18+ is confirmed by the person, in this browser: a file can't
			devices: [RING],
			sessionMaxMin: 45,
			leadIn: true,
			favourites: [{ device: RING, id: 'wave' }],
			ring: {
				agreed: false, // nor agree to the safety notes
				setupOffered: true,
				calibration: old.settings.calibration,
				estimUnlocked: false, // a file never enables e-stim
				estimRampPctS: 10,
				warmupS: 6,
				capVib: 0.7,
				capEstim: 0.6,
				estimAbove80: false,
				stopEverythingOnLeave: true,
				knownHeader: 0x56
			},
			coyote: DEFAULT_COYOTE
		});
		expect((await other.listJournal())[0].device).toBe(RING);
	});

	it('reads flat settings stored by an earlier version, keeping an enabled e-stim', async () => {
		const raw = factory.open('opentoys');
		const idb = await new Promise<IDBDatabase>((ok) => (raw.onsuccess = () => ok(raw.result)));
		const tx = idb.transaction('kv', 'readwrite');
		tx.objectStore('kv').put(
			{ onboarded: true, estimUnlocked: true, capVib: 0.6, calibration: { estimDone: true, estimMax: 0.4 } },
			'settings'
		);
		await new Promise((ok) => (tx.oncomplete = ok));
		idb.close();
		const s = await db.getSettings();
		expect(s.ring.estimUnlocked).toBe(true);
		expect(s.ring.capVib).toBe(0.6);
		expect(s.ring.calibration.estimMax).toBe(0.4);
		expect(s.devices).toEqual([RING]);
	});

	it('saved patterns say which device they are for, in the store and in an export', async () => {
		const saved = await db.saveMode(mode('Mine'));
		expect(saved.device).toBe(RING);
		expect((await db.listModes())[0].device).toBe(RING);
		const file = JSON.parse(JSON.stringify(await db.exportAll()));
		// the reference implementation's format, with the device added (the reference implementation ignores what it doesn't know).
		expect(file.modes.modes[0]).toMatchObject({ format: 'ring-link-mode/1', name: 'Mine', device: RING });
		const other = await Storage.open(new IDBFactory());
		await other.importFile(file);
		expect((await other.listModes())[0].device).toBe(RING);
		// A file that names a device this app doesn't know, or none: the ring's (the format is the ring's).
		file.modes.modes[0].device = 'something-else';
		await other.importFile(file);
		delete file.modes.modes[0].device;
		await other.importFile(file);
		expect((await other.listModes()).map((m) => m.device)).toEqual([RING, RING, RING]);
	});

	it('the history keeps which device each entry was on, through an export and an import', async () => {
		await db.addJournal({ device: 'coyote-3', at: 10, what: 'tide,knock', durationS: 40, ended: 'user' });
		await db.addJournal({ device: RING, at: 20, what: 'wave', durationS: 30, ended: 'page_hidden' });
		const file = JSON.parse(JSON.stringify(await db.exportAll()));
		const other = await Storage.open(new IDBFactory());
		await other.importFile(file);
		expect((await other.listJournal()).map((j) => [j.device, j.what])).toEqual([
			[RING, 'wave'],
			['coyote-3', 'tide,knock']
		]);
	});

	it('a file never enables the Coyote or lets its maximum go above 100', async () => {
		const now = await db.getSettings();
		const mine = await db.saveSettings({
			...now,
			coyote: { ...now.coyote, agreed: true, enabled: true, above100: true, maxA: 150, maxB: 40 }
		});
		expect(mine.coyote).toMatchObject({ enabled: true, above100: true, maxA: 150, maxB: 40 });
		const file = JSON.parse(JSON.stringify(await db.exportAll()));
		// The other browser had high maximums of its own: only the missing confirmation holds the file's down.
		const other = await Storage.open(new IDBFactory());
		await other.saveSettings({ ...mine, coyote: { ...mine.coyote, maxA: 200, maxB: 200 } });
		await other.importFile(file);
		expect((await other.getSettings()).coyote).toMatchObject({
			agreed: false,
			enabled: false,
			above100: false,
			maxA: 100,
			maxB: 40
		});
	});

	it('an import never raises a limit that is set in this browser', async () => {
		const now = await db.getSettings();
		const file = JSON.parse(
			JSON.stringify({
				format: EXPORT_FORMAT,
				settings: {
					...now,
					sessionMaxMin: 240,
					ring: {
						...now.ring,
						capVib: 1,
						estimRampPctS: 80,
						calibration: { ...now.ring.calibration, vibMax: 1 }
					},
					coyote: { ...now.coyote, maxA: 90, maxB: 90 }
				}
			})
		);
		await db.saveSettings({
			...now,
			adult: true, // a browser that has been set up: its limits are its own
			sessionMaxMin: 20,
			ring: {
				...now.ring,
				capVib: 0.5,
				estimRampPctS: 8,
				calibration: { ...now.ring.calibration, vibMax: 0.45 }
			},
			coyote: { ...now.coyote, agreed: true, enabled: true, maxA: 35, maxB: 0 }
		});
		await db.importFile(file);
		const got = await db.getSettings();
		expect(got.sessionMaxMin).toBe(20);
		expect(got.ring.capVib).toBe(0.5);
		expect(got.ring.calibration.vibMax).toBe(0.45);
		expect(got.ring.estimRampPctS).toBe(8);
		expect(got.coyote).toMatchObject({ enabled: false, maxA: 35, maxB: 0 });
	});

	it('an import keeps the 18+ confirmation of the person importing, and takes none from the file', async () => {
		const file = { format: EXPORT_FORMAT, settings: { adult: true, onboarded: true, devices: [RING] } };
		// Not confirmed here: the file does not confirm it.
		const fresh = await Storage.open(new IDBFactory());
		await fresh.importFile(file);
		expect((await fresh.getSettings()).adult).toBe(false);
		// Confirmed here: importing a file (even one that says otherwise) doesn't take it away.
		await db.saveSettings({ ...(await db.getSettings()), adult: true });
		await db.importFile({ ...file, settings: { ...file.settings, adult: false } });
		expect((await db.getSettings()).adult).toBe(true);
		// Either way the devices' safety agreements are not the file's to give.
		expect((await db.getSettings()).ring.agreed).toBe(false);
		expect((await db.getSettings()).coyote.agreed).toBe(false);
	});

	it('imports an export that has no saved patterns', async () => {
		await db.saveSettings({ ...(await db.getSettings()), adult: true, leadIn: true });
		const file = JSON.parse(JSON.stringify(await db.exportAll()));
		const other = await Storage.open(new IDBFactory());
		expect(await other.importFile(file)).toEqual({ modes: 0, journal: 0, settings: true });
		expect((await other.getSettings()).leadIn).toBe(true);
	});

	it('imports a plain mode file and refuses junk', async () => {
		const r = await db.importFile({
			format: 'ring-link-mode/1',
			name: 'From another app',
			period_ms: 100,
			vib: [0.1],
			estim: []
		});
		expect(r.modes).toBe(1);
		await expect(db.importFile({ hello: 'world' })).rejects.toThrow();
	});

	it('deletes everything', async () => {
		await db.saveMode(mode('Gone'));
		await db.deleteEverything(factory);
		const fresh = await Storage.open(factory);
		expect(await fresh.listModes()).toEqual([]);
		expect((await fresh.getSettings()).adult).toBe(false);
	});
});
