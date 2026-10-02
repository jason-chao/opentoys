import type { Page } from '@playwright/test';

// A stand-in for the browser's Web Bluetooth at GATT level, so the tests cover the real connect path and the
// frames the app writes. Two devices can be found, picked by the name prefix the app asks for:
//
// * the Dragon S1 (`YLS01`): service ae3a with ae3b (write) and ae3c (notify). Silent until written to, and
//   every write is answered about 70 ms later with the status frame (SPEC §4, §8).
// * the Coyote 3.0 (`47L121000…`): service 180c with 150a (write) and 150b (notify), service 180a with 1500
//   (battery: read, notified once a second), 1501 (version) and 1502 (MAC). A B0 frame sets the intensities
//   (within the device's caps) and, when its sequence number is not 0, is answered with `B1 seq iA iB`. BF
//   sets the caps. Turning a dial reports `B1 00 iA iB` unasked.

export interface FakeBle {
	/** Every frame written to ae3b, oldest first. */
	frames: number[][];
	connects: number;
	connected: boolean;
	/** The radio link drops without a clean disconnect (out of range). */
	drop(): void;
}

export interface FakeCoyoteBle {
	/** Every B0 frame written to 150a, oldest first. */
	frames: number[][];
	/** Every write to 150a (B0 frames, BF caps, anything else). */
	writes: number[][];
	connects: number;
	connected: boolean;
	/** The device's intensity per channel [A, B], 0..200. */
	intensity: [number, number];
	/** The device's own caps per channel [A, B], as the last BF set them. */
	caps: [number, number];
	/** The name it is found under (set before connecting; `47L121000_O3` is a device in update mode). */
	name: string;
	drop(): void;
	/** Turn a dial on the device: the intensity changes (within the caps) and is reported unasked. */
	turnDial(channel: 'a' | 'b', value: number): void;
}

declare global {
	interface Window {
		__ble: FakeBle;
		__coyote: FakeCoyoteBle;
	}
}

