ALTER TABLE "record_history" DROP CONSTRAINT "record_history_changed_by_fkey";
--> statement-breakpoint
ALTER TABLE "record_history" ADD COLUMN "xact" bigint;--> statement-breakpoint
ALTER TABLE "record_history" ADD CONSTRAINT "record_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_history_by_save" ON "record_history" USING btree ("xact");