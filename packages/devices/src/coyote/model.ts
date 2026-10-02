// The DG-LAB Coyote 3.0: two e-stim channels, A and B (facts verified in the reference implementation on firmware 7).
import { type DeviceModel, uuid16 } from '../model.ts';

export const COYOTE_SERVICE = uuid16('180c'); // commands
export const COYOTE_CHAR_WRITE = uuid16('150a'); // write without response
export const COYOTE_CHAR_NOTIFY = uuid16('150b');
export const COYOTE_SERVICE_INFO = uuid16('180a');
export const COYOTE_CHAR_BATTERY = uuid16('1500'); // read + notify, once a second
export const COYOTE_CHAR_VERSION = uuid16('1501'); // read
export const COYOTE_CHAR_MAC = uuid16('1502'); // read (seen on firmware 7)
/** The start of the name it advertises. */
export const COYOTE_NAME_PREFIX = '47L121000';
/** The service UUID its advertisement carries (not the one the GATT table uses). */
export const COYOTE_ADV_SERVICE = '0000180c-0fe2-f5aa-a094-84b8d4f3e8ad';
/** Intensity runs 0..200 per channel, and is shown as that number. */
export const COYOTE_INTENSITY_MAX = 200;

export type CoyoteChannel = 'a' | 'b';
export const COYOTE_CHANNELS: readonly CoyoteChannel[] = ['a', 'b'];

export const COYOTE_3: DeviceModel = {
	id: 'coyote-3',
	advertisedName: COYOTE_NAME_PREFIX,
	channels: [
		{ id: 'a', role: 'estim', steps: COYOTE_INTENSITY_MAX },
		{ id: 'b', role: 'estim', steps: COYOTE_INTENSITY_MAX }
	],
	capabilities: {
		battery: true, // notified once a second
		buzzesOnConnect: false,
		holdsLevels: false,
		stopsOnCleanDisconnect: true,
		stopsWithoutFrames: true, // a frame lasts 100 ms; output drains when they stop
		dials: true, // it reports its intensity (B1) and the app follows
		deviceCaps: true // BF soft caps, written on connecting
	},
	// Leaving the page is a full stop for this device, until the user turns it on again.
	background: { vibration: 'off', estim: 'off' },
	// 100 of 200 per channel (the reference implementation's default); raised only after a confirmation in Settings.
	defaultCaps: { vibration: 0, estim: 0.5 },
	ble: {
		namePrefix: COYOTE_NAME_PREFIX,
		service: COYOTE_SERVICE,
		write: COYOTE_CHAR_WRITE,
		notify: COYOTE_CHAR_NOTIFY,
		services: [
			{
				uuid: COYOTE_SERVICE_INFO,
				characteristics: [COYOTE_CHAR_BATTERY, COYOTE_CHAR_VERSION, COYOTE_CHAR_MAC]
			}
		]
	}
};

// Names like `47L121000_O3` (seen at MAC+1) and `Dfu12345` are a device's update identity.
const RECOVERY_NAME = /^(47L\d{6}_O[0-9A-F]{1,2}|Dfu\d{5})$/;

export type CoyoteNameKind = 'supported' | 'recovery';

/**
 * What an advertised name says: a Coyote 3.0 we can drive, a device in recovery / update mode (recognisable,
 * never connectable for control: the app tells the user), or null for anything else.
 */
export function coyoteNameKind(name: string | null | undefined): CoyoteNameKind | null {
	if (!name) return null;
	if (RECOVERY_NAME.test(name) || name.startsWith('Dfu')) return 'recovery';
	return name.startsWith(COYOTE_NAME_PREFIX) ? 'supported' : null;
}

export function isCoyoteName(name: string | null | undefined): boolean {
	return coyoteNameKind(name) === 'supported';
}
