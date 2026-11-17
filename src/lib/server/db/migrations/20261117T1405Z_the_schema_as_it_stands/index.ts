// THE SCHEMA AS IT STOOD ON 17 NOVEMBER 2026, whole, in one migration. The
// migrations after it change it a step at a time.
//
// Split by what the tables are about, as the diagrams in docs/schema are, and
// run in the order their references need: the words first (types.ts), then
// the history every recorded table's triggers write through (record.ts).
import type { Kysely } from 'kysely';
import { agreements } from './agreements.ts';
import { catalogue } from './catalogue.ts';
import { clients } from './clients.ts';
import { mail } from './mail.ts';
import { money } from './money.ts';
import { operator } from './operator.ts';
import { pay } from './pay.ts';
import { people } from './people.ts';
import { record } from './record.ts';
import { types } from './types.ts';
import { work } from './work.ts';

export async function up(db: Kysely<any>): Promise<void> {
	await types(db);
	await record(db);
	await people(db);
	await clients(db);
	await catalogue(db);
	await work(db);
	await agreements(db);
	await money(db);
	await pay(db);
	await operator(db);
	await mail(db);
}
