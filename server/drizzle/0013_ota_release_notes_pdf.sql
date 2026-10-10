-- Stored links expired within the hour; keep the PDFs themselves instead.
DELETE FROM "ota_release_notes";--> statement-breakpoint
ALTER TABLE "ota_release_notes" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "ota_release_notes" ADD COLUMN "pdf" bytea NOT NULL;
