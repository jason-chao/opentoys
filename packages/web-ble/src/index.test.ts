import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BleError,
	bluetoothSupport,
	connect,
	isSupported,
	requestAndConnect,
	requestDevice,
	type BleProfile
} from './index.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const uuid = (s: string) => `0000${s}-0000-1000-8000-00805f9b34fb`;
const PROFILE: BleProfile = {
	namePrefix: 'YLS01',
	service: uuid('ae3a'),
	write: uuid('ae3b'),
	notify: uuid('ae3c')
};

class MockCharacteristic extends EventTarget {
	value: DataView | undefined;
	stored: number[] = [];
	readonly writes: number[][] = [];
	inFlight = 0;
	maxInFlight = 0;
	failNext = false;
	notifying = false;
	constructor(readonly uuid: string) {
		super();
	}
	private async op(fn: () => void): Promise<void> {
		this.inFlight++;
		this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
		await new Promise((r) => setTimeout(r, 10));
		this.inFlight--;
		if (this.failNext) {
			this.failNext = false;
			throw new DOMException('GATT operation failed', 'NetworkError');
		}
		fn();
	}
	writeValueWithoutResponse(data: BufferSource): Promise<void> {
		const bytes = Array.from(new Uint8Array(data as ArrayBuffer));
		return this.op(() => this.writes.push(bytes));
	}
	/** As in browsers: the value lands in `value` and characteristicvaluechanged fires. */
	async readValue(): Promise<DataView> {
		let view = new DataView(new ArrayBuffer(0));
		await this.op(() => {
			const buf = new Uint8Array([0xee, ...this.stored, 0xee]).buffer;
			view = new DataView(buf, 1, this.stored.length);
			this.value = view;
			this.dispatchEvent(new Event('characteristicvaluechanged'));
		});
		return view;
	}
	startNotifications(): Promise<this> {
		return this.op(() => (this.notifying = true)).then(() => this);
	}
	/** The device sends a notification (with a view into a larger buffer, as browsers may). */
	push(bytes: number[]): void {
		const buf = new Uint8Array([0xee, ...bytes, 0xee]).buffer;
		this.value = new DataView(buf, 1, bytes.length);
		this.dispatchEvent(new Event('characteristicvaluechanged'));
	}
}

class MockServer {
	connected = false;
	failConnects = 0;
	readonly chars: Map<string, MockCharacteristic>;
	/** Further services: uuid → characteristics. */
	readonly extra = new Map<string, Map<string, MockCharacteristic>>();
	constructor(
		private readonly device: MockDevice,
		uuids: string[],
		private readonly main: string = PROFILE.service
	) {
		this.chars = new Map(uuids.map((u) => [u, new MockCharacteristic(u)]));
	}
	addService(service: string, uuids: string[]): Map<string, MockCharacteristic> {
		const chars = new Map(uuids.map((u) => [u, new MockCharacteristic(u)]));
		this.extra.set(service, chars);
		return chars;
	}
	async connect(): Promise<this> {
		if (this.failConnects > 0) {
			this.failConnects--;
			throw new DOMException('Connection failed', 'NetworkError');
		}
		this.connected = true;
		return this;
	}
	disconnect(): void {
		if (!this.connected) return;
		this.connected = false;
		this.device.dispatchEvent(new Event('gattserverdisconnected'));
	}
	/** The link goes away on its own. */
	lose(): void {
		this.connected = false;
		this.device.dispatchEvent(new Event('gattserverdisconnected'));
	}
	async getPrimaryService(service: string) {
		const chars = service === this.main ? this.chars : this.extra.get(service);
		if (!chars || chars.size === 0)
			throw new DOMException('No Services matching UUID found', 'NotFoundError');
		return {
			getCharacteristic: async (u: string) => {
				const c = chars.get(u);
				if (!c) throw new DOMException('No Characteristics matching UUID found', 'NotFoundError');
				return c;
			}
		};
	}
}

class MockDevice extends EventTarget {
	readonly gatt: MockServer;
	constructor(
		uuids = [PROFILE.write, PROFILE.notify],
		main: string = PROFILE.service,
		readonly id = 'dev-1',
		readonly name = 'YLS01'
	) {
		super();
		this.gatt = new MockServer(this, uuids, main);
	}
}

