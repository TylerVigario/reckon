<script lang="ts">
	import { secondsAsHours, zoneName } from '#lib/format.ts';
	import type { EntryChoices, EntryFields, EntrySeed } from '#lib/entry-form.ts';
	import { tick, untrack, type Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import Octicon from '#lib/Octicon.svelte';
	import WorkFields from '#lib/WorkFields.svelte';
	import { focusFirstInvalid, workErrors } from '#lib/work-fields.ts';
	import { personalZone } from '#lib/zone.svelte.ts';
	import { at, clockOf, endAfter, endingAt, lengthText, parseLength } from '#lib/work-times.ts';

	/**
	 * A time entry's form: what the work was (#lib/WorkFields), and when -- the
	 * day, and a start and one other of how long and when it ended, the third
	 * worked out as they are typed, offline. Add past work opens it empty, or
	 * filled in from an entry the server refused; an entry's own screen opens
	 * it filled in from the entry, to change it. A field it cannot be saved
	 * with says why under it, as Primer's forms do. What saving does is theirs
	 * (`onsave`), which says why not, or nothing once it is done; `above`
	 * draws over the form, `below` under it.
	 */
	let {
		choices,
		field,
		seed = null,
		saveLabel,
		savingLabel = 'Saving…',
		cancel,
		onsave,
		above,
		below
	}: {
		choices: EntryChoices;
		/** Someone with Field enters only work they were on: their own, or a team's with them on it. */
		field: boolean;
		seed?: EntrySeed | null;
		saveLabel: string;
		savingLabel?: string;
		/** Where Cancel goes. */
		cancel: ResolvedPathname;
		onsave: (entry: EntryFields) => Promise<string | null>;
		above?: Snippet;
		below?: Snippet;
	} = $props();

	const data = untrack(() => choices);
	const first = untrack(() => seed);

	// Whatever a seed names that is no longer there is left empty to choose again.
	const known = (list: { id: string }[], v: string | null | undefined) =>
		v && list.some((x) => x.id === v) ? v : null;
	const seededEntity = first ? known(data.entities, first.entity_id) : null;

	let entityId = $state<string | null>(seededEntity);
	let siteId = $state<string | null>(
		first
			? known(data.entities.find((e) => e.id === seededEntity)?.sites ?? [], first.site_id)
			: null
	);
	// Opens on a priced service, never one nothing can be billed under: hourly
	// first, since this form records time.
	let serviceId = $state<string | null>(
		first
			? known(data.services, first.service_id)
			: ((() => {
					const priced = (s: { id: string }) => data.prices.some((p) => p.service_id === s.id);
					return (
						data.services.find((s) => s.unit === 'hour' && priced(s)) ??
						data.services.find(priced) ??
						data.services[0]
					)?.id;
				})() ?? null)
	);
	let crew = $state<'one' | 'team'>(first?.crew ?? 'one');
	let workedBy = $state<string | null>(
		first ? (first.crew === 'team' ? data.me : known(data.people, first.worked_by)) : data.me
	);
	// Who is on a team: everyone holding a role, unless some are unticked; or
	// whom the seed named, of those who can still be on one.
	let crewIds = $state<string[]>(
		first?.crew === 'team' && first.crew_ids
			? data.people.filter((p) => first.crew_ids!.includes(p.id)).map((p) => p.id)
			: data.people.map((p) => p.id)
	);

	// WHEN: a day, and a start, a length and an end, any two of which give the
	// third (#lib/work-times), worked out here as they are typed, offline. Not
	// every entry is today's -- an evening spent writing up Tuesday is the
	// ordinary case, so the day is asked for rather than assumed. A timed
	// entry is shown on the clock it was worked on; one recorded as a length
	// alone has no start to show, and may be saved as a length again.
	const timed =
		first?.started_at && first.ended_at && first.zone
			? { started_at: first.started_at, ended_at: first.ended_at, zone: first.zone }
			: null;
	const clockIn = (moment: string, z: string) =>
		clockOf(Temporal.Instant.from(moment).toZonedDateTimeISO(z));
	let day = $state(first?.worked_on ?? data.today);
	let zone = $state(timed ? timed.zone : untrack(() => personalZone()));
	let start = $state(timed ? clockIn(timed.started_at, timed.zone) : '');
	let length = $state(first ? lengthText(first.seconds) : '');
	let end = $state(timed ? clockIn(timed.ended_at, timed.zone) : '');
	// Whether any of the four has been touched since the form was filled in.
	let moved = $state(false);
	let billable = $state(first?.billable ?? true);
	let note = $state(first?.note ?? '');
	let saving = $state(false);
	let why = $state('');
	let errors = $state<Record<string, string>>({});
	let form = $state<HTMLFormElement | null>(null);

	const seconds = $derived(parseLength(length));
	const took = $derived(seconds !== null && seconds > 0 ? seconds : null);
	const hours = $derived(took === null ? null : secondsAsHours(took));
	const nextDay = $derived(
		day && start && end ? endingAt(at(day, start, zone), end).nextDay : false
	);

	/**
	 * The start is the anchor. A changed start or day moves the end and keeps the
	 * length; a changed length moves the end; a changed end changes the length.
	 * Until there is a start, whatever else is typed waits for one.
	 */
	function follow(changed: 'start' | 'length' | 'end') {
		moved = true;
		if (!day || !start) return;
		const from = at(day, start, zone);
		if (changed === 'end') {
			if (end) length = lengthText(endingAt(from, end).seconds);
			return;
		}
		const len = parseLength(length);
		if (len !== null && len > 0) end = clockOf(endAfter(from, len));
		else if (changed === 'start' && end) length = lengthText(endingAt(from, end).seconds);
	}

	/** Why the times as typed cannot be saved, by the field to say it under. */
	function whenErrors(untimed: boolean): Record<string, string> {
		if (!day || day > data.today)
			return { day: 'Pick the day it was worked. It cannot be in the future.' };
		if (!start && !untimed) return { start: 'When it started.' };
		if (took === null) return { length: 'How long it took, or when it ended.' };
		if (took >= 86_400)
			return { length: 'Under a day. Work that ran longer is more than one entry.' };
		return {};
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		why = '';
		// One recorded as a length alone, with no start given: saved as a length again.
		const untimed = !!first && !first.started_at && !start;
		errors = {
			...workErrors(
				{ entityId, siteId, serviceId, crew, workedBy, crewIds, billable, note },
				false
			),
			...whenErrors(untimed)
		};

		// The two moments, worked out where the work was done. Times nobody
		// touched are kept to the second, as they were recorded.
		let when: Pick<EntryFields, 'started_at' | 'ended_at' | 'zone' | 'minutes'> | null = null;
		const kept = moved ? null : timed;
		if (took !== null && !errors.day && !errors.start && !errors.length) {
			if (untimed) when = { minutes: Math.round(took / 60) };
			else if (kept) when = kept;
			else {
				const from = at(day, start, zone);
				const to = endAfter(from, took);
				if (Temporal.Instant.compare(to.toInstant(), Temporal.Now.instant()) > 0)
					errors.end = 'That ends after now. Still working? Start a timer instead.';
				else
					when = {
						started_at: from.toInstant().toString(),
						ended_at: to.toInstant().toString(),
						zone
					};
			}
		}
		if (Object.keys(errors).length || !when || !serviceId) {
			await tick();
			focusFirstInvalid(form);
			return;
		}
		saving = true;
		const refused = await onsave({
			worked_on: day,
			...when,
			crew,
			worked_by: crew === 'team' ? null : workedBy,
			// A copy: a $state proxy is not something IndexedDB will store.
			...(crew === 'team' ? { crew_ids: [...crewIds] } : {}),
			entity_id: entityId,
			site_id: siteId,
			service_id: serviceId,
			billable,
			note: note.trim() || null
		});
		saving = false;
		if (refused) why = refused;
	}
</script>

{#snippet wrong(key: string)}
	{#if errors[key]}<p class="fc-e" id="m-{key}-e"><Octicon name="alert" />{errors[key]}</p>{/if}
{/snippet}

{@render above?.()}

{#if why}
	<div class="banner crit" role="alert">
		<Octicon name="alert" />
		<div class="banner-m"><p class="banner-t">{why}</p></div>
	</div>
{/if}

<form class="box form" novalidate onsubmit={save} bind:this={form}>
	<div class="box-row fields">
		<WorkFields
			choices={data}
			{field}
			id="m"
			{errors}
			bind:entityId
			bind:siteId
			bind:serviceId
			bind:crew
			bind:workedBy
			bind:crewIds
			bind:billable
			bind:note
		>
			{#snippet when()}
				<!-- The start and one other; the third fills itself in, and any of
				     the three can be changed after. -->
				<fieldset class="fc" aria-describedby="m-when-c">
					<legend class="fc-l">When</legend>
					<p class="fc-c" id="m-when-c">
						The day, when it started, and when it ended or how long it took: the third fills itself
						in{zone !== personalZone() ? `, on the clock in ${zoneName(zone)}` : ''}.
					</p>
					<div class="fc">
						<label class="fc-l sub" for="m-day">Day</label>
						<input
							id="m-day"
							class="ti"
							type="date"
							max={data.today}
							value={day}
							aria-invalid={errors.day ? 'true' : undefined}
							aria-describedby={errors.day ? 'm-day-e' : undefined}
							oninput={(e) => {
								day = e.currentTarget.value;
								follow('start');
							}}
						/>
						{@render wrong('day')}
					</div>
					<div class="two">
						<div class="fc">
							<label class="fc-l sub" for="m-start">Started</label>
							<input
								id="m-start"
								class="ti"
								type="time"
								value={start}
								aria-invalid={errors.start ? 'true' : undefined}
								aria-describedby={errors.start ? 'm-start-e' : undefined}
								oninput={(e) => {
									start = e.currentTarget.value;
									follow('start');
								}}
							/>
							{@render wrong('start')}
						</div>
						<div class="fc">
							<label class="fc-l sub" for="m-end">Ended</label>
							<input
								id="m-end"
								class="ti"
								type="time"
								value={end}
								aria-invalid={errors.end ? 'true' : undefined}
								aria-describedby={errors.end ? 'm-end-e' : nextDay ? 'm-end-c' : undefined}
								oninput={(e) => {
									end = e.currentTarget.value;
									follow('end');
								}}
							/>
							{#if errors.end}
								{@render wrong('end')}
							{:else if nextDay}
								<p class="fc-c" id="m-end-c">The next day</p>
							{/if}
						</div>
					</div>
					<div class="fc">
						<label class="fc-l sub" for="m-length">Took</label>
						<input
							id="m-length"
							class="ti"
							inputmode="text"
							autocomplete="off"
							placeholder="2:40"
							value={length}
							aria-invalid={errors.length ? 'true' : undefined}
							aria-describedby={errors.length ? 'm-length-e m-length-c' : 'm-length-c'}
							oninput={(e) => {
								length = e.currentTarget.value;
								follow('length');
							}}
						/>
						{@render wrong('length')}
						<!-- The three shapes the parser takes, said out loud. A box
						     labelled "Duration" with "2:40" greyed in it is a guess
						     about whether 4.5 or 45m will be understood. -->
						<p class="fc-c" id="m-length-c">
							{hours ? `${hours}. ` : ''}2:40 for hours and minutes, 4.5 for hours, 45m for minutes.
						</p>
					</div>
				</fieldset>
			{/snippet}
		</WorkFields>
	</div>
	<div class="box-row keep">
		<button class="btn pri" disabled={saving}>{saving ? savingLabel : saveLabel}</button>
		<a class="btn" href={cancel}>Cancel</a>
	</div>
</form>

{@render below?.()}

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 16px;
	}
	.fields > :global(*) {
		max-width: 480px;
	}
	/* The times inside When: lighter than a field of their own. */
	.sub {
		font-weight: var(--base-text-weight-normal);
	}
	fieldset.fc {
		gap: 12px;
	}
	.two {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 12px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 16px;
		background: var(--bgColor-muted);
	}
</style>
