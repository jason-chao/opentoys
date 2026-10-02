// Small byte helpers shared by the codec, the driver and the tests.

export function toHex(data: ArrayLike<number>): string {
	let s = '';
	for (let i = 0; i < data.length; i++) s += (data[i]! & 0xff).toString(16).padStart(2, '0');
	return s.toUpperCase();
}

export function fromHex(hex: string): Uint8Array {
	const clean = hex.replace(/\s+/g, '');
	if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error(`not a hex string: ${hex}`);
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
	return out;
}

export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