// A device with two services, shaped like the Coyote 3.0.
const COYOTE: BleProfile = {
	namePrefix: '47L121000',
	service: uuid('180c'),
	write: uuid('150a'),
	notify: uuid('150b'),
	services: [{ uuid: uuid('180a'), characteristics: [uuid('1500'), uuid('1501'), uuid('1502')] }]
};

function coyoteDevice(info = [uuid('1500'), uuid('1501'), uuid('1502')]) {
	const device = new MockDevice([COYOTE.write, COYOTE.notify], COYOTE.service, 'dev-2', '47L121000');
	const chars = device.gatt.addService(uuid('180a'), info);
	return { device, info: chars };
}

function mockNavigator(device: MockDevice | Error, available = true) {
	const requestDevice = vi.fn(async (opts: RequestDeviceOptions) => {
		void opts;
		if (device instanceof Error) throw device;
		return device;
	});
	return {
		nav: { bluetooth: { requestDevice, getAvailability: async () => available } as unknown as Bluetooth },
		requestDevice
	};
}

const asDevice = (d: MockDevice) => d as unknown as BluetoothDevice;

async function open(device = new MockDevice()) {
	const t = await connect(asDevice(device), PROFILE);
	return { device, t, w: device.gatt.chars.get(PROFILE.write)!, n: device.gatt.chars.get(PROFILE.notify)! };
}

describe('support', () => {
	it('detects the API and the adapter', async () => {
		expect(isSupported(undefined)).toBe(false);
		expect(isSupported({})).toBe(false);
		expect(await bluetoothSupport({})).toBe('unsupported');
		expect(await bluetoothSupport(mockNavigator(new MockDevice()).nav)).toBe('available');
		expect(await bluetoothSupport(mockNavigator(new MockDevice(), false).nav)).toBe('unavailable');
		const noAvailability = { bluetooth: { requestDevice: () => {} } as unknown as Bluetooth };
		expect(await bluetoothSupport(noAvailability)).toBe('available');
	});
});

describe('requestDevice', () => {
	it('filters by name prefix and asks for the service', async () => {
		const { nav, requestDevice: rd } = mockNavigator(new MockDevice());
		await requestDevice(PROFILE, nav);
		expect(rd).toHaveBeenCalledWith({
			filters: [{ namePrefix: 'YLS01' }],
			optionalServices: ['0000ae3a-0000-1000-8000-00805f9b34fb']
		});
	});

	it('maps failures to codes', async () => {
		const cancelled = mockNavigator(new DOMException('User cancelled', 'NotFoundError')).nav;
		await expect(requestDevice(PROFILE, cancelled)).rejects.toMatchObject({ code: 'cancelled' });
		const blocked = mockNavigator(new DOMException('blocked', 'SecurityError')).nav;
		await expect(requestDevice(PROFILE, blocked)).rejects.toMatchObject({ code: 'blocked' });
		const other = mockNavigator(new Error('boom')).nav;
		await expect(requestDevice(PROFILE, other)).rejects.toMatchObject({ code: 'request-failed' });
		await expect(requestDevice(PROFILE, {})).rejects.toBeInstanceOf(BleError);
	});
});

