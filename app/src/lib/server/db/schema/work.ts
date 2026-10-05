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
	'unassigned'
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
		 * one: worked_by did it and is paid for it. team: the team did it and every
		 * active team member is paid, so worked_by is null.
		 */
		crew: text({ enum: CREWS }).notNull(),
		siteId: uuid()
	},
	(t) => [
		unique('time_entry_client_uuid_key').on(t.clientUuid),
		index('time_entry_crew').on(t.crew, t.workedOn),
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

export const trip = pgTable(
	'trip',
	{
		id: id(),
		travelledOn: day().notNull(),
		drivenBy: uuid().notNull(),
		createdBy: uuid().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		foreignKey({
			name: 'trip_driven_by_fkey',
			columns: [t.drivenBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'trip_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
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
		serviceId: uuid()
	},
	(t) => [
		unique('trip_leg_trip_id_seq_key').on(t.tripId, t.seq),
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
