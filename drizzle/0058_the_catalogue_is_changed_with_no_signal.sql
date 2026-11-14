-- THE CATALOGUE IS CHANGED WITH NO SIGNAL (13 November 2026): a service can
-- be added on a phone, with its price for every client, and used there at
-- once. It keeps the uuid the phone made for it, so one sent twice is one,
-- and a time entry or trip that named it before it arrived finds it.

ALTER TABLE "service" ADD COLUMN "client_uuid" uuid;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_client_uuid_key" UNIQUE("client_uuid");