#!/usr/bin/env bash
# Apply reckon's migrations, or prove the schema holds what it claims.
#
#   db/apply.sh <database>     apply every migration not yet recorded
#   db/apply.sh --test         build a scratch database, run the guards, drop it
#
# Self-contained: no shared library and every check inline, so it can be read
# in one pass and run from a clone.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/migrations"
SUITE="$HERE/test/constraints.sql"
SCRATCH="reckon_ddl_check"

command -v psql >/dev/null || { echo "psql not found" >&2; exit 1; }

# How to reach the cluster is libpq's question, answered by PGHOST, PGUSER,
# PGPASSWORD, PGDATABASE or DATABASE_URL -- the same variables every other
# Postgres client reads. This script adds nothing to that.
#
# Being the right user is the caller's job, not this script's. A service unit
# says User=; a shell says `sudo -u postgres db/apply.sh ...`. An earlier
# version tried to work it out and took RECKON_SUDO to be told, which put one
# machine's administration model inside a tool meant to run anywhere -- and
# created the ownership problem --fix-owner then existed to clean up, because
# objects were made by a role that did not own the database.
#
# SQL goes over stdin rather than -f, so it works when the connecting role
# cannot read the file.

usage() { sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  --test)
    echo "scratch database: $SCRATCH"
    dropdb --if-exists "$SCRATCH" >/dev/null
    createdb "$SCRATCH"
    trap 'dropdb --if-exists "$SCRATCH" >/dev/null' EXIT

    cat "$MIGRATIONS"/*.sql "$SUITE" \
      | psql -q -t -v ON_ERROR_STOP=1 -d "$SCRATCH" 2>&1 \
      | grep -E "NOTICE|ERROR|DETAIL|HINT|CONTEXT|===|All guards" | sed 's/^NOTICE:  //'
    rc=${PIPESTATUS[1]}

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
    # exist -- so asking whether reckon_dev is there failed with "database
    # 'tyler' does not exist", naming the wrong database entirely.
    psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" \
      | grep -q 1 || { echo "database '$DB' does not exist" >&2; exit 1; }

    # Whoever owns the database owns everything the migrations create. An app
    # connecting as the owner is refused tables made by another role, so each
    # migration runs under SESSION AUTHORIZATION of the owner rather than of
    # whoever happened to invoke this.
    OWNER=$(psql -d postgres -tAc \
      "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='$DB'")

    applied=$(psql -tAq -d "$DB" -c "SELECT filename FROM migration" 2>/dev/null || true)

    for f in "$MIGRATIONS"/*.sql; do
      name="$(basename "$f")"
      if grep -qxF "$name" <<<"$applied"; then
        echo "  already applied  $name"
        continue
      fi
      echo "  applying         $name"
      { printf 'SET SESSION AUTHORIZATION %s;\n' "\"$OWNER\""; cat "$f"; } \
        | psql -q -v ON_ERROR_STOP=1 -d "$DB"
    done

    # An object owned by anyone else is invisible to the app, and the failure
    # arrives as "permission denied" from whichever query happens to reach it
    # first -- a long way from the cause.
    stray=$(psql -tAq -d "$DB" -c "
      SELECT string_agg(c.relkind::text || ' ' || c.relname, ', ' ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','S')
         AND pg_get_userbyid(c.relowner) <> '$OWNER'")
    if [ -n "$stray" ]; then
      echo >&2
      echo "Not owned by $OWNER: $stray" >&2
      echo "The application connects as the owner and cannot see these." >&2
      echo "They were made by a different role -- reapply as $OWNER, or:" >&2
      echo "  ALTER TABLE <name> OWNER TO $OWNER;" >&2
      exit 1
    fi
    echo "Up to date. Every object in public is owned by $OWNER."
    ;;
esac
