// The Bananasome Dragon S1: a vibration + e-stim ring (facts verified on hardware, reference spec §8).
import { type DeviceModel, uuid16 } from '../model.ts';

export const S1_SERVICE = uuid16('ae3a');
export const S1_CHAR_WRITE = uuid16('ae3b'); // write without response
export const S1_CHAR_NOTIFY = uuid16('ae3c');
/** The name it advertises (public address, service 0xAE3A in the advert, no manufacturer data). */
export const S1_NAME_TOKEN = 'YLS01';

export const DRAGON_S1: DeviceModel = {
	id: 'dragon-s1',
	advertisedName: S1_NAME_TOKEN,
	channels: [
		{ id: 'vib', role: 'vibration', steps: 255 },
		{ id: 'estim', role: 'estim', steps: 255 }
	],
	capabilities: {
		battery: true,
		buzzesOnConnect: true, // every new connection makes the ring buzz
		holdsLevels: true, // both channels hold their level when frames stop
		stopsOnCleanDisconnect: true, // a clean disconnect stops both channels
		stopsWithoutFrames: false,
		dials: false,
		deviceCaps: false
	},
	// Follows the reference implementation: leaving the page turns e-stim off at once, vibration keeps running.
	background: { vibration: 'keep', estim: 'off' },
	// E-stim felt from ~2 %, comfortable up to 80 % (one wearer); 90–100 % never tested.
	defaultCaps: { vibration: 1, estim: 0.8 },
	ble: { namePrefix: S1_NAME_TOKEN, service: S1_SERVICE, write: S1_CHAR_WRITE, notify: S1_CHAR_NOTIFY }
};

export function isDragonS1Name(name: string | null | undefined): boolean {
	return !!name && name.trim().includes(S1_NAME_TOKEN);
}
