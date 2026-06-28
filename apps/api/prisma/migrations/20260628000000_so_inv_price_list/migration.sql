-- HU-11.4 / PR-38 — Nivel de precio en OV y Factura (propagado desde
-- cotización). Canónico §24.
--
-- Mismo campo nullable que en quotation_line (PR-37). El precio acordado
-- NO se recalcula al convertir; el nivel viaja solo como referencia.

ALTER TABLE "sales_order_line"
    ADD COLUMN "price_list_id" BIGINT;
ALTER TABLE "sales_order_line"
    ADD CONSTRAINT "sales_order_line_price_list_id_fkey"
        FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_soline_pricelist" ON "sales_order_line" ("price_list_id");

ALTER TABLE "invoice_line"
    ADD COLUMN "price_list_id" BIGINT;
ALTER TABLE "invoice_line"
    ADD CONSTRAINT "invoice_line_price_list_id_fkey"
        FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_invline_pricelist" ON "invoice_line" ("price_list_id");
