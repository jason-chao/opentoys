// Numbers, durations and dates in the page's language, always through Intl.
import { getLocale } from '$lib/paraglide/runtime';
import { htmlLang } from '$lib/i18n/locales';

const tag = () => htmlLang[getLocale()];

/** 0..1 as a whole percentage ("45 %", "45%"). */
export const pct = (x: number): string =>
	new Intl.NumberFormat(tag(), { style: 'percent', maximumFractionDigits: 0 }).format(x);

/** A plain number with at most `digits` decimals. */
export const num = (x: number, digits = 1): string =>
	new Intl.NumberFormat(tag(), { maximumFractionDigits: digits }).format(x);

const unit = (n: number, u: 'second' | 'minute' | 'hour', digits = 0) =>
	new Intl.NumberFormat(tag(), {
		style: 'unit',
		unit: u,
		unitDisplay: 'short',
		maximumFractionDigits: digits
	}).format(n);

interface DurationFormatLike {
	format(d: { hours?: number; minutes?: number; seconds?: number }): string;
}
type DurationFormatCtor = new (locale: string, opts: { style: string }) => DurationFormatLike;

/** A length of time: "0.7 sec", "4 sec", "1 min, 50 sec", "12 min". */
export function duration(totalS: number): string {
	if (totalS < 60) return unit(totalS, 'second', totalS < 10 ? 1 : 0);
	const s = Math.round(totalS);
	const hours = Math.floor(s / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = s % 60;
	const DF = (Intl as unknown as { DurationFormat?: DurationFormatCtor }).DurationFormat;
	if (DF) {
		const parts: { hours?: number; minutes?: number; seconds?: number } = {};
		if (hours) parts.hours = hours;
		if (minutes) parts.minutes = minutes;
		if (seconds) parts.seconds = seconds;
		return new DF(tag(), { style: 'short' }).format(parts);
	}
	return [
		hours && unit(hours, 'hour'),
		minutes && unit(minutes, 'minute'),
		seconds && unit(seconds, 'second')
	]
		.filter(Boolean)
		.join(' ');
}

/** A running clock: "0:07", "12:03", "1:02:03". */
export function clock(totalS: number): string {
	const s = Math.max(0, Math.floor(totalS));
	const two = new Intl.NumberFormat(tag(), { minimumIntegerDigits: 2, useGrouping: false });
	const one = new Intl.NumberFormat(tag(), { useGrouping: false });
	const h = Math.floor(s / 3600);
	const mm = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	return h ? `${one.format(h)}:${two.format(mm)}:${two.format(ss)}` : `${one.format(mm)}:${two.format(ss)}`;
}

/** A date and time for the history. */
export const dateTime = (ms: number): string =>
	new Intl.DateTimeFormat(tag(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
