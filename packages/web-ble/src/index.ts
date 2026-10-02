/// <reference types="web-bluetooth" />
// Web Bluetooth transport: find the device with the browser's chooser, open its GATT services, read, write
// without response, receive notifications, and report disconnects. It satisfies @opentoys/devices' Transport
// structurally (no import, so this package stays dependency-free); the profile comes from the device model,
// e.g. DRAGON_S1.ble or COYOTE_3.ble. Nothing here is shared between transports: two devices can be connected
// at the same time, each with its own queue.

/** A further GATT service to open, with the characteristics used in it. */
export interface BleServiceProfile {
	readonly uuid: string;
	readonly characteristics: readonly string[];
}

/** Everything needed to find and open the device (DeviceModel.ble in @opentoys/devices). */
export interface BleProfile {
	readonly namePrefix: string;
	/** The service holding the write and notify characteristics. */
	readonly service: string;
	readonly write: string;
	readonly notify: string;
	/** Services besides `service` (e.g. the one holding battery and version). */
	readonly services?: readonly BleServiceProfile[];
}

/** Every service of the profile with its characteristics, the main one first. */
function servicesOf(profile: BleProfile): BleServiceProfile[] {
	return [
		{ uuid: profile.service, characteristics: [profile.write, profile.notify] },
		...(profile.services ?? [])
	];
}

export type BluetoothSupport = 'available' | 'unavailable' | 'unsupported';

export type BleErrorCode = 'unsupported' | 'cancelled' | 'blocked' | 'request-failed' | 'connect-failed';

/** Errors carry a code the app translates; the message is for logs. */
export class BleError extends Error {
	readonly code: BleErrorCode;
	override readonly cause: unknown;
	constructor(code: BleErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'BleError';
		this.code = code;
		this.cause = cause;
	}
}

type NavigatorLike = { bluetooth?: Bluetooth };

function defaultNavigator(): NavigatorLike | undefined {
	return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike);
}

/** The Web Bluetooth API exists (Chrome, Edge, Samsung Internet; not Safari or Firefox). */
export function isSupported(nav: NavigatorLike | undefined = defaultNavigator()): boolean {
	return !!nav && typeof nav.bluetooth?.requestDevice === 'function';
}

/** 'unavailable' when the API exists but there is no adapter (or it is off, where the browser can tell). */
export async function bluetoothSupport(
	nav: NavigatorLike | undefined = defaultNavigator()
): Promise<BluetoothSupport> {
	if (!isSupported(nav)) return 'unsupported';
	const bt = nav!.bluetooth!;
	if (typeof bt.getAvailability !== 'function') return 'available';
	try {
		return (await bt.getAvailability()) ? 'available' : 'unavailable';
	} catch {
		return 'available'; // cannot tell; let requestDevice report the problem
	}
}

function errorName(e: unknown): string {
	return e && typeof e === 'object' && 'name' in e ? String(e.name) : '';
}

/**
 * Open the browser's device chooser. Filters by name only: the S1 advertises the service UUID byte-swapped
 * (0x3AAE for service 0xAE3A) and the Coyote one on another base, so a service filter would not match; every
 * service of the profile is listed as optional so the page may open it.
 */
export async function requestDevice(
	profile: BleProfile,
	nav: NavigatorLike | undefined = defaultNavigator()
): Promise<BluetoothDevice> {
	if (!isSupported(nav)) throw new BleError('unsupported', 'Web Bluetooth is not available');
	try {
		return await nav!.bluetooth!.requestDevice({
			filters: [{ namePrefix: profile.namePrefix }],
			optionalServices: servicesOf(profile).map((s) => s.uuid)
		});
	} catch (e) {
		const name = errorName(e);
		if (name === 'NotFoundError') throw new BleError('cancelled', 'no device chosen', e);
		if (name === 'SecurityError' || name === 'NotAllowedError')
			throw new BleError('blocked', 'Bluetooth is blocked for this page', e);
		throw new BleError('request-failed', `requestDevice failed: ${String(e)}`, e);
	}
}

export interface ConnectOptions {
	/** GATT connections fail now and then on Android; try this many times. */
	attempts?: number;
}

