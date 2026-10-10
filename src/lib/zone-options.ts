import { zoneName } from './format.ts';

/**
 * Every time zone, as a list to choose from: "Los Angeles — Pacific Time",
 * sorted, so typing a city's first letters finds it. Built from Intl's own
 * list, once; the value saved is the zone's name, which the server checks
 * against Postgres before storing it.
 */
let all: { value: string; label: string }[] | null = null;
function zones(): { value: string; label: string }[] {
	all ??= Intl.supportedValuesOf('timeZone')
		.map((zone) => {
			const city = zone.split('/').pop()?.replaceAll('_', ' ') ?? zone;
			const name = zoneName(zone);
			return { value: zone, label: name === zone ? city : `${city} — ${name}` };
		})
		.sort((a, b) => a.label.localeCompare(b.label));
	return all;
}

/**
 * The list for a field holding `current`. A stored name Intl spells differently
 * (an older alias) is kept at the top, so the field still shows what is there.
 * `blank` adds an empty choice at the head, labelled as given.
 */
export function zoneOptions(
	current: string | null,
	blank?: string
): { value: string; label: string }[] {
	const list = zones();
	const extra =
		current && !list.some((z) => z.value === current)
			? [{ value: current, label: `${current} — ${zoneName(current)}` }]
			: [];
	return [...(blank === undefined ? [] : [{ value: '', label: blank }]), ...extra, ...list];
}
