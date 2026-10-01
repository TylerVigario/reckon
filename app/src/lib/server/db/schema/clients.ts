// Who is billed, and where the work happens.
//
// A client is a business; a site is a place, and a site is one client's. Two
// clients at one address are two sites, each named the client's own way --
// they have different contacts, different access and different histories, and
// they are billed to different people. site.label is what the client calls it.
//
// A person is shared: one person can be the contact for several clients. What
// is per client and per site is who is named where, and site_contact carries
// the client so that two foreign keys can agree -- the site is that client's,
// and the person is that client's contact.
//
// A site carries the rate CDTFA's API returned for its address, and every
// answer is kept, so an invoice issued before today is split by what CDTFA
// said at the time.

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
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, day, decimal, id, nonNegative, slugFormat, tstz } from './columns';

export const entity = pgTable(
	'entity',
	{
		id: id(),
		name: text().notNull(),
		termsDays: integer(),
		paymentMethod: text(),
		taxExempt: boolean().default(false).notNull(),
		exemptionCertificate: text(),
		exemptionExpiresOn: day(),
		active: boolean().default(true).notNull(),
		createdAt: createdAt(),
		/**
		 * What this client is called in a URL. Set from the name once and then
		 * left alone -- renaming does not move it, because a link somebody kept is
		 * worth more than a URL that matches the current spelling.
		 */
		slug: text().notNull()
	},
	(t) => [
		unique('entity_slug_key').on(t.slug),
		slugFormat('entity_slug_is_a_slug', t.slug),
		nonNegative('entity_terms_days_check', t.termsDays),
		check(
			'exemption_needs_certificate',
			sql`(NOT ${t.taxExempt}) OR (${t.exemptionCertificate} IS NOT NULL)`
		)
	]
);

export const contact = pgTable('contact', {
	id: id(),
	name: text().notNull(),
	email: text(),
	phone: text(),
	note: text()
});

export const entityContact = pgTable(
	'entity_contact',
	{
		entityId: uuid().notNull(),
		contactId: uuid().notNull(),
		isPrimary: boolean().default(false).notNull()
	},
	(t) => [
		primaryKey({ name: 'entity_contact_pkey', columns: [t.entityId, t.contactId] }),
		uniqueIndex('entity_one_primary_contact')
			.on(t.entityId)
			.where(sql`${t.isPrimary}`),
		foreignKey({
			name: 'entity_contact_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'entity_contact_contact_id_fkey',
			columns: [t.contactId],
			foreignColumns: [contact.id]
		}).onDelete('cascade')
	]
);

/**
 * A place a client has work done. Belongs to exactly one client: two clients at
 * one address are two sites, because they have different contacts, different
 * access and different bills.
 */