/** Connect to a device (from requestDevice, or kept from an earlier connection: reconnecting on request). */
export async function connect(
	device: BluetoothDevice,
	profile: BleProfile,
	opts: ConnectOptions = {}
): Promise<WebBleTransport> {
	const gatt = device.gatt;
	if (!gatt) throw new BleError('connect-failed', 'the device has no GATT server');
	const attempts = Math.max(1, opts.attempts ?? 2);
	let server: BluetoothRemoteGATTServer | null = null;
	let last: unknown;
	for (let i = 0; i < attempts && !server; i++) {
		try {
			server = await gatt.connect();
		} catch (e) {
			last = e;
		}
	}
	if (!server) throw new BleError('connect-failed', `GATT connect failed: ${String(last)}`, last);
	// A missing service or characteristic is left for the driver to report (not a supported device).
	const chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
	for (const spec of servicesOf(profile)) {
		try {
			const service = await server.getPrimaryService(spec.uuid);
			for (const uuid of spec.characteristics) {
				try {
					chars.set(uuid.toLowerCase(), await service.getCharacteristic(uuid));
				} catch {
					// not there
				}
			}
		} catch (e) {
			if (!server.connected) throw new BleError('connect-failed', `link lost while opening: ${String(e)}`, e);
		}
	}
	return new WebBleTransport(device, chars);
}

/** Chooser, then connect. */
export async function requestAndConnect(
	profile: BleProfile,
	nav: NavigatorLike | undefined = defaultNavigator(),
	opts: ConnectOptions = {}
): Promise<WebBleTransport> {
	return connect(await requestDevice(profile, nav), profile, opts);
}

const DRAIN_MS = 500;

export class WebBleTransport {
	readonly device: BluetoothDevice;
	private readonly chars: Map<string, BluetoothRemoteGATTCharacteristic>;
	/** GATT operations must not overlap: every one goes through this chain. */
	private queue: Promise<unknown> = Promise.resolve();
	private closing = false;
	private ended = false;
	private disconnectListeners = new Set<(info: { requested: boolean }) => void>();
	private cleanups: (() => void)[] = [];

	constructor(device: BluetoothDevice, chars: Map<string, BluetoothRemoteGATTCharacteristic>) {
		this.device = device;
		this.chars = chars;
		const onGone = (): void => this.end();
		device.addEventListener('gattserverdisconnected', onGone);
		this.cleanups.push(() => device.removeEventListener('gattserverdisconnected', onGone));
	}

	get id(): string {
		return this.device.id;
	}
	get name(): string | undefined {
		return this.device.name;
	}
	get connected(): boolean {
		return !this.ended && !!this.device.gatt?.connected;
	}

	hasCharacteristic(uuid: string): boolean {
		return this.chars.has(uuid.toLowerCase());
	}

	private char(uuid: string): BluetoothRemoteGATTCharacteristic {
		const c = this.chars.get(uuid.toLowerCase());
		if (!c) throw new Error(`characteristic ${uuid} not available`);
		return c;
	}

	private enqueue<T>(op: () => Promise<T>): Promise<T> {
		const p = this.queue.then(op);
		this.queue = p.catch(() => {});
		return p;
	}

	/** Write without response, after every earlier GATT operation has finished. */
	write(characteristic: string, data: Uint8Array): Promise<void> {
		if (!this.connected) return Promise.reject(new Error('not connected'));
		const c = this.char(characteristic);
		const copy = new Uint8Array(data); // the caller may reuse its buffer; also a plain ArrayBuffer view
		return this.enqueue(() =>
			typeof c.writeValueWithoutResponse === 'function'
				? c.writeValueWithoutResponse(copy)
				: c.writeValue(copy)
		);
	}

	/** Read a characteristic's value, after every earlier GATT operation has finished. */
	async read(characteristic: string): Promise<Uint8Array> {
		if (!this.connected) throw new Error('not connected');
		const c = this.char(characteristic);
		const v = await this.enqueue(() => c.readValue());
		return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
	}

	async subscribe(characteristic: string, listener: (data: Uint8Array) => void): Promise<void> {
		if (!this.connected) throw new Error('not connected');
		const c = this.char(characteristic);
		const onValue = (e: Event): void => {
			const v = (e.target as BluetoothRemoteGATTCharacteristic | null)?.value;
			if (v) listener(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
		};
		c.addEventListener('characteristicvaluechanged', onValue);
		this.cleanups.push(() => c.removeEventListener('characteristicvaluechanged', onValue));
		await this.enqueue(() => c.startNotifications());
	}

	onDisconnect(listener: (info: { requested: boolean }) => void): () => void {
		this.disconnectListeners.add(listener);
		return () => this.disconnectListeners.delete(listener);
	}

	/** Close cleanly: let queued writes (e.g. the stop sequence) go out first, briefly, then drop the link. */
	async disconnect(): Promise<void> {
		if (this.ended) return;
		this.closing = true;
		await Promise.race([this.queue, new Promise((r) => setTimeout(r, DRAIN_MS))]);
		this.device.gatt?.disconnect();
		this.end();
	}

	private end(): void {
		if (this.ended) return;
		this.ended = true;
		for (const c of this.cleanups) c();
		this.cleanups = [];
		const info = { requested: this.closing };
		for (const fn of [...this.disconnectListeners]) {
			try {
				fn(info);
			} catch (e) {
				console.error('disconnect listener failed', e);
			}
		}
		this.disconnectListeners.clear();
	}
}
