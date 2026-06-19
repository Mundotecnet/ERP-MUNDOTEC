-- HU-8.1 — Kardex / movimientos de inventario.
-- Tabla canónica de `db/erp_schema.sql` líneas 243–258. Fuente de verdad del
-- inventario: cada fila es una entrada (+), salida (-) o ajuste con su saldo
-- resultante. El snapshot `stock` se mantiene en sincronía vía la transacción
-- del service.

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "movement_type" VARCHAR(20) NOT NULL,
    "source_doc" VARCHAR(30),
    "source_id" BIGINT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "movement_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "notes" VARCHAR(250),

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_movement_product" ON "stock_movement"("product_id", "warehouse_id", "movement_date");

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
