// Work, as it is captured.
//
// A team job is one entry carrying crew = 'team', and worked_by is null because
// more than one person worked it. client_uuid is made in the browser, so an
// entry posted twice after a timeout cannot enter the hour twice.
//
// A trip is one drive, with its stops in order, and each leg goes to whoever
// caused it and records the service it bills -- never more miles than were
// driven.

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, day, decimal, id, nonNegative, oneOf, tstz } from './columns.ts';
import { entity, site } from './clients.ts';
import { service } from './catalogue.ts';
import { user } from './people.ts';

export const CREWS = ['one', 'team'] as const;
export const LEG_RULES = [
	'house_to_a',
	'a_to_b',
	'b_to_house',
	'round_trip',
	'split',
	'unassigned',
	// Given to someone by whoever recorded the trip, rather than by the rule (0025).
	'chosen'
] as const;

export const timeEntry = pgTable(
	'time_entry',
	{
		id: id(),
		clientUuid: uuid().notNull(),
		workedOn: day().notNull(),
		/**
		 * How long it took, in seconds: worked out by the server from the two
		 * moments, never sent. An entry recorded before it kept its times has only
		 * its length.
		 */
		seconds: integer().notNull(),
		/**
		 * When the work started and ended, as moments (UTC), and the zone it was
		 * done in, so it is shown as it was worked: a 9:00 job reads 9:00 to
		 * everyone. All three or none -- an entry recorded as a length alone.
		 */
		startedAt: tstz(),
		endedAt: tstz(),
		zone: text(),
		workedBy: uuid(),
		createdBy: uuid().notNull(),
		entityId: uuid(),
		serviceId: uuid().notNull(),
		billable: boolean().default(true).notNull(),
		note: text(),
		createdAt: createdAt(),
		/**
		 * one: worked_by did it and is paid for it. team: the crew it names in
		 * time_entry_crew did it and each of them is paid, so worked_by is null.
		 */
		crew: text({ enum: CREWS }).notNull(),
		siteId: uuid()
	},
	(t) => [
		unique('time_entry_client_uuid_key').on(t.clientUuid),
		index('time_entry_by_crew').on(t.crew, t.workedOn),
		index('time_entry_entity').on(t.entityId, t.workedOn),
		index('time_entry_site').on(t.siteId),
		index('time_entry_unbilled')
			.on(t.workedOn)
			.where(sql`${t.billable}`),
		foreignKey({
			name: 'time_entry_worked_by_fkey',
			columns: [t.workedBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'time_entry_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'time_entry_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'time_entry_service_id_fkey',
			columns: [t.serviceId],
			foreignColumns: [service.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'time_entry_site_id_fkey',
			columns: [t.siteId],
			foreignColumns: [site.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'time_entry_site_is_the_clients',
			columns: [t.entityId, t.siteId],
			foreignColumns: [site.entityId, site.id]
		}),
		check('billable_work_has_a_payer', sql`(NOT ${t.billable}) OR (${t.entityId} IS NOT NULL)`),
		check(
			'crew_says_who_worked_it',
			sql`((${t.crew} = 'one') AND (${t.workedBy} IS NOT NULL)) OR ((${t.crew} = 'team') AND (${t.workedBy} IS NULL))`
		),
		oneOf('time_entry_crew_check', t.crew, CREWS),
		check('time_entry_seconds_check', sql`${t.seconds} > 0`),
		check(
			'time_entry_times_come_together',
			sql`((${t.startedAt} IS NULL) = (${t.endedAt} IS NULL)) AND ((${t.startedAt} IS NULL) = (${t.zone} IS NULL))`
		),
		check(
			'time_entry_seconds_are_its_times',
			sql`(${t.startedAt} IS NULL) OR ((${t.endedAt} > ${t.startedAt}) AND (${t.seconds} = extract(epoch FROM ${t.endedAt} - ${t.startedAt})))`
		)
	]
);

/**
 * Who was on a team entry: each person on its crew (0023). A one-person entry
 * names its worker in time_entry.worked_by; a team entry names nobody there and
 * everyone here, and is billed at the crew it names -- the first person's rate
 * and the extra-person rate for each other -- and pays each of them.
 */
export const timeEntryCrew = pgTable(
	'time_entry_crew',
	{
		timeEntryId: uuid().notNull(),
		userId: uuid().notNull()
	},
	(t) => [
		primaryKey({ name: 'time_entry_crew_pkey', columns: [t.timeEntryId, t.userId] }),
		index('time_entry_crew_user').on(t.userId),
		foreignKey({
			name: 'time_entry_crew_time_entry_id_fkey',
			columns: [t.timeEntryId],
			foreignColumns: [timeEntry.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'time_entry_crew_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('restrict')
	]
);

/**
 * What a trip is driven in, and whose it is (0024). Its owner is who its miles
 * pay, by the service's vehicle rule, whoever drove it; the business's -- no
 * owner -- pays nobody. Whose it is never changes: one that changes hands is
 * retired and added again, so trips already driven pay who they paid.
 */
export const vehicle = pgTable(
	'vehicle',
	{
		id: id(),
		name: text().notNull(),
		ownerId: uuid(),
		/** The day it stopped being driven. It stays on the trips driven in it. */
		retiredOn: day(),
		createdAt: createdAt()
	},
	(t) => [
		foreignKey({
			name: 'vehicle_owner_id_fkey',
			columns: [t.ownerId],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		check('vehicle_name_is_something', sql`btrim(${t.name}) <> ''`)
	]
);

export const trip = pgTable(
	'trip',
	{
		id: id(),
		travelledOn: day().notNull(),
		drivenBy: uuid().notNull(),
		createdBy: uuid().notNull(),
		createdAt: createdAt(),
		/**
		 * What it was driven in (0024). Null on a trip recorded before trips named
		 * their vehicle: nobody knows whose its miles were, so they pay nobody.
		 */
		vehicleId: uuid(),
		/**
		 * Made where the trip is recorded (0025), so a save that is sent twice is
		 * one trip. Null on a trip recorded before trips were.
		 */
		clientUuid: uuid(),
		/** What it was for, kept with the trip: a mileage log asks why. */
		note: text(),
		/**
		 * The odometer when it left and when it got back, if somebody read it.
		 * Both or neither; the legs are checked against what they say.
		 */
		odometerStart: decimal(9, 1),
		odometerEnd: decimal(9, 1),
		/**
		 * Where it started and ended when that was not the base (the operator's
		 * address): null is the base.
		 */
		startAddress: text(),
		endAddress: text()
	},
	(t) => [
		unique('trip_client_uuid_key').on(t.clientUuid),
		check(
			'trip_odometer_reads_forward',
			sql`((${t.odometerStart} IS NULL) = (${t.odometerEnd} IS NULL)) AND ((${t.odometerStart} IS NULL) OR ((${t.odometerStart} >= 0) AND (${t.odometerEnd} >= ${t.odometerStart})))`
		),
		check(
			'trip_places_are_something',
			sql`(btrim(coalesce(${t.startAddress}, 'x')) <> '') AND (btrim(coalesce(${t.endAddress}, 'x')) <> '')`
		),
		foreignKey({
			name: 'trip_driven_by_fkey',
			columns: [t.drivenBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_vehicle_id_fkey',
			columns: [t.vehicleId],
			foreignColumns: [vehicle.id]
		}).onDelete('restrict')
	]
);

export const tripStop = pgTable(
	'trip_stop',
	{
		id: id(),
		tripId: uuid().notNull(),
		seq: integer().notNull(),
		address: text(),
		/** UNUSED, PLANNED. When the driver got there. Nothing records it yet. */
		arrivedAt: tstz(),
		/** UNUSED, PLANNED. When the driver left. Nothing records it yet. */
		departedAt: tstz(),
		siteId: uuid()
	},
	(t) => [
		unique('trip_stop_trip_id_seq_key').on(t.tripId, t.seq),
		// What a leg names as where it went must be a stop on its own trip.
		unique('trip_stop_trip_id_id_key').on(t.tripId, t.id),
		// A stop is a site, or an address that is nobody's site -- not both.
		check('trip_stop_is_one_place', sql`num_nonnulls(${t.siteId}, ${t.address}) <= 1`),
		foreignKey({
			name: 'trip_stop_trip_id_fkey',
			columns: [t.tripId],
			foreignColumns: [trip.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'trip_stop_site_id_fkey',
			columns: [t.siteId],
			foreignColumns: [site.id]
		}).onDelete('set null')
	]
);

/**
 * Who a stop was for (0025): each client worked for there, at their own site
 * when it is one. Two clients with sites at one address are one stop, one
 * drive. A client who asked once the driver was there caused none of the drive
 * and pays nothing for it. A stop for nobody -- the business's own errand --
 * has none.
 */
export const tripStopClient = pgTable(
	'trip_stop_client',
	{
		tripStopId: uuid().notNull(),
		entityId: uuid().notNull(),
		siteId: uuid(),
		askedThere: boolean().default(false).notNull()
	},
	(t) => [
		primaryKey({ name: 'trip_stop_client_pkey', columns: [t.tripStopId, t.entityId] }),
		foreignKey({
			name: 'trip_stop_client_trip_stop_id_fkey',
			columns: [t.tripStopId],
			foreignColumns: [tripStop.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'trip_stop_client_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_stop_client_site_is_the_clients',
			columns: [t.entityId, t.siteId],
			foreignColumns: [site.entityId, site.id]
		})
	]
);

export const tripLeg = pgTable(
	'trip_leg',
	{
		id: id(),
		tripId: uuid().notNull(),
		seq: integer().notNull(),
		miles: decimal(9, 2).notNull(),
		entityId: uuid(),
		rule: text({ enum: LEG_RULES }),
		siteId: uuid(),
		/** What this leg bills as, so nothing has to assume that only one service is charged per mile. */
		serviceId: uuid(),
		/**
		 * The stop it drove to (0025), so a later drive between the same two places
		 * can start from these miles; null is the way back to where the trip
		 * ended. A drive shared by two clients is two legs to one stop. Null on a
		 * leg recorded before.
		 */
		toStopId: uuid()
	},
	(t) => [
		unique('trip_leg_trip_id_seq_key').on(t.tripId, t.seq),
		foreignKey({
			name: 'trip_leg_to_stop_is_the_trips',
			columns: [t.tripId, t.toStopId],
			foreignColumns: [tripStop.tripId, tripStop.id]
		}).onDelete('cascade'),
		index('trip_leg_entity').on(t.entityId),
		foreignKey({
			name: 'trip_leg_trip_id_fkey',
			columns: [t.tripId],
			foreignColumns: [trip.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'trip_leg_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_leg_site_id_fkey',
			columns: [t.siteId],
			foreignColumns: [site.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_leg_service_id_fkey',
			columns: [t.serviceId],
			foreignColumns: [service.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_leg_site_is_the_clients',
			columns: [t.entityId, t.siteId],
			foreignColumns: [site.entityId, site.id]
		}),
		check(
			'trip_leg_billed_leg_names_its_service',
			sql`(${t.entityId} IS NULL) OR (${t.serviceId} IS NOT NULL)`
		),
		nonNegative('trip_leg_miles_check', t.miles),
		oneOf('trip_leg_rule_check', t.rule, LEG_RULES)
	]
);
