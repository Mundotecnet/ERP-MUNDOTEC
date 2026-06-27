-- HU-11.1 / PR-32 — Precios: núcleo (costo, margen, precio + historial).
-- Canónico en db/erp_schema.sql sección 21 (anexada al final del archivo).
--
-- Convención de negocio: el margen es **sobre el precio de venta** (no sobre
-- costo). margin_pct = (price - cost) / price ; price = cost / (1 - margin).
-- En este PR el costo es editable manualmente como valor inicial.
-- TODO PR-33: el costo se derivará del kardex (promedio ponderado al recibir
-- compras) y la edición manual pasará a ser un ajuste auditado, no la fuente
-- principal. Tampoco se implementa aquí el recálculo automático del precio
-- al confirmar una recepción (queda en req §3 de docs/requisitos-precios-cxc.md).

-- 1. product: tres columnas nuevas.
ALTER TABLE "product"
    ADD COLUMN "margin_pct"     DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "min_margin_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "out_of_margin"  BOOLEAN      NOT NULL DEFAULT false;

-- 2. CHECK constraints (Prisma no las modela; van como SQL crudo).
ALTER TABLE "product"
    ADD CONSTRAINT "chk_product_margin_pct"
        CHECK ("margin_pct" >= 0 AND "margin_pct" < 1),
    ADD CONSTRAINT "chk_product_min_margin_pct"
        CHECK ("min_margin_pct" >= 0 AND "min_margin_pct" < 1);

-- 3. product_price_history: la tabla ya está en el canónico (sección 18.3,
-- líneas 1348–1360); este PR la incorpora a Prisma + agrega tres columnas
-- para capturar el trío costo/margen/precio + motivo libre.
CREATE TABLE "product_price_history" (
    "id"          BIGSERIAL NOT NULL,
    "company_id"  BIGINT NOT NULL,
    "product_id"  BIGINT NOT NULL,
    "change_type" VARCHAR(10) NOT NULL,
    "old_value"   DECIMAL(18,4),
    "new_value"   DECIMAL(18,4) NOT NULL,
    "source"      VARCHAR(15),
    "source_id"   BIGINT,
    "changed_by"  BIGINT,
    "changed_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "cost_value"  DECIMAL(18,4),
    "margin_pct"  DECIMAL(7,4),
    "reason"      TEXT,
    CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_price_history"
    ADD CONSTRAINT "product_price_history_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "product_price_history"
    ADD CONSTRAINT "product_price_history_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "product_price_history"
    ADD CONSTRAINT "product_price_history_changed_by_fkey"
        FOREIGN KEY ("changed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_pricehist_product"
    ON "product_price_history" ("product_id", "changed_at");
