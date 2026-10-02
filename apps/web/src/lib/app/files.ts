// Saving a file for the user and reading one they pick: all local, nothing is uploaded anywhere.

/** Offer JSON as a file download. */
export function download(data: unknown, filename: string): void {
	const blob = new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Read a picked file as JSON (throws on anything that isn't). */
export async function readJsonFile(file: File): Promise<unknown> {
	if (file.size > 20_000_000) throw new Error('file too large');
	return JSON.parse(await file.text());
}
