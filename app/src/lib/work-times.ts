/**
 * Past work as a start, a length and an end: the start and one other, and the
 * third follows.
 *
 * The start is the anchor. A start and a length give the end; a start and an
 * end give the length. Changed afterwards, a start moves the end and keeps the
 * length, a length moves the end, and an end changes the length. An end earlier
 * in the day than the start is the next day, and the work is still dated the
 * day it started.
 *
 * ALL OF IT IN THE ZONE THE WORK WAS DONE IN, through Temporal, on the phone,
 * with no server call. A length is real elapsed time: two hours from 00:30 on
 * the night the clocks go back ends at 01:30 the second time round. A time a
 * clock change skips is read as Temporal reads it by default, an hour later.
 * What the server keeps is the two moments, and it works out the length again
 * itself.
 */

/** The moment a clock in `zone` reads `time` ("09:00") on `day` ("2026-10-04"). */
export function at(day: string, time: string, zone: string): Temporal.ZonedDateTime {
	return Temporal.PlainDate.from(day).toZonedDateTime({
		timeZone: zone,
		plainTime: Temporal.PlainTime.from(time)
	});
}

/**
 * The last moment, at or before `now`, a clock in `zone` read `time`: today's,
 * or yesterday's while today's is still to come. When a running timer started,
 * told as a time of day.
 */
export function lastAt(time: string, zone: string, now: Temporal.Instant): Temporal.ZonedDateTime {
	const today = now.toZonedDateTimeISO(zone).toPlainDate();
	const then = at(today.toString(), time, zone);
	return Temporal.Instant.compare(then.toInstant(), now) <= 0
		? then
		: at(today.subtract({ days: 1 }).toString(), time, zone);
}

/** Where work ends that started at `start` and took `seconds`. */
export function endAfter(start: Temporal.ZonedDateTime, seconds: number): Temporal.ZonedDateTime {
	return start.add({ seconds });
}

/**
 * Work that started at `start` and ended when the clock read `end`: the same
 * day, or the next when `end` is earlier. Its length in seconds, and whether it
 * ran into the next day. An end that is the start is no work at all.
 */
export function endingAt(
	start: Temporal.ZonedDateTime,
	end: string
): { ended: Temporal.ZonedDateTime; seconds: number; nextDay: boolean } {
	const sameDay = at(start.toPlainDate().toString(), end, start.timeZoneId);
	const nextDay = Temporal.ZonedDateTime.compare(sameDay, start) < 0;
	const ended = nextDay
		? at(start.toPlainDate().add({ days: 1 }).toString(), end, start.timeZoneId)
		: sameDay;
	return { ended, seconds: start.until(ended).total('seconds'), nextDay };
}

/** A clock's reading as a time field holds it: "09:05". */
export const clockOf = (t: Temporal.ZonedDateTime) =>
	t.toPlainTime().toString({ smallestUnit: 'minute' });

/**
 * A length as people type one, in seconds: "2:40" for hours and minutes, "4.5"
 * or "4.5h" for hours, "45m" for minutes. Null when empty, NaN when it is none
 * of these.
 */
export function parseLength(text: string): number | null {
	const v = text.trim().toLowerCase();
	if (!v) return null;
	let m = /^(\d+):([0-5]?\d)$/.exec(v);
	if (m) return (Number(m[1]) * 60 + Number(m[2])) * 60;
	m = /^(\d+(?:\.\d+)?)\s*h?$/.exec(v);
	if (m) return Math.round(Number(m[1]) * 60) * 60;
	m = /^(\d+)\s*m$/.exec(v);
	if (m) return Number(m[1]) * 60;
	return NaN;
}

/** A length as the box shows it, to the minute: 9600 is "2:40". */
export function lengthText(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
