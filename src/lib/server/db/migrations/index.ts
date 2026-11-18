// Every migration, by name.
//
// A migration is frozen once it has run anywhere: a change is a new one after
// it, never an edit to one before. Each takes Kysely<any> and imports nothing
// of the app's, so it does today what it did the day it was written. As
// Kysely's documentation puts it, migrations "need to be 'frozen in time'".
//
// A name begins with the moment it was written, in ISO 8601's basic form
// (20261117T1405Z), because Kysely runs migrations in the order their names
// sort, and refuses one that sorts before a migration already run.
//
// Listed here rather than read from a folder, so the server's bundle and
// scripts/migrate.mjs's carry them: nothing is looked for on disk at runtime.
import type { Migration } from 'kysely/migration';
import * as theSchemaAsItStands from './20261117T1405Z_the_schema_as_it_stands/index.ts';
import * as agreementsNeverTie from './20261117T2356Z_agreements_never_tie.ts';
import * as placesAndPieces from './20261118T0438Z_places_and_pieces.ts';
import * as aLineKeepsItsPieces from './20261118T0528Z_a_line_keeps_its_pieces.ts';
import * as aSiteKeepsItsPlacements from './20261118T0605Z_a_site_keeps_its_placements.ts';
import * as theBusinessCollectsByState from './20261118T1721Z_the_business_collects_by_state.ts';

export const MIGRATIONS: Readonly<Record<string, Migration>> = {
	'20261117T1405Z_the_schema_as_it_stands': theSchemaAsItStands,
	'20261117T2356Z_agreements_never_tie': agreementsNeverTie,
	'20261118T0438Z_places_and_pieces': placesAndPieces,
	'20261118T0528Z_a_line_keeps_its_pieces': aLineKeepsItsPieces,
	'20261118T0605Z_a_site_keeps_its_placements': aSiteKeepsItsPlacements,
	'20261118T1721Z_the_business_collects_by_state': theBusinessCollectsByState
};
