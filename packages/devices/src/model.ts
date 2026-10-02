// The device model: what a device is, independent of how it is driven. A device has named channels, each
// with a role; the engine drives channels by role, so a device with two e-stim channels (the DG-LAB Coyote)
// fits without a redesign. No UI copy here: `id` and the channel ids are keys the app translates.

export type ChannelRole = 'vibration' | 'estim';

export const CHANNEL_ROLES: readonly ChannelRole[] = ['vibration', 'estim'];

export interface ChannelSpec {
	/** Stable key, e.g. 'vib' or 'estim' (the Coyote has 'a' and 'b'). */
	readonly id: string;
	readonly role: ChannelRole;
	/** Output resolution: a level x in 0..1 is sent as trunc(x·steps). */
	readonly steps: number;
}

/**
 * What happens to each role while the page is hidden or being closed. 'off' goes to 0 at once; 'keep' holds
 * its level. The user setting "stop everything when I leave the page" overrides this with a full stop.
 */
export type BackgroundAction = 'keep' | 'off';
export type BackgroundPolicy = Readonly<Record<ChannelRole, BackgroundAction>>;

export interface DeviceCapabilities {
	/** Reports its battery level. */
	readonly battery: boolean;
	/** Makes itself felt on every new connection (the UI announces it). */
	readonly buzzesOnConnect: boolean;
	/** Holds its levels while nothing is written (so writes can be change-only). */
	readonly holdsLevels: boolean;
	/** Stops all output by itself when the link is closed cleanly. */
	readonly stopsOnCleanDisconnect: boolean;
	/** Output drains by itself when frames stop arriving (so a lost link or a closed tab silences it). */
	readonly stopsWithoutFrames: boolean;
	/** Has its own controls (dials): it reports its intensity and the app must follow what it reports. */
	readonly dials: boolean;
	/** Keeps caps of its own, written on connecting as a safety layer below the app's. */
	readonly deviceCaps: boolean;
}

/** A further GATT service to open, with the characteristics used in it. */
export interface BleServiceProfile {
	readonly uuid: string;
	readonly characteristics: readonly string[];
}

/** Everything the Web Bluetooth transport needs to find and open the device. */
export interface BleProfile {
	readonly namePrefix: string;
	readonly service: string;
	readonly write: string;
	readonly notify: string;
	/** Services besides `service` (e.g. the one holding battery and version). */
	readonly services?: readonly BleServiceProfile[];
}

export interface DeviceModel {
	/** Stable key for the app (names and copy are translated there). */
	readonly id: string;
	/** What the device advertises over Bluetooth; the picker shows it next to the translated name. */
	readonly advertisedName: string;
	readonly channels: readonly ChannelSpec[];
	readonly capabilities: DeviceCapabilities;
	readonly background: BackgroundPolicy;
	/** Default caps per role (fractions 0..1); the user may lower them. */
	readonly defaultCaps: Readonly<Record<ChannelRole, number>>;
	readonly ble: BleProfile;
}

/** Levels per channel id, 0..1. */
export type ChannelLevels = Readonly<Record<string, number>>;

/** Levels per role, 0..1 (what the engine produces and what the visuals show). */
export type RoleLevels = Readonly<Record<ChannelRole, number>>;

export function quantize(x: number, steps: number): number {
	if (!Number.isFinite(x)) return 0;
	return Math.trunc(Math.min(Math.max(x, 0), 1) * steps);
}

/** Spread role levels over the device's channels (every channel of a role gets the role's level). */
export function channelLevels(model: DeviceModel, roles: RoleLevels): Record<string, number> {
	const out: Record<string, number> = {};
	for (const c of model.channels) out[c.id] = roles[c.role];
	return out;
}

/** The strongest level per role, for display. */
export function roleLevels(model: DeviceModel, levels: ChannelLevels): RoleLevels {
	const out: Record<ChannelRole, number> = { vibration: 0, estim: 0 };
	for (const c of model.channels) out[c.role] = Math.max(out[c.role], levels[c.id] ?? 0);
	return out;
}

export function hasRole(model: DeviceModel, role: ChannelRole): boolean {
	return model.channels.some((c) => c.role === role);
}

export function uuid16(short: string): string {
	return `0000${short.toLowerCase()}-0000-1000-8000-00805f9b34fb`;
}
