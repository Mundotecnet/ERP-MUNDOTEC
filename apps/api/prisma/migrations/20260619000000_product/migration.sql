-- HU-7.1 — Catálogo de productos.
-- Tabla canónica de `db/erp_schema.sql` líneas 194–219 más las extensiones de
-- secciones posteriores: cabys_code (fiscal CR, l.761), web_* (tienda, l.1128),
-- department_id + default_supplier_id (logística, l.1377).
--
-- FKs a tablas aún no modeladas (cabys, price_list, partner) se omiten en esta
-- migración. La columna queda nullable y la FK se agregará cuando esas tablas
-- entren al modelo Prisma (Sprint 7 partner, Sprint 12 cabys, Sprint 13 price_list).

-- CreateTable
CREATE TABLE "product" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "barcode" VARCHAR(60),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category_id" BIGINT,
    "uom_id" BIGINT NOT NULL,
    "tax_id" BIGINT,
    "cost_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sale_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "is_inventoried" BOOLEAN NOT NULL DEFAULT true,
    "tracking_type" VARCHAR(10) NOT NULL DEFAULT 'NONE',
    "warranty_months" INTEGER NOT NULL DEFAULT 0,
    "min_stock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "max_stock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "cabys_code" VARCHAR(13),
    "web_published" BOOLEAN NOT NULL DEFAULT false,
    "web_featured" BOOLEAN NOT NULL DEFAULT false,
    "web_title" VARCHAR(200),
    "web_description" TEXT,
    "web_slug" VARCHAR(150),
    "web_price_list_id" BIGINT,
    "department_id" BIGINT,
    "default_supplier_id" BIGINT,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_sku_key" ON "product"("company_id", "sku");

-- CreateIndex
CREATE INDEX "product_barcode_idx" ON "product"("barcode");

-- CreateIndex
CREATE INDEX "product_name_idx" ON "product"("name");

-- CreateIndex — slug único por empresa cuando no es NULL (replica `uq_product_web_slug`).
CREATE UNIQUE INDEX "product_company_id_web_slug_key" ON "product"("company_id", "web_slug") WHERE "web_slug" IS NOT NULL;

-- CreateIndex — index parcial para querys de la tienda (replica `idx_product_web_pub`).
CREATE INDEX "product_web_published_idx" ON "product"("web_published") WHERE "web_published" = TRUE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "unit_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "tax"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