export const site = pgTable(
	'site',
	{
		id: id(),
		entityId: uuid().notNull(),
		/**
		 * What this client calls it. 101 Maple St is "Main Street office" to
		 * Harbor Light Dental and "Suite 210" to Pinecrest Insurance, and neither
		 * has to know the other exists.
		 */
		label: text().notNull(),
		street: text().notNull(),
		city: text().notNull(),
		region: text(),
		/**
		 * Required. CDTFA's rate API wants street, city and zip together and
		 * refuses without all three, so an address short of one cannot be priced
		 * -- and an unpriceable address is not a site.
		 */
		postcode: text().notNull(),
		googlePlaceId: text(),
		addressVerifiedOn: day(),
		/**
		 * The day CDTFA was last asked about this address. A check that changed
		 * nothing still moves it: confirmed today and nobody-has-looked are
		 * different facts and the screens say which.
		 */
		areaVerifiedOn: day().notNull(),
		roundTripMiles: decimal(8, 1),
		driveMinutes: integer(),
		active: boolean().default(true).notNull(),
		createdAt: createdAt(),
		/** The label, with the city after it where the label does not already say it. */
		display: text().generatedAlwaysAs(
			sql`CASE
    WHEN ((city IS NULL) OR (city = ''::text)) THEN label
    WHEN (POSITION((lower(city)) IN (lower(label))) > 0) THEN label
    WHEN (POSITION((lower(label)) IN (lower(city))) > 0) THEN label
    ELSE ((label || ', '::text) || city)
END`
		),
		/**
		 * CDTFA's TAC for the address. Changes when the address moves between
		 * areas, which is the case a rate comparison alone would miss.
		 */
		taxAreaCode: text().notNull(),
		/**
		 * The rate CDTFA returned for this address. Required: there is no such
		 * thing as a site without one, and nothing in the app can author one.
		 */
		taxRatePct: decimal(7, 4).notNull(),
		/**
		 * CDTFA's own name for the area, e.g. UNINCORPORATED AREA-TUOLUMNE. What a
		 * return allocates against, and what a re-check is compared to.
		 */
		taxJurisdiction: text().notNull(),
		/**
		 * The state's share of this address's rate, from CDTFA's published layer.
		 * One value statewide -- read rather than assumed, so a change to it
		 * arrives with the next refresh instead of needing a code change.
		 */
		stateRatePct: decimal(7, 4).notNull(),
		/**
		 * Everything above the state's share: the district taxes reaching this
		 * address, added together. A county measure and a city measure are both
		 * districts -- CDTFA-105 is a list of districts and makes no other kind.
		 */
		districtRatePct: decimal(7, 4).notNull(),
		/**
		 * What this site is called in a URL, within its client. Two clients may
		 * both have a "woodland"; they are different places.
		 */
		slug: text().notNull()
	},
	(t) => [
		unique('site_belongs_to_one_client').on(t.id, t.entityId),
		unique('site_entity_id_label_key').on(t.entityId, t.label),
		unique('site_slug_is_the_clients').on(t.entityId, t.slug),
		index('site_by_entity')
			.on(t.entityId)
			.where(sql`${t.active}`),
		foreignKey({
			name: 'site_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		check(
			'site_address_is_complete',
			sql`(${t.street} <> '') AND (${t.city} <> '') AND (${t.postcode} <> '')`
		),
		nonNegative('site_district_rate_pct_check', t.districtRatePct),
		nonNegative('site_drive_minutes_check', t.driveMinutes),
		check(
			'site_rate_parts_sum_to_the_rate',
			sql`(${t.stateRatePct} + ${t.districtRatePct}) = ${t.taxRatePct}`
		),
		nonNegative('site_round_trip_miles_check', t.roundTripMiles),
		slugFormat('site_slug_is_a_slug', t.slug),
		nonNegative('site_state_rate_pct_check', t.stateRatePct),
		nonNegative('site_verified_rate_pct_check', t.taxRatePct)
	]
);

/**
 * Who to ask at this site. A site may name several people and one of them
 * first; a site naming nobody falls back to the client's primary contact.
 */
export const siteContact = pgTable(
	'site_contact',
	{
		siteId: uuid().notNull(),
		/**
		 * The client, carried so the two foreign keys can agree: the site is this
		 * client's and the contact is this client's. Redundant to read,
		 * load-bearing to write.
		 */
		entityId: uuid().notNull(),
		contactId: uuid().notNull(),
		isPrimary: boolean().default(false).notNull()
	},
	(t) => [
		primaryKey({ name: 'site_contact_pkey', columns: [t.siteId, t.contactId] }),
		uniqueIndex('site_one_primary_contact')
			.on(t.siteId)
			.where(sql`${t.isPrimary}`),
		foreignKey({
			name: 'site_contact_site_id_entity_id_fkey',
			columns: [t.siteId, t.entityId],
			foreignColumns: [site.id, site.entityId]
		}).onDelete('cascade'),
		foreignKey({
			name: 'site_contact_entity_id_contact_id_fkey',
			columns: [t.entityId, t.contactId],
			foreignColumns: [entityContact.entityId, entityContact.contactId]
		}).onDelete('cascade')
	]
);

/**
 * One row per question put to CDTFA. Kept because a rate that moved is a thing
 * to explain later -- an invoice at the old figure is correct, and this is both
 * the evidence of when it changed and the split to post it by.
 */
export const siteTaxCheck = pgTable(
	'site_tax_check',
	{
		id: id(),
		siteId: uuid().notNull(),
		checkedAt: tstz().defaultNow().notNull(),
		taxAreaCode: text(),
		taxJurisdiction: text(),
		ratePct: decimal(7, 4),
		/** True where this answer differed from the one before it. */
		changed: boolean().default(false).notNull(),
		note: text(),
		stateRatePct: decimal(7, 4),
		districtRatePct: decimal(7, 4)
	},
	(t) => [
		index('site_tax_check_by_site').on(t.siteId, t.checkedAt.desc()),
		foreignKey({
			name: 'site_tax_check_site_id_fkey',
			columns: [t.siteId],
			foreignColumns: [site.id]
		}).onDelete('cascade'),
		nonNegative('site_tax_check_rate_pct_check', t.ratePct)
	]
);
