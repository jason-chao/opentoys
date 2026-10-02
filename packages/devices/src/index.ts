// Device/Transport interfaces (channels by role: vibration, estim); the Dragon S1 driver (frames, scrambler,
// notify parser, handshake, stop = zero frame + stop command, reply watchdog) and the Coyote 3.0 driver (pulse
// frames, intensity reports, soft caps); simulated devices for tests and the preview; the output controllers
// (the in-page safety chain) and the browser lifecycle glue.
import { COYOTE_3 } from './coyote/model.ts';
import type { DeviceModel } from './model.ts';
import { DRAGON_S1 } from './s1/model.ts';

/** The Dragon S1's wire protocol. */
export * as protocol from './protocol/index.ts';
/** The Coyote 3.0's wire protocol. */
export * as coyoteProtocol from './coyote/protocol.ts';

export { type Clock, intervalScheduler, type Scheduler, sleep, systemClock } from './clock.ts';
export { Emitter, type Listener } from './emitter.ts';
export {
	type BackgroundAction,
	type BackgroundPolicy,
	type BleProfile,
	type BleServiceProfile,
	CHANNEL_ROLES,
	type ChannelLevels,
	channelLevels,
	type ChannelRole,
	type ChannelSpec,
	type DeviceCapabilities,
	type DeviceModel,
	hasRole,
	quantize,
	type RoleLevels,
	roleLevels,
	uuid16
} from './model.ts';
export type { DisconnectInfo, Transport } from './transport.ts';
export {
	type ConnectedDevice,
	type Device,
	DeviceError,
	type DeviceErrorCode,
	type DeviceEvent,
	type DeviceInfo
} from './device.ts';

export {
	DRAGON_S1,
	isDragonS1Name,
	S1_CHAR_NOTIFY,
	S1_CHAR_WRITE,
	S1_NAME_TOKEN,
	S1_SERVICE
} from './s1/model.ts';
export { BURST_GAP_MS, S1Driver, type S1Info, type S1InitOptions } from './s1/driver.ts';

export {
	FakeRing,
	type FakeRingEvents,
	FakeRingLink,
	type FakeRingOptions,
	type FakeRingOutput
} from './fake/fake-ring.ts';

export {
	COYOTE_3,
	COYOTE_ADV_SERVICE,
	COYOTE_CHAR_BATTERY,
	COYOTE_CHAR_MAC,
	COYOTE_CHAR_NOTIFY,
	COYOTE_CHAR_VERSION,
	COYOTE_CHAR_WRITE,
	COYOTE_CHANNELS,
	COYOTE_INTENSITY_MAX,
	COYOTE_NAME_PREFIX,
	COYOTE_SERVICE,
	COYOTE_SERVICE_INFO,
	type CoyoteChannel,
	coyoteNameKind,
	type CoyoteNameKind,
	isCoyoteName
} from './coyote/model.ts';
export {
	type CoyoteCaps,
	type CoyoteDevice,
	CoyoteDriver,
	type CoyoteEvent,
	type CoyoteInfo,
	type CoyoteOpenOptions
} from './coyote/driver.ts';
export type { ChannelCommand, LedColour } from './coyote/protocol.ts';

export {
	FakeCoyote,
	type FakeCoyoteChannelOutput,
	type FakeCoyoteEvents,
	FakeCoyoteLink,
	type FakeCoyoteOptions,
	type FakeCoyoteOutput
} from './fake/fake-coyote.ts';

export {
	COYOTE_STOP_REASONS,
	type CoyoteChannelOut,
	CoyoteController,
	type CoyoteControllerEvents,
	type CoyoteControllerOptions,
	type CoyoteEngine,
	type CoyoteFrame,
	type CoyoteOut
} from './controller/coyote-controller.ts';

export {
	type BackgroundOutcome,
	Controller,
	type ControllerEvents,
	type ControllerOptions,
	type ControllerState,
	type LeaveTrigger,
	type LinkLossReason,
	type Out,
	type OutputEngine,
	type OutputKind,
	type SentOutput,
	STOP_REASONS
} from './controller/controller.ts';

export {
	attachLifecycle,
	type Lifecycle,
	type LifecycleController,
	type LifecycleDocument,
	type LifecycleOptions
} from './browser/lifecycle.ts';
export { type WakeLockLike, WakeLockKeeper, type WakeLockSentinelLike } from './browser/wake-lock.ts';

/** Every supported model by id. */
export const MODELS: Readonly<Record<string, DeviceModel>> = {
	[DRAGON_S1.id]: DRAGON_S1,
	[COYOTE_3.id]: COYOTE_3
};