describe('WebBleTransport', () => {
	it('connects and finds both characteristics', async () => {
		const { nav } = mockNavigator(new MockDevice());
		const t = await requestAndConnect(PROFILE, nav);
		expect(t.connected).toBe(true);
		expect(t.hasCharacteristic(PROFILE.write)).toBe(true);
		expect(t.hasCharacteristic(PROFILE.notify.toUpperCase())).toBe(true);
		expect([t.id, t.name]).toEqual(['dev-1', 'YLS01']);
	});

	it('retries a failed GATT connect, then gives up with a code', async () => {
		const d = new MockDevice();
		d.gatt.failConnects = 1;
		expect((await connect(asDevice(d), PROFILE)).connected).toBe(true);
		const d2 = new MockDevice();
		d2.gatt.failConnects = 5;
		await expect(connect(asDevice(d2), PROFILE, { attempts: 3 })).rejects.toMatchObject({
			code: 'connect-failed'
		});
	});

	it('leaves missing characteristics for the driver to report', async () => {
		const { t } = await open(new MockDevice([PROFILE.notify]));
		expect(t.hasCharacteristic(PROFILE.write)).toBe(false);
		expect(t.hasCharacteristic(PROFILE.notify)).toBe(true);
		const { t: t2 } = await open(new MockDevice([]));
		expect(t2.hasCharacteristic(PROFILE.notify)).toBe(false);
		expect(t2.connected).toBe(true);
	});

	it('serialises writes (GATT operations must not overlap), in order', async () => {
		const { t, w } = await open();
		const done = [t.write(PROFILE.write, Uint8Array.of(1)), t.write(PROFILE.write, Uint8Array.of(2))];
		const buf = Uint8Array.of(3);
		done.push(t.write(PROFILE.write, buf));
		buf[0] = 99; // the caller reuses its buffer
		await vi.advanceTimersByTimeAsync(100);
		await Promise.all(done);
		expect(w.writes).toEqual([[1], [2], [3]]);
		expect(w.maxInFlight).toBe(1);
	});

	it('keeps going after a failed write', async () => {
		const { t, w } = await open();
		w.failNext = true;
		const a = t.write(PROFILE.write, Uint8Array.of(1));
		const b = t.write(PROFILE.write, Uint8Array.of(2));
		const results = Promise.allSettled([a, b]);
		await vi.advanceTimersByTimeAsync(100);
		const [ra, rb] = await results;
		expect(ra.status).toBe('rejected');
		expect(rb.status).toBe('fulfilled');
		expect(w.writes).toEqual([[2]]);
	});

	it('subscribes to notifications and hands over copies of the value', async () => {
		const { t, n, w } = await open();
		const got: number[][] = [];
		const sub = t.subscribe(PROFILE.notify, (d) => got.push([...d]));
		const write = t.write(PROFILE.write, Uint8Array.of(1)); // queued behind startNotifications
		await vi.advanceTimersByTimeAsync(100);
		await sub;
		await write;
		expect(n.notifying).toBe(true);
		expect(w.maxInFlight).toBe(1);
		n.push([0x56, 0x01, 0x06, 1, 1, 87, 0, 0, 0, 0xe6]);
		expect(got).toEqual([[0x56, 0x01, 0x06, 1, 1, 87, 0, 0, 0, 0xe6]]);
	});

	it('reports a lost link once, as not requested', async () => {
		const { device, t } = await open();
		const seen: boolean[] = [];
		t.onDisconnect((i) => seen.push(i.requested));
		device.gatt.lose();
		device.gatt.lose();
		expect(seen).toEqual([false]);
		expect(t.connected).toBe(false);
		await expect(t.write(PROFILE.write, Uint8Array.of(1))).rejects.toThrow('not connected');
	});

	it('disconnects cleanly after queued writes, reporting it as requested', async () => {
		const { device, t, w } = await open();
		const seen: boolean[] = [];
		t.onDisconnect((i) => seen.push(i.requested));
		void t.write(PROFILE.write, Uint8Array.of(0x56, 0x02));
		void t.write(PROFILE.write, Uint8Array.of(0x56, 0x05));
		const closing = t.disconnect();
		await vi.advanceTimersByTimeAsync(100);
		await closing;
		expect(w.writes).toEqual([
			[0x56, 0x02],
			[0x56, 0x05]
		]);
		expect(device.gatt.connected).toBe(false);
		expect(seen).toEqual([true]);
		await t.disconnect(); // idempotent
		expect(seen).toEqual([true]);
	});

	it('does not wait forever for a stuck write before disconnecting', async () => {
		const { device, t, w } = await open();
		w.writeValueWithoutResponse = () => new Promise<void>(() => {});
		void t.write(PROFILE.write, Uint8Array.of(1));
		const closing = t.disconnect();
		await vi.advanceTimersByTimeAsync(600);
		await closing;
		expect(device.gatt.connected).toBe(false);
	});
});

