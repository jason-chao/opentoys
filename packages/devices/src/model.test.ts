// The device model must take a device with two e-stim channels (a future DG-LAB Coyote) without a redesign.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from './controller/controller.ts';
import type { Device, DeviceEvent } from './device.ts';
import { MODELS } from './index.ts';
import {
	channelLevels,
	type ChannelLevels,
	type DeviceModel,
	hasRole,
	quantize,
	roleLevels
} from './model.ts';
import { DRAGON_S1 } from './s1/model.ts';
import { TestEngine } from './testing/test-engine.ts';
import type { DisconnectInfo } from './transport.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const TWO_ESTIM: DeviceModel = {
	id: 'two-estim-example',
	advertisedName: 'EXAMPLE',
	channels: [
		{ id: 'a', role: 'estim', steps: 200 },
		{ id: 'b', role: 'estim', steps: 200 }
	],
	capabilities: {
		battery: true,
		buzzesOnConnect: false,
		holdsLevels: false,
		stopsOnCleanDisconnect: true,
		stopsWithoutFrames: true,
		dials: true,
		deviceCaps: true
	},
	background: { vibration: 'off', estim: 'off' },
	defaultCaps: { vibration: 0, estim: 0.5 },
	ble: { namePrefix: 'EXAMPLE', service: 'x', write: 'y', notify: 'z' }
};

class MockDevice implements Device {
	readonly model: DeviceModel;
	connected = true;
	battery: number | null = null;
	lastWriteAt = -Infinity;
	readonly outputs: ChannelLevels[] = [];
	stops = 0;
	constructor(model: DeviceModel) {
		this.model = model;
	}
	async output(levels: ChannelLevels): Promise<void> {
		this.lastWriteAt = Date.now();
		this.outputs.push(levels);
	}
	async stop(): Promise<void> {
		this.stops++;
	}
	async poll(): Promise<void> {}
	silentFor(): number {
		return 0;
	}
	info() {
		return { model: this.model.id, battery: null, frames: 0, replies: 0 };
	}
	onEvent(listener: (e: DeviceEvent) => void): () => void {
		void listener;
		return () => {};
	}
	onDisconnect(listener: (info: DisconnectInfo) => void): () => void {
		void listener;
		return () => {};
	}
	async disconnect(): Promise<void> {}
}

describe('device model', () => {
	it('describes the Dragon S1 with keys only', () => {
		expect(DRAGON_S1).toMatchObject({ id: 'dragon-s1', advertisedName: 'YLS01' });
		expect(DRAGON_S1.background).toEqual({ vibration: 'keep', estim: 'off' });
		expect(DRAGON_S1.defaultCaps.estim).toBe(0.8);
		expect(DRAGON_S1.ble.service).toBe('0000ae3a-0000-1000-8000-00805f9b34fb');
		expect(MODELS['dragon-s1']).toBe(DRAGON_S1);
	});

	it('maps roles to channels and back', () => {
		expect(channelLevels(DRAGON_S1, { vibration: 0.3, estim: 0.1 })).toEqual({ vib: 0.3, estim: 0.1 });
		expect(channelLevels(TWO_ESTIM, { vibration: 0.3, estim: 0.1 })).toEqual({ a: 0.1, b: 0.1 });
		expect(roleLevels(TWO_ESTIM, { a: 0.1, b: 0.4 })).toEqual({ vibration: 0, estim: 0.4 });
		expect(hasRole(TWO_ESTIM, 'vibration')).toBe(false);
		expect(quantize(0.5, 200)).toBe(100);
		expect(quantize(NaN, 200)).toBe(0);
	});

	it('drives a device with two e-stim channels, and its policy stops it on leaving the page', async () => {
		const dev = new MockDevice(TWO_ESTIM);
		const engine = new TestEngine();
		const c = new Controller({ engine });
		c.attach(dev);
		engine.setManual(0, 0.25);
		await vi.advanceTimersByTimeAsync(50);
		expect(dev.outputs.at(-1)).toEqual({ a: 0.25, b: 0.25 });
		expect(c.leavePage('hidden')).toBe('stop');
		expect(dev.stops).toBe(1);
	});
});
