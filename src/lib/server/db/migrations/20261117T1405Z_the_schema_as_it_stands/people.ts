// People, the capacity they are paid in, what they can reach, and how they
// sign in.
//
// user, session, account and verification are Better Auth's, in the shape its
// database adapter reads: it finds them by these names and these fields. They
// are kept by hand rather than generated because the conventions here differ
// from its generator's output: ids are uuids the database makes (so Better
// Auth runs with advanced.database.generateId false), timestamps carry their
// zone, and emails are stored lowercased. When its config gains a plugin that
// adds fields, generate into a scratch file and carry them across.
//
// There are no passwords: everyone signs in with a passkey (#lib/server/passkeys).
// account.password is Better Auth's own column, and the database keeps it empty.
import { sql, type Kysely, type SqlBool } from 'kysely';
import { recorded } from './record.ts';

/** Has `table`'s updated_at stamped by the database on every update. */
async function stampsUpdatedAt(db: Kysely<any>, table: string): Promise<void> {
	await sql`create trigger stamp_updated_at before update on ${sql.table(table)}
		for each row execute function stamp_updated_at()`.execute(db);
}

export async function people(db: Kysely<any>): Promise<void> {
	// updated_at is when the row last changed, and the database stamps it on
	// every update, whoever writes it -- Better Auth sets it on its own writes,
	// and reckon writes user directly -- as PostgreSQL's own trigger example
	// does (PL/pgSQL, Example 41.3, which stamps last_date). A person's history
	// leaves it out (h_user): a stamp is not a change to them.
	await sql`
		create function stamp_updated_at() returns trigger
		language plpgsql as $function$
		BEGIN
		  NEW.updated_at := now();
		  RETURN NEW;
		END $function$`.execute(db);

	/**
	 * The operator's own list of the capacities people are paid in -- Partner,
	 * Employee, Contractor, or whatever a business calls them. Pay rules are
	 * written against these, so a business names its own rather than inheriting
	 * ours.
	 */
	await db.schema
		.createTable('role')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text', (c) => c.notNull().unique())
		/**
		 * What its pay is (pays_as), which decides where it is reported: a
		 * partner's guaranteed payments, an employee's wages, a contractor's fees.
		 * A fixed list, where the role's name is the business's own.
		 *
		 * Null is not said: a role the business named before reckon asked, whose
		 * work is owed at no figure anyone can pay until it says.
		 */
		.addColumn('pays_as', sql`pays_as`)
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('role_name_is_something', sql`btrim(name) <> ''`)
		.execute();

	// The three roles every operator starts with say theirs. Any other is not
	// said until the business says it: reckon does not guess what a name means.
	await db
		.insertInto('role')
		.values([
			{ name: 'Partner', pays_as: 'guaranteed_payment' },
			{ name: 'Employee', pays_as: 'wages' },
			{ name: 'Contractor', pays_as: 'fee' }
		])
		.execute();

	/**
	 * Anyone who can sign in. Signing in is an account row, so a user without one
	 * cannot; there is no sign-up. Someone with Full adds people on Team, and the
	 * first person is added from the command line (scripts/user.mjs).
	 */
	await db.schema
		.createTable('user')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('email', 'text', (c) => c.notNull().unique())
		/**
		 * Whether that address is proven theirs (Better Auth's name for it): true
		 * once they have used a link reckon emailed there (email_link) -- a
		 * change's link among them, which makes the address it went to theirs --
		 * and false whenever it is changed without one.
		 */
		.addColumn('email_verified', 'boolean', (c) => c.notNull().defaultTo(false))
		.addColumn('image', 'text')
		/**
		 * The capacity this person is paid in, now. Null means they sign in and
		 * are not paid. It is a current value, not a history: a role change
		 * reprices nothing already worked out.
		 */
		.addColumn('role_id', 'uuid', (c) => c.references('role.id').onDelete('restrict'))
		/**
		 * Whether they are on the team. Deactivated on Team, they can't sign in,
		 * aren't offered work and aren't ticked on a team; everything they did is
		 * kept.
		 */
		.addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
		/**
		 * What they can reach, apart from what they are paid as: Full or Field,
		 * and which routes each reaches is #lib/access. Someone new starts with
		 * Field, and the database keeps one active person on Full.
		 */
		.addColumn('access', sql`access`, (c) => c.notNull().defaultTo('field'))
		/**
		 * When they last signed in, with a passkey (#lib/server/passkeys). Null is
		 * none recorded: they never have.
		 */
		.addColumn('last_signed_in_at', 'timestamptz')
		/**
		 * The zone this person keeps their days in, as Postgres names it. Their
		 * own timesheet, the day a new entry starts on, and every moment shown to
		 * them are on this clock (#lib/server/calendar). Set from their browser
		 * the first time they sign in, and theirs to change; null until then,
		 * which follows the business's zone.
		 */
		.addColumn('timezone', 'text')
		/**
		 * How dates and figures read for this person: a locale, as BCP 47 writes
		 * one ("en-GB") -- language, the order of day and month, the separators.
		 * Null follows the business's locale. Theirs to set, in their profile.
		 */
		.addColumn('locale', 'text')
		/** A 12- or 24-hour clock, over what their locale says. Null keeps the locale's. */
		.addColumn('hour_cycle', sql`hour_cycle`)
		/** The day their week starts, 1 for Monday to 7 for Sunday. Null keeps the locale's. */
		.addColumn('week_start', 'smallint', (c) => c.check(sql`week_start between 1 and 7`))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('user_email_lowercase', sql`email = lower(email)`)
		.execute();
	await stampsUpdatedAt(db, 'user');

	// Someone active keeps Full, or nobody could change anyone's access again:
	// refused for whatever leaves active people and none of them on Full -- the
	// last one moved to Field, made inactive, or removed, or a first person added
	// with Field.
	await sql`
		create function someone_keeps_full() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF EXISTS (SELECT 1 FROM "user" WHERE active)
		     AND NOT EXISTS (SELECT 1 FROM "user" WHERE active AND access = 'full') THEN
		    RAISE EXCEPTION 'nobody active would have Full access, and someone has to'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'someone_keeps_full';
		  END IF;
		  RETURN NULL;
		END $function$`.execute(db);
	await sql`create trigger someone_keeps_full after insert or update of access, active or delete on "user"
		for each statement execute function someone_keeps_full()`.execute(db);

	/**
	 * One row per signed-in browser. Deleting it signs that browser out; deleting
	 * a user's rows signs them out everywhere.
	 */
	await db.schema
		.createTable('session')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('user_id', 'uuid', (c) => c.notNull().references('user.id').onDelete('cascade'))
		.addColumn('token', 'text', (c) => c.notNull().unique())
		.addColumn('expires_at', 'timestamptz', (c) => c.notNull())
		.addColumn('ip_address', 'text')
		.addColumn('user_agent', 'text')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('a_session_must_end', sql`expires_at > created_at`)
		.execute();
	await db.schema.createIndex('session_by_user').on('session').column('user_id').execute();
	await stampsUpdatedAt(db, 'session');

	/** How a user signs in. For a password, provider_id is "credential". */
	await db.schema
		.createTable('account')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('user_id', 'uuid', (c) => c.notNull().references('user.id').onDelete('cascade'))
		.addColumn('account_id', 'text', (c) => c.notNull())
		.addColumn('provider_id', 'text', (c) => c.notNull())
		.addColumn('access_token', 'text')
		.addColumn('refresh_token', 'text')
		.addColumn('id_token', 'text')
		.addColumn('access_token_expires_at', 'timestamptz')
		.addColumn('refresh_token_expires_at', 'timestamptz')
		.addColumn('scope', 'text')
		/** Better Auth's, for a password: always empty, as there are none. */
		.addColumn('password', 'text')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('account_holds_no_password', sql`password is null`)
		.execute();
	await db.schema.createIndex('account_by_user').on('account').column('user_id').execute();
	await stampsUpdatedAt(db, 'account');

	/** Better Auth's one-time values. Nothing here issues any yet. */
	await db.schema
		.createTable('verification')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('identifier', 'text', (c) => c.notNull())
		.addColumn('value', 'text', (c) => c.notNull())
		.addColumn('expires_at', 'timestamptz', (c) => c.notNull())
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.execute();
	await db.schema
		.createIndex('verification_by_identifier')
		.on('verification')
		.column('identifier')
		.execute();
	await stampsUpdatedAt(db, 'verification');

	/**
	 * Better Auth's own count of requests to its routes, kept here rather than in
	 * memory so a restart forgives nothing: one row per address and route, how
	 * many it has made in the window, and when the last was, in milliseconds
	 * (#lib/server/auth).
	 */
	await db.schema
		.createTable('rate_limit')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('key', 'text', (c) => c.notNull().unique())
		.addColumn('count', 'integer', (c) => c.notNull())
		.addColumn('last_request', 'bigint', (c) => c.notNull())
		.execute();

	/**
	 * A passkey: a key pair made on someone's phone, computer or security key, of
	 * which only the public half is here (#lib/server/auth). The columns are Better
	 * Auth's passkey plugin's, as it reads and writes them, but for last_used_at
	 * and last_used_from, which are reckon's: when it last signed someone in, and
	 * the browser and system it did so from ("Chrome on Windows"), for Your
	 * profile to show, so a sign-in that wasn't theirs stands out.
	 *
	 * name is what it is called: its passkey manager's name when it is made, else
	 * the browser and system it was made on (#lib/server/passkeys beforeKeeping),
	 * until they rename it. device_type is WebAuthn's: a key kept on one device
	 * (singleDevice) or synced between someone's devices by their passkey manager
	 * (multiDevice), and backed_up is whether it is synced now. aaguid names the
	 * kind of authenticator that made it, Google Password Manager or Windows
	 * Hello, where it says; Apple's say nothing.
	 */
	await db.schema
		.createTable('passkey')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text')
		.addColumn('public_key', 'text', (c) => c.notNull())
		.addColumn('user_id', 'uuid', (c) => c.notNull().references('user.id').onDelete('cascade'))
		// One credential is one passkey: the plugin does not ask for this itself.
		.addColumn('credential_id', 'text', (c) => c.notNull().unique())
		.addColumn('counter', 'integer', (c) => c.notNull())
		.addColumn('device_type', sql`passkey_device_type`, (c) => c.notNull())
		.addColumn('backed_up', 'boolean', (c) => c.notNull())
		.addColumn('transports', 'text')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('aaguid', 'text')
		.addColumn('last_used_at', 'timestamptz')
		.addColumn('last_used_from', 'text')
		.addCheckConstraint('passkey_counter_not_negative', sql`counter >= 0`)
		.execute();
	await db.schema.createIndex('passkey_by_user').on('passkey').column('user_id').execute();

	/**
	 * A LINK reckon emailed someone (#lib/server/links), good once, for an hour:
	 * NIST SP 800-63A-4 §3.8 allows a code confirming an email address 24 hours,
	 * and SP 800-63B-4 §4.2.1.2 a recovery code sent by email the same, and a link
	 * to make a passkey is a way in, so it lasts as one handed over does. Using
	 * one also proves the person reads mail at the address it went to.
	 *
	 * The code itself is never kept: code_hash is its SHA-256, and the code is 256
	 * random bits, so the hash cannot be worked back to it. It works only while
	 * sent_to is still the address its person signs in with, and they are active
	 * -- except a change's, which went to the address they are to sign in with
	 * instead, and makes it theirs.
	 *
	 * A new link for a passkey ends any other not yet used, as does a new
	 * confirmation or a new change: one of each can be waiting at a time. A link
	 * used is kept 90 days, the record of a passkey made or an address confirmed
	 * or changed.
	 */
	await db.schema
		.createTable('email_link')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('user_id', 'uuid', (c) => c.notNull().references('user.id').onDelete('cascade'))
		/**
		 * What an emailed link is for: to make a first passkey, on being added on
		 * Team or at the command line; to make a new one for someone who can't
		 * sign in, sent the same way (a "reset", which adds one and ends none); to
		 * confirm the address one signs in with, asked for on Your profile; or to
		 * make a new address the one they sign in with, asked for on Team.
		 */
		.addColumn('purpose', sql`email_link_purpose`, (c) => c.notNull())
		/** The SHA-256 of the code. Never the code. */
		.addColumn('code_hash', 'bytea', (c) => c.notNull().unique())
		/** The address it went to, which using it proves: for a change, the new one. */
		.addColumn('sent_to', 'text', (c) => c.notNull())
		.addColumn('expires_at', 'timestamptz', (c) => c.notNull())
		/** When it was used. Null is not yet: it cannot be used twice. */
		.addColumn('used_at', 'timestamptz')
		/** Who had it sent: someone with Full, or the person themselves. */
		.addColumn('sent_by', 'uuid', (c) => c.references('user.id').onDelete('set null'))
		.addCheckConstraint('email_link_code_hash_is_a_sha256', sql`octet_length(code_hash) = 32`)
		.addCheckConstraint('email_link_sent_to_lowercase', sql`sent_to = lower(sent_to)`)
		.addCheckConstraint(
			'email_link_lasts_an_hour_at_most',
			sql`expires_at > created_at and expires_at <= created_at + interval '1 hour'`
		)
		.addCheckConstraint(
			'email_link_used_while_it_worked',
			sql`used_at is null or used_at between created_at and expires_at`
		)
		.execute();
	await db.schema
		.createIndex('email_link_one_passkey_link_waiting')
		.on('email_link')
		.column('user_id')
		.unique()
		.where(sql<SqlBool>`used_at is null and purpose in ('invite', 'reset')`)
		.execute();
	await db.schema
		.createIndex('email_link_one_confirmation_waiting')
		.on('email_link')
		.column('user_id')
		.unique()
		.where(sql<SqlBool>`used_at is null and purpose = 'confirm'`)
		.execute();
	await db.schema
		.createIndex('email_link_one_change_waiting')
		.on('email_link')
		.column('user_id')
		.unique()
		.where(sql<SqlBool>`used_at is null and purpose = 'change'`)
		.execute();
	await db.schema
		.createIndex('email_link_by_user')
		.on('email_link')
		.columns(['user_id', 'created_at'])
		.execute();

	/**
	 * Every code tried at a link that was not one to use -- unknown, used, lapsed
	 * -- by the network it came from (#lib/server/links), so a network that keeps
	 * trying is turned away: NIST SP 800-63B-4 §4.2.1.2 holds an emailed code to
	 * the throttling of §3.2.2. A code is 256 random bits, which no number of
	 * tries finds; the limit is the standard's, and costs a person nothing. Kept a
	 * day.
	 */
	await db.schema
		.createTable('link_try')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('address', sql`inet`, (c) => c.notNull())
		.addColumn('network', sql`cidr`, (c) => c.notNull())
		.addCheckConstraint('link_try_address_in_network', sql`address <<= network`)
		.execute();
	await db.schema
		.createIndex('link_try_by_network')
		.on('link_try')
		.columns(['network', 'created_at'])
		.execute();

	/**
	 * THE SECURITY LOG (12 November 2026): every sign-in, refused or not, every
	 * passkey and link, everyone added or changed, every access change and every
	 * refusal for lack of it (ASVS 5.0 16.3.1-16.3.3), each also a line in the
	 * server's log (#lib/server/events). Each person sees their own, on Your
	 * profile, and someone with Full everyone's, on Team.
	 *
	 * It stands. The database stamps each with its own clock, whatever the row
	 * says; none is ever changed; and one is removed only once it is a year old,
	 * which the server does every day (PCI DSS 10.5.1's twelve months; GitHub
	 * keeps a person's 90 days). Triggers hold all of it, which only the table's
	 * owner could switch off, and the server's role owns nothing (README, "The
	 * database"). Someone in it is made inactive, never deleted: OWASP's "always
	 * best to archive users rather than deleting".
	 */
	await db.schema
		.createTable('security_event')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		/**
		 * What happened to how someone signs in and what they can reach, each
		 * named as OWASP's Logging Vocabulary names it, and in its style where it
		 * has no name: it has none for a passkey, a link, or someone made active
		 * again (#lib/server/events). Closed, so the README's list of them is the
		 * list.
		 */
		.addColumn('name', sql`security_event_name`, (c) => c.notNull())
		/** Whom it is about: who signed in, was refused, or was changed. Null where nobody is known. */
		.addColumn('user_id', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		/** Who did it, where it was someone else: someone with Full, on Team. */
		.addColumn('by_id', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		/** Where the request came from, as adapter-node resolved it. */
		.addColumn('client_address', sql`inet`)
		/** The browser's own word for itself, cut to 512 characters. */
		.addColumn('user_agent', 'text')
		/** What else it says: a reason, from and to, which passkey. Never a secret. */
		.addColumn('detail', 'jsonb')
		.addCheckConstraint('security_event_user_agent_bounded', sql`length(user_agent) <= 512`)
		.addCheckConstraint('security_event_by_someone_else', sql`by_id is null or by_id <> user_id`)
		.execute();
	await db.schema
		.createIndex('security_event_by_user')
		.on('security_event')
		.columns(['user_id', 'at'])
		.execute();
	await db.schema
		.createIndex('security_event_by_whom')
		.on('security_event')
		.columns(['by_id', 'at'])
		.execute();
	await db.schema.createIndex('security_event_by_when').on('security_event').column('at').execute();

	// A SECURITY EVENT STANDS (12 November 2026). The database stamps each one
	// with its own clock, whatever the row says; none is ever changed; and one is
	// removed only once it is a year old, which the server does itself every day
	// (#lib/server/events prune). Triggers rather than grants, so reckon names no
	// role (README, "The database"): only the table's owner could switch them
	// off, and the server's role owns nothing. TRUNCATE, which fires no delete
	// trigger, is not the server's to use.
	await sql`
		create function security_event_stamped() returns trigger
		language plpgsql as $function$
		BEGIN
		  NEW.at := now();
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create function security_event_stands() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF TG_OP = 'DELETE' AND OLD.at < now() - interval '1 year' THEN
		    RETURN OLD;
		  END IF;
		  RAISE EXCEPTION 'a security event stands: it is never %d, and removed only once a year old',
		    lower(TG_OP) USING ERRCODE = 'integrity_constraint_violation';
		END $function$`.execute(db);
	await sql`create trigger stamped before insert on security_event
		for each row execute function security_event_stamped()`.execute(db);
	await sql`create trigger stands before update or delete on security_event
		for each row execute function security_event_stands()`.execute(db);

	await recorded(db, 'user', { ignoring: ['updated_at', 'last_signed_in_at'] });
}