/** Runs in the page before any of its scripts (page.addInitScript). Must not use anything from outside. */
function install(): void {
	const uuid = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;
	const bytesOf = (data: BufferSource) =>
		ArrayBuffer.isView(data)
			? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
			: new Uint8Array(data);

	class Characteristic extends EventTarget {
		value: DataView | null = null;
		onWrite: (bytes: number[]) => void = () => {};
		read: () => number[] = () => [];
		constructor(
			readonly uuid: string,
			private readonly link: { connected: boolean }
		) {
			super();
		}
		async startNotifications() {
			return this;
		}
		async readValue() {
			if (!this.link.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
			return new DataView(new Uint8Array(this.read()).buffer);
		}
		async writeValueWithoutResponse(data: BufferSource) {
			if (!this.link.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
			this.onWrite(Array.from(bytesOf(data)));
		}
		writeValue(data: BufferSource) {
			return this.writeValueWithoutResponse(data);
		}
		notify(bytes: number[]) {
			if (!this.link.connected) return;
			this.value = new DataView(new Uint8Array(bytes).buffer);
			this.dispatchEvent(new Event('characteristicvaluechanged'));
		}
	}

	/** A device with GATT services: `services` maps a service uuid to its characteristics. */
	function makeDevice(
		id: string,
		name: () => string,
		state: { connects: number; connected: boolean },
		services: Record<string, Characteristic[]>
	) {
		const device = new EventTarget() as EventTarget & { id: string; name: string; gatt: typeof gatt };
		const gatt = {
			connected: false,
			device,
			async connect() {
				state.connects++;
				state.connected = true;
				gatt.connected = true;
				return gatt;
			},
			disconnect() {
				drop();
			},
			async getPrimaryService(serviceId: string) {
				const chars = services[serviceId.toLowerCase()];
				if (!chars) throw new DOMException('No Services matching UUID.', 'NotFoundError');
				return {
					uuid: serviceId,
					async getCharacteristic(charId: string) {
						const c = chars.find((x) => x.uuid === charId.toLowerCase());
						if (!c) throw new DOMException('No Characteristics matching UUID.', 'NotFoundError');
						return c;
					}
				};
			}
		};
		const drop = () => {
			if (!state.connected) return;
			state.connected = false;
			gatt.connected = false;
			device.dispatchEvent(new Event('gattserverdisconnected'));
		};
		device.id = id;
		Object.defineProperty(device, 'name', { get: name });
		device.gatt = gatt;
		return { device, drop };
	}

	// ----- the Dragon S1 --------------------------------------------------------------------------------------
	// 56 01 06 hw fw battery 00 00 00 sum: hardware 1, firmware 1, battery 0x57 = 87 %.
	const status = [0x56, 0x01, 0x06, 0x01, 0x01, 0x57, 0x00, 0x00, 0x00];
	status.push(status.reduce((a, b) => a + b, 0) & 0xff);

	const ring: FakeBle = { frames: [], connects: 0, connected: false, drop: () => ringDevice.drop() };
	const ringWrite = new Characteristic(uuid('ae3b'), ring);
	const ringNotify = new Characteristic(uuid('ae3c'), ring);
	ringWrite.onWrite = (bytes) => {
		ring.frames.push(bytes);
		setTimeout(() => ringNotify.notify(status), 70);
	};
	const ringDevice = makeDevice('fake-yls01', () => 'YLS01', ring, {
		[uuid('ae3a')]: [ringWrite, ringNotify]
	});

	// ----- the Coyote 3.0 -------------------------------------------------------------------------------------
	const coyote: FakeCoyoteBle = {
		frames: [],
		writes: [],
		connects: 0,
		connected: false,
		intensity: [0, 0],
		caps: [200, 200],
		name: '47L121000A1B2',
		drop: () => coyoteDevice.drop(),
		turnDial(channel, value) {
			const i = channel === 'a' ? 0 : 1;
			coyote.intensity[i] = Math.min(Math.max(Math.trunc(value), 0), coyote.caps[i]);
			coyoteNotify.notify([0xb1, 0, coyote.intensity[0], coyote.intensity[1]]);
		}
	};
	const coyoteWrite = new Characteristic(uuid('150a'), coyote);
	const coyoteNotify = new Characteristic(uuid('150b'), coyote);
	const coyoteBattery = new Characteristic(uuid('1500'), coyote);
	const coyoteVersion = new Characteristic(uuid('1501'), coyote);
	const coyoteMac = new Characteristic(uuid('1502'), coyote);
	coyoteBattery.read = () => [76]; // 76 %
	coyoteVersion.read = () => [7, 3]; // firmware 7
	coyoteMac.read = () => [0xfa, 0x0e, 0x00, 0x00, 0x00, 0x01];
	setInterval(() => coyoteBattery.notify([76]), 1000);
	coyoteWrite.onWrite = (d) => {
		coyote.writes.push(d);
		if (d[0] === 0xb0 && d.length === 20) {
			coyote.frames.push(d);
			const seq = d[1] >> 4;
			const types = [(d[1] >> 2) & 3, d[1] & 3];
			for (const i of [0, 1]) {
				let next = coyote.intensity[i];
				if (types[i] === 3) next = d[2 + i];
				else if (types[i] === 1) next += d[2 + i];
				else if (types[i] === 2) next -= d[2 + i];
				coyote.intensity[i] = Math.min(Math.max(next, 0), coyote.caps[i]);
			}
			if (seq !== 0)
				setTimeout(() => coyoteNotify.notify([0xb1, seq, coyote.intensity[0], coyote.intensity[1]]), 20);
		} else if (d[0] === 0xbf && d.length === 7) {
			coyote.caps = [Math.min(d[1], 200), Math.min(d[2], 200)];
			coyote.intensity = [
				Math.min(coyote.intensity[0], coyote.caps[0]),
				Math.min(coyote.intensity[1], coyote.caps[1])
			];
		}
	};
	const coyoteDevice = makeDevice('fake-coyote', () => coyote.name, coyote, {
		[uuid('180c')]: [coyoteWrite, coyoteNotify],
		[uuid('180a')]: [coyoteBattery, coyoteVersion, coyoteMac]
	});

	Object.defineProperty(navigator, 'bluetooth', {
		configurable: true,
		value: {
			getAvailability: async () => true,
			// The chooser, with the one device whose name matches the filter "chosen" at once.
			requestDevice: async (options: { filters?: { namePrefix?: string }[] }) => {
				const prefix = options.filters?.[0]?.namePrefix ?? '';
				for (const d of [ringDevice.device, coyoteDevice.device])
					if (prefix && d.name.startsWith(prefix)) return d;
				throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
			}
		}
	});
	window.__ble = ring;
	window.__coyote = coyote;
}

/** Give the page a (fake) Dragon S1 and a (fake) Coyote 3.0 to find. Call before the first navigation. */
export const installFakeBluetooth = (page: Page): Promise<void> => page.addInitScript(install);

export const frames = (page: Page): Promise<number[][]> => page.evaluate(() => window.__ble.frames);

/** Levels frames (56 02 05 vib 00 00 00 estim sum) as { vib, estim } bytes, oldest first. */
export async function levels(page: Page): Promise<{ vib: number; estim: number }[]> {
	return (await frames(page))
		.filter((f) => f[0] === 0x56 && f[1] === 0x02 && f.length === 9)
		.map((f) => ({ vib: f[3], estim: f[7] }));
}

export const lastLevels = async (page: Page) => (await levels(page)).at(-1) ?? { vib: 0, estim: 0 };

export const STOP_FRAME = [0x56, 0x05, 0x01, 0x01, 0x01, 0x5e];
export const ZERO_FRAME = [0x56, 0x02, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5d];

// ----- the Coyote ---------------------------------------------------------------------------------------------

/** One B0 frame, decoded. */
export interface CoyoteFrame {
	seq: number;
	/** How each channel's intensity byte is to be read: 0 keep, 1 add, 2 subtract, 3 set. */
	typeA: number;
	typeB: number;
	a: number;
	b: number;
	/** The highest strength (0..100) in each channel's four slots. */
	strengthA: number;
	strengthB: number;
}

const decode = (f: number[]): CoyoteFrame => ({
	seq: f[1] >> 4,
	typeA: (f[1] >> 2) & 3,
	typeB: f[1] & 3,
	a: f[2],
	b: f[3],
	strengthA: Math.max(...f.slice(8, 12)),
	strengthB: Math.max(...f.slice(16, 20))
});

/** Every B0 frame the app wrote to the Coyote, decoded, oldest first. */
export const coyoteFrames = async (page: Page): Promise<CoyoteFrame[]> =>
	(await page.evaluate(() => window.__coyote.frames)).map(decode);

/** What the (fake) Coyote is at: its intensities and its own caps. */
export const coyoteState = (page: Page) =>
	page.evaluate(() => ({
		intensity: [...window.__coyote.intensity],
		caps: [...window.__coyote.caps],
		connected: window.__coyote.connected
	}));

export const turnDial = (page: Page, channel: 'a' | 'b', value: number): Promise<void> =>
	page.evaluate(([c, v]) => window.__coyote.turnDial(c as 'a' | 'b', v as number), [channel, value]);

/** A zero frame of a stop: both channels set to 0, numbered, with silent payloads. */
export const isZeroFrame = (f: CoyoteFrame): boolean =>
	f.seq !== 0 &&
	f.typeA === 3 &&
	f.typeB === 3 &&
	f.a === 0 &&
	f.b === 0 &&
	f.strengthA === 0 &&
	f.strengthB === 0;
