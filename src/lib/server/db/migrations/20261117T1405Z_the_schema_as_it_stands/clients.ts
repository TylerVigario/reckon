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
import { sql, type Kysely, type SqlBool } from 'kysely';
import { recorded } from './record.ts';

/** Lowercase words joined by single hyphens: `harbor-light-dental`. A slug is a URL. */
const SLUG = sql`'^[a-z0-9]+(-[a-z0-9]+)*$'`;

export async function clients(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('entity')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text', (c) => c.notNull())
		/**
		 * What this client is called in a URL. Set from the name once and then
		 * left alone -- renaming does not move it, because a link somebody kept is
		 * worth more than a URL that matches the current spelling.
		 */
		.addColumn('slug', 'text', (c) => c.notNull().unique())
		.addColumn('terms_days', 'integer', (c) => c.check(sql`terms_days >= 0`))
		.addColumn('payment_method', 'text')
		.addColumn('tax_exempt', 'boolean', (c) => c.notNull().defaultTo(false))
		.addColumn('exemption_certificate', 'text')
		.addColumn('exemption_expires_on', 'date')
		.addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('entity_slug_is_a_slug', sql`slug ~ ${SLUG}`)
		.addCheckConstraint(
			'exemption_needs_certificate',
			sql`not tax_exempt or exemption_certificate is not null`
		)
		.execute();

	await db.schema
		.createTable('contact')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('email', 'text')
		.addColumn('phone', 'text')
		.addColumn('note', 'text')
		.execute();

	/** Who to ask at a client. One of them may be the one to ask first. */
	await db.schema
		.createTable('entity_contact')
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('cascade'))
		.addColumn('contact_id', 'uuid', (c) =>
			c.notNull().references('contact.id').onDelete('cascade')
		)
		.addColumn('is_primary', 'boolean', (c) => c.notNull().defaultTo(false))
		.addPrimaryKeyConstraint('entity_contact_pkey', ['entity_id', 'contact_id'])
		.execute();
	await db.schema
		.createIndex('entity_one_primary_contact')
		.on('entity_contact')
		.column('entity_id')
		.unique()
		.where(sql<SqlBool>`is_primary`)
		.execute();

	/**
	 * A place a client has work done. Belongs to exactly one client: two clients at
	 * one address are two sites, because they have different contacts, different
	 * access and different bills.
	 */
	await db.schema
		.createTable('site')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('restrict'))
		/**
		 * What this client calls it. 101 Maple St is "Main Street office" to
		 * Harbor Light Dental and "Suite 210" to Pinecrest Insurance, and neither
		 * has to know the other exists.
		 */
		.addColumn('label', 'text', (c) => c.notNull())
		/**
		 * What this site is called in a URL, within its client. Two clients may
		 * both have a "woodland"; they are different places.
		 */
		.addColumn('slug', 'text', (c) => c.notNull())
		.addColumn('street', 'text', (c) => c.notNull())
		.addColumn('city', 'text', (c) => c.notNull())
		.addColumn('region', 'text')
		/**
		 * Required. CDTFA's rate API wants street, city and zip together and
		 * refuses without all three, so an address short of one cannot be priced
		 * -- and an unpriceable address is not a site.
		 */
		.addColumn('postcode', 'text', (c) => c.notNull())
		.addColumn('google_place_id', 'text')
		.addColumn('address_verified_on', 'date')
		/**
		 * The day CDTFA was last asked about this address. A check that changed
		 * nothing still moves it: confirmed today and nobody-has-looked are
		 * different facts and the screens say which.
		 */
		.addColumn('area_verified_on', 'date', (c) => c.notNull())
		/**
		 * From the business and back, and the drive there, by Google's route:
		 * measured whenever the place is chosen and whenever the business moves.
		 * Empty when Google could not say, rather than a figure for where the
		 * site or the business was.
		 */
		.addColumn('google_round_trip_miles', sql`numeric(8, 1)`, (c) =>
			c.check(sql`google_round_trip_miles >= 0`)
		)
		.addColumn('google_drive_minutes', 'integer', (c) => c.check(sql`google_drive_minutes >= 0`))
		/**
		 * The same two, typed over Google's by somebody who knows better. Kept
		 * beside Google's, which stays in view, and dropped when the site moves:
		 * they were about where it was.
		 */
		.addColumn('typed_round_trip_miles', sql`numeric(8, 1)`, (c) =>
			c.check(sql`typed_round_trip_miles >= 0`)
		)
		.addColumn('typed_drive_minutes', 'integer', (c) => c.check(sql`typed_drive_minutes >= 0`))
		/** The figures in force: what was typed, and Google's where nothing was. */
		.addColumn('round_trip_miles', sql`numeric(8, 1)`, (c) =>
			c.generatedAlwaysAs(sql`coalesce(typed_round_trip_miles, google_round_trip_miles)`).stored()
		)
		.addColumn('drive_minutes', 'integer', (c) =>
			c.generatedAlwaysAs(sql`coalesce(typed_drive_minutes, google_drive_minutes)`).stored()
		)
		/**
		 * CDTFA's TAC for the address. Changes when the address moves between
		 * areas, which is the case a rate comparison alone would miss.
		 */
		.addColumn('tax_area_code', 'text', (c) => c.notNull())
		/**
		 * The rate CDTFA returned for this address. Required: there is no such
		 * thing as a site without one, and nothing in the app can author one.
		 */
		.addColumn('tax_rate_pct', sql`numeric(7, 4)`, (c) => c.notNull())
		/**
		 * CDTFA's own name for the area, e.g. UNINCORPORATED AREA-TUOLUMNE. What a
		 * return allocates against, and what a re-check is compared to.
		 */
		.addColumn('tax_jurisdiction', 'text', (c) => c.notNull())
		/**
		 * The state's share of this address's rate, from CDTFA's published layer.
		 * One value statewide -- read rather than assumed, so a change to it
		 * arrives with the next refresh instead of needing a code change.
		 */
		.addColumn('state_rate_pct', sql`numeric(7, 4)`, (c) =>
			c.notNull().check(sql`state_rate_pct >= 0`)
		)
		/**
		 * Everything above the state's share: the district taxes reaching this
		 * address, added together. A county measure and a city measure are both
		 * districts -- CDTFA-105 is a list of districts and makes no other kind.
		 */
		.addColumn('district_rate_pct', sql`numeric(7, 4)`, (c) =>
			c.notNull().check(sql`district_rate_pct >= 0`)
		)
		.addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		/** The label, with the city after it where the label does not already say it. */
		.addColumn('display', 'text', (c) =>
			c
				.generatedAlwaysAs(
					sql`case
						when city is null or city = '' then label
						when position(lower(city) in lower(label)) > 0 then label
						when position(lower(label) in lower(city)) > 0 then label
						else label || ', ' || city
					end`
				)
				.stored()
		)
		.addUniqueConstraint('site_belongs_to_one_client', ['id', 'entity_id'])
		.addUniqueConstraint('site_entity_id_label_key', ['entity_id', 'label'])
		.addUniqueConstraint('site_slug_is_the_clients', ['entity_id', 'slug'])
		.addCheckConstraint('site_slug_is_a_slug', sql`slug ~ ${SLUG}`)
		.addCheckConstraint(
			'site_address_is_complete',
			sql`street <> '' and city <> '' and postcode <> ''`
		)
		.addCheckConstraint('site_verified_rate_pct_check', sql`tax_rate_pct >= 0`)
		.addCheckConstraint(
			'site_rate_parts_sum_to_the_rate',
			sql`state_rate_pct + district_rate_pct = tax_rate_pct`
		)
		.execute();
	await db.schema
		.createIndex('site_by_entity')
		.on('site')
		.column('entity_id')
		.where(sql<SqlBool>`active`)
		.execute();

	/**
	 * Who to ask at this site. A site may name several people and one of them
	 * first; a site naming nobody falls back to the client's primary contact.
	 */
	await db.schema
		.createTable('site_contact')
		.addColumn('site_id', 'uuid', (c) => c.notNull())
		/**
		 * The client, carried so the two foreign keys can agree: the site is this
		 * client's and the contact is this client's. Redundant to read,
		 * load-bearing to write.
		 */
		.addColumn('entity_id', 'uuid', (c) => c.notNull())
		.addColumn('contact_id', 'uuid', (c) => c.notNull())
		.addColumn('is_primary', 'boolean', (c) => c.notNull().defaultTo(false))
		.addPrimaryKeyConstraint('site_contact_pkey', ['site_id', 'contact_id'])
		.addForeignKeyConstraint(
			'site_contact_site_id_entity_id_fkey',
			['site_id', 'entity_id'],
			'site',
			['id', 'entity_id'],
			(f) => f.onDelete('cascade')
		)
		.addForeignKeyConstraint(
			'site_contact_entity_id_contact_id_fkey',
			['entity_id', 'contact_id'],
			'entity_contact',
			['entity_id', 'contact_id'],
			(f) => f.onDelete('cascade')
		)
		.execute();
	await db.schema
		.createIndex('site_one_primary_contact')
		.on('site_contact')
		.column('site_id')
		.unique()
		.where(sql<SqlBool>`is_primary`)
		.execute();

	/**
	 * One row per question put to CDTFA. Kept because a rate that moved is a thing
	 * to explain later -- an invoice at the old figure is correct, and this is both
	 * the evidence of when it changed and the split to post it by.
	 */
	await db.schema
		.createTable('site_tax_check')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('site_id', 'uuid', (c) => c.notNull().references('site.id').onDelete('cascade'))
		.addColumn('checked_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('tax_area_code', 'text')
		.addColumn('tax_jurisdiction', 'text')
		.addColumn('rate_pct', sql`numeric(7, 4)`, (c) => c.check(sql`rate_pct >= 0`))
		.addColumn('state_rate_pct', sql`numeric(7, 4)`)
		.addColumn('district_rate_pct', sql`numeric(7, 4)`)
		/** True where this answer differed from the one before it. */
		.addColumn('changed', 'boolean', (c) => c.notNull().defaultTo(false))
		.addColumn('note', 'text')
		.execute();
	await db.schema
		.createIndex('site_tax_check_by_site')
		.on('site_tax_check')
		.column('site_id')
		.expression(sql`checked_at desc nulls last`)
		.execute();

	await recorded(db, 'entity');
}
