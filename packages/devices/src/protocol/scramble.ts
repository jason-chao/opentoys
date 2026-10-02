// The 12-byte block scrambler used for frames whose header is 0x55 or 0x58 (reference spec §3).
//
// Block = [nonce][11 payload bytes, zero padded]. Each payload byte is mixed with the nonce and a table byte
// whose row is chosen by the previous *scrambled* byte. Obfuscation only: the table is public. The S1 seen so
// far (fw 1) uses the plain header 0x56; this stays for firmware that announces 0x55/0x58.
import { fromHex } from './bytes.ts';

export const BLOCK = 12;
export const PAYLOAD = BLOCK - 1;

export const TABLE: readonly Uint8Array[] = [
	'0C2DB2218863FB4359EA7FC9',
	'F658DE0764BD2AF7004DAD3D',
	'3781035ED312A61765FE30B9',
	'FD4213A83625F469C41D4CCF'
].map(fromHex);

function tableByte(prev: number, i: number): number {
	return TABLE[prev & 3]![i]!;
}

function checkBlock(block: ArrayLike<number>): void {
	if (block.length !== BLOCK) throw new RangeError('block must be 12 bytes');
}

export function scramble(block: ArrayLike<number>): Uint8Array {
	checkBlock(block);
	const k = block[0]!;
	const out = new Uint8Array(BLOCK);
	out[0] = k;
	for (let i = 1; i < BLOCK; i++) {
		const t = tableByte(out[i - 1]!, i);
		out[i] = ((block[i]! ^ t ^ k) + t) & 0xff;
	}
	return out;
}

export function unscramble(block: ArrayLike<number>): Uint8Array {
	checkBlock(block);
	const k = block[0]!;
	const out = new Uint8Array(BLOCK);
	out[0] = k;
	for (let i = 1; i < BLOCK; i++) {
		const t = tableByte(block[i - 1]!, i);
		out[i] = (t ^ ((block[i]! - t) & 0xff) ^ k) & 0xff;
	}
	return out;
}

/** A random nonce byte (Web Crypto: available in browsers and in Node ≥ 19). */
export function randomNonce(): number {
	return globalThis.crypto.getRandomValues(new Uint8Array(1))[0]!;
}

/** Nonce + the first 11 payload bytes (zero padded), scrambled. `nonce` is injectable for tests. */
export function seal(payload: ArrayLike<number>, nonce?: number): Uint8Array {
	const block = new Uint8Array(BLOCK);
	block[0] = (nonce ?? randomNonce()) & 0xff;
	for (let i = 0; i < Math.min(payload.length, PAYLOAD); i++) block[i + 1] = payload[i]! & 0xff;
	return scramble(block);
}

/** The 11 payload bytes of a scrambled block, padding included (nothing stripped). */
export function openBlock(data: ArrayLike<number>): Uint8Array {
	return unscramble(data).slice(1);
}

/** What the vendor app keeps: the payload with trailing zero bytes removed. */
export function openStripped(data: ArrayLike<number>): Uint8Array {
	const p = openBlock(data);
	let n = p.length;
	while (n > 0 && p[n - 1] === 0) n--;
	return p.slice(0, n);
}
