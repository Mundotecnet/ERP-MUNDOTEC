-- HU-11.3 / PR-37 — Nivel de precio aplicado por línea de cotización.
-- Canónico §23.
--
-- Cada línea puede registrar qué `price_list` (P1/P2/P3) eligió el vendedor
-- al cotizar. El `unit_price` sigue siendo editable a mano; este campo es
-- informativo + auditoría + base de reportes futuros sobre líneas vendidas
-- a Precio 1 vs 2 vs 3.

ALTER TABLE "quotation_line"
    ADD COLUMN "price_list_id" BIGINT;
ALTER TABLE "quotation_line"
    ADD CONSTRAINT "quotation_line_price_list_id_fkey"
        FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_quoteline_pricelist" ON "quotation_line" ("price_list_id");
