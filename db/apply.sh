#!/usr/bin/env bash
# Apply reckon's migrations, or prove the schema holds what it claims.
#
#   db/apply.sh <database>     apply every migration not yet recorded
#   db/apply.sh --test         build a scratch database, run the guards, drop it
#
# The migrations are Drizzle's: db/migrations holds the SQL and its journal, and
# scripts/migrate.mjs applies them, recording each in drizzle.__drizzle_migrations.
# This script finds that migrator in a clone (app/scripts) or in a release
# (scripts), so the same command works in both.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/migrations"
SUITE="$HERE/test/constraints.sql"
SCRATCH="reckon_ddl_check"

command -v psql >/dev/null || { echo "psql not found" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found" >&2; exit 1; }

MIGRATE=""
for candidate in "$HERE/../app/scripts/migrate.mjs" "$HERE/../scripts/migrate.mjs"; do
  [ -f "$candidate" ] && { MIGRATE="$candidate"; break; }
done
[ -n "$MIGRATE" ] || { echo "scripts/migrate.mjs not found beside db/" >&2; exit 1; }

# How to reach the cluster is libpq's question, answered by PGHOST, PGPORT,
# PGUSER and PGPASSWORD -- the same variables every other Postgres client
# reads. The database is the one named on the command line; DATABASE_URL is the
# application's, and nothing here reads it.
#
# Being the right user is the caller's job, not this script's. A service unit
# says User=; a shell says `sudo -u postgres db/apply.sh ...`. Working it out
# here would put one machine's administration model inside a tool meant to run
# anywhere.

usage() { sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  --test)
    echo "scratch database: $SCRATCH"
    dropdb --if-exists "$SCRATCH" >/dev/null
    createdb "$SCRATCH"
    trap 'dropdb --if-exists "$SCRATCH" >/dev/null' EXIT

    node "$MIGRATE" "$SCRATCH" "$MIGRATIONS"

    psql -q -t -v ON_ERROR_STOP=1 -d "$SCRATCH" -f "$SUITE" 2>&1 \
      | grep -E "NOTICE|ERROR|DETAIL|HINT|CONTEXT|===|All guards" | sed 's/^NOTICE:  //'
    rc=${PIPESTATUS[0]}

    if [ "$rc" -ne 0 ]; then
      echo >&2
      echo "A guard did not hold. Exit $rc." >&2
      exit "$rc"
    fi
    echo
    echo "Schema and guards verified, scratch database dropped."
    ;;

  ""|-h|--help)
    usage
    ;;

  *)
    DB="$1"
    # -d postgres for both cluster-level questions. Without it psql connects
    # to a database named after the OS user, which on most machines does not
    # exist, and the error would name the wrong database entirely.
    psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" \
      | grep -q 1 || { echo "database '$DB' does not exist" >&2; exit 1; }

    # Whoever owns the database owns everything the migrations create. An app
    # connecting as the owner is refused tables made by another role, so the
    # migrator runs as the owner rather than as whoever invoked this.
    OWNER=$(psql -d postgres -tAc \
      "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='$DB'")

    node "$MIGRATE" "$DB" "$MIGRATIONS" "$OWNER"

    # An object owned by anyone else is invisible to the app, and the failure
    # arrives as "permission denied" from whichever query happens to reach it
    # first -- a long way from the cause.
    stray=$(psql -tAq -d "$DB" -c "
      SELECT string_agg(c.relkind::text || ' ' || c.relname, ', ' ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r','v','m','S')
         AND pg_get_userbyid(c.relowner) <> '$OWNER'")
    if [ -n "$stray" ]; then
      echo >&2
      echo "Not owned by $OWNER: $stray" >&2
      echo "The application connects as the owner and cannot see these." >&2
      echo "They were made by a different role -- reapply as $OWNER, or:" >&2
      echo "  ALTER TABLE <name> OWNER TO $OWNER;" >&2
      exit 1
    fi
    echo "Up to date. Every object in public and drizzle is owned by $OWNER."
    ;;
esac
