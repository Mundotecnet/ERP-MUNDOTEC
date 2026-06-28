-- HU-12.1 / PR-39 — Secuencias de documentos (autoincremento por empresa).
-- Canónico §25.

CREATE TABLE "document_sequence" (
    "id"            BIGSERIAL NOT NULL,
    "company_id"    BIGINT NOT NULL,
    "sequence_type" VARCHAR(30) NOT NULL,
    "next_value"    BIGINT NOT NULL,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "document_sequence_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "document_sequence"
    ADD CONSTRAINT "document_sequence_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "company"("id")
        ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE UNIQUE INDEX "document_sequence_company_id_sequence_type_key"
    ON "document_sequence" ("company_id", "sequence_type");

-- Backfill: por cada empresa existente inicializa PRODUCT_SKU con
-- GREATEST(100000, MAX(sku_numérico) + 1) para no colisionar con SKUs
-- manuales previos que casualmente parseen como entero.
-- Idempotente: ON CONFLICT no inserta si ya existe.
INSERT INTO "document_sequence" ("company_id", "sequence_type", "next_value")
SELECT
    c.id,
    'PRODUCT_SKU',
    GREATEST(
        100000,
        COALESCE(
            (
                SELECT MAX(p.sku::bigint) + 1
                FROM "product" p
                WHERE p.company_id = c.id
                  AND p.sku ~ '^[0-9]+$'
            ),
            100000
        )
    )
FROM "company" c
ON CONFLICT ("company_id", "sequence_type") DO NOTHING;
