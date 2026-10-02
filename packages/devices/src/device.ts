// What the app and the controllers need from a connected device driver. ConnectedDevice is common to every
// driver (Dragon S1, Coyote 3.0); Device adds what the level-based output loop (Controller) drives.
import type { ChannelLevels, DeviceModel } from './model.ts';
import type { DisconnectInfo } from './transport.ts';

export type DeviceErrorCode =
	| 'missing-characteristic' // not a supported device
	| 'not-identified' // the device did not identify itself
	| 'legacy-firmware' // old firmware without the e-stim protocol
	| 'header-unknown' // output asked for before the handshake finished
	| 'recovery-mode' // the device is in its update mode: recognisable, not controllable
	| 'not-connected';

/** Errors carry a code the app translates; the message is for logs. */
export class DeviceError extends Error {
	readonly code: DeviceErrorCode;
	constructor(code: DeviceErrorCode, message: string) {
		super(message);
		this.name = 'DeviceError';
		this.code = code;
	}
}

export type DeviceEvent =
	| { kind: 'header'; header: number; scrambled: boolean }
	| {
			kind: 'status';
			battery: number | null;
			fw: number | null;
			hw: number | null;
			stateByte: number | null;
			crcOk: boolean | null;
			raw: string;
	  }
	| { kind: 'mac'; mac: string; raw: string }
	| { kind: 'chip'; model: number; vendor: number; raw: string }
	| { kind: 'legacy'; fw: number | null; battery: number | null; raw: string }
	| { kind: 'other'; cmd: number | null; crcOk: boolean | null; raw: string };

export interface DeviceInfo {
	readonly model: string;
	readonly battery: number | null;
	readonly frames: number;
	readonly replies: number;
}

/** What every driver offers, whatever its output looks like. */
export interface ConnectedDevice {
	readonly model: DeviceModel;
	readonly connected: boolean;
	readonly battery: number | null;
	info(): DeviceInfo;
	onDisconnect(listener: (info: DisconnectInfo) => void): () => void;
	disconnect(): Promise<void>;
}

/** A device driven by levels per channel (the Dragon S1). */
export interface Device extends ConnectedDevice {
	/** Clock time (ms) of the last write, -Infinity before the first. */
	readonly lastWriteAt: number;
	/** Absolute level per channel id (0 turns that channel off). */
	output(levels: ChannelLevels): Promise<void>;
	/** Silence every channel, whatever the firmware variant. */
	stop(): Promise<void>;
	/** Ask for a status frame (battery); the device may send none unless written to. */
	poll(): Promise<void>;
	/** Milliseconds without an answer while we have been writing (0 when not writing or answered). */
	silentFor(): number;
	onEvent(listener: (e: DeviceEvent) => void): () => void;
}
