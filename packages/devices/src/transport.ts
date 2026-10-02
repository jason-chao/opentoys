// A connected GATT link: Web Bluetooth in the browser, or a simulated device (preview and tests).

export interface DisconnectInfo {
	/** True when our side asked for it (disconnect()); false for a lost link. */
	readonly requested: boolean;
}

export interface Transport {
	readonly connected: boolean;
	hasCharacteristic(uuid: string): boolean;
	/** Write without response. Implementations serialise writes (GATT operations must not overlap). */
	write(characteristic: string, data: Uint8Array): Promise<void>;
	/** Read a characteristic's value. */
	read(characteristic: string): Promise<Uint8Array>;
	subscribe(characteristic: string, listener: (data: Uint8Array) => void): Promise<void>;
	/** Called once when the link goes down; returns the function that unsubscribes. */
	onDisconnect(listener: (info: DisconnectInfo) => void): () => void;
	/** Close the link cleanly. */
	disconnect(): Promise<void>;
}