describe('several services and reads', () => {
	it('asks for every service of the profile', async () => {
		const { nav, requestDevice: rd } = mockNavigator(coyoteDevice().device);
		await requestDevice(COYOTE, nav);
		expect(rd).toHaveBeenCalledWith({
			filters: [{ namePrefix: '47L121000' }],
			optionalServices: ['0000180c-0000-1000-8000-00805f9b34fb', '0000180a-0000-1000-8000-00805f9b34fb']
		});
	});

	it('finds characteristics across services and reads them', async () => {
		const { device, info } = coyoteDevice();
		info.get(uuid('1501'))!.stored = [7, 3];
		info.get(uuid('1500'))!.stored = [88];
		const t = await connect(asDevice(device), COYOTE);
		for (const u of [COYOTE.write, COYOTE.notify, uuid('1500'), uuid('1501'), uuid('1502')])
			expect(t.hasCharacteristic(u)).toBe(true);
		const reads = Promise.all([t.read(uuid('1501')), t.read(uuid('1500').toUpperCase())]);
		await vi.advanceTimersByTimeAsync(100);
		const [version, battery] = await reads;
		expect([...version]).toEqual([7, 3]);
		expect([...battery]).toEqual([88]);
		expect(version.byteOffset).toBe(0); // a copy, not a view into the browser's buffer
	});

	it('leaves a missing service or characteristic for the driver to report', async () => {
		const { device } = coyoteDevice([uuid('1500'), uuid('1501')]); // no MAC on this firmware
		const t = await connect(asDevice(device), COYOTE);
		expect(t.hasCharacteristic(uuid('1502'))).toBe(false);
		await expect(t.read(uuid('1502'))).rejects.toThrow('not available');
		const bare = new MockDevice([COYOTE.write, COYOTE.notify], COYOTE.service);
		const t2 = await connect(asDevice(bare), COYOTE);
		expect(t2.hasCharacteristic(uuid('1501'))).toBe(false);
		expect(t2.hasCharacteristic(COYOTE.write)).toBe(true);
	});

	it('queues reads, writes and subscriptions together, across services', async () => {
		const { device, info } = coyoteDevice();
		const t = await connect(asDevice(device), COYOTE);
		const order: string[] = [];
		const all = [info.get(uuid('1500'))!, info.get(uuid('1501'))!, ...device.gatt.chars.values()];
		let inFlight = 0;
		let max = 0;
		for (const c of all) {
			for (const name of ['readValue', 'writeValueWithoutResponse', 'startNotifications'] as const) {
				const real = (c[name] as (...a: unknown[]) => Promise<unknown>).bind(c);
				(c as unknown as Record<string, unknown>)[name] = async (...a: unknown[]) => {
					max = Math.max(max, ++inFlight);
					order.push(name);
					try {
						return await real(...a);
					} finally {
						inFlight--;
					}
				};
			}
		}
		const got: number[][] = [];
		const ops = Promise.all([
			t.read(uuid('1501')),
			t.subscribe(uuid('1500'), (d) => got.push([...d])),
			t.write(COYOTE.write, Uint8Array.of(0xb0)),
			t.read(uuid('1500'))
		]);
		await vi.advanceTimersByTimeAsync(200);
		await ops;
		expect(order).toEqual(['readValue', 'startNotifications', 'writeValueWithoutResponse', 'readValue']);
		expect(max).toBe(1);
		info.get(uuid('1500'))!.push([64]);
		expect(got.at(-1)).toEqual([64]);
	});

	it('keeps two connected devices apart', async () => {
		const ring = new MockDevice();
		const { device: coyote } = coyoteDevice();
		const t1 = await connect(asDevice(ring), PROFILE);
		const t2 = await connect(asDevice(coyote), COYOTE);
		const lost: string[] = [];
		t1.onDisconnect(() => lost.push('ring'));
		t2.onDisconnect(() => lost.push('coyote'));
		// a stuck operation on one device does not hold up the other
		ring.gatt.chars.get(PROFILE.write)!.writeValueWithoutResponse = () => new Promise<void>(() => {});
		void t1.write(PROFILE.write, Uint8Array.of(1));
		const w = t2.write(COYOTE.write, Uint8Array.of(2));
		await vi.advanceTimersByTimeAsync(50);
		await w;
		expect(coyote.gatt.chars.get(COYOTE.write)!.writes).toEqual([[2]]);
		expect(t1.hasCharacteristic(COYOTE.write)).toBe(false);
		coyote.gatt.lose();
		expect(lost).toEqual(['coyote']);
		expect(t1.connected).toBe(true);
		expect(t2.connected).toBe(false);
	});
});
