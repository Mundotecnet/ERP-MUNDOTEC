-- HU-10.3 — Facturas de venta (cabecera + líneas).
-- Tablas canónicas en `db/erp_schema.sql` 427–460 + ALTERs:
--   - sección 11 (líneas 765–784): campos fiscales CR (document_type, ce_*,
--     hacienda_*, sale_condition, payment_method); también extiende
--     invoice_line con cabys_code, discount_amount, exempt_amount.
--   - sección 20.1 (línea 1475): salesperson_id para comisiones.
--
-- En este PR se modelan todas las columnas pero la lógica fiscal CR vive
-- en el microservicio fiscal del sprint 12. Aquí solo se respetan los
-- defaults canónicos.

-- CreateTable
CREATE TABLE "invoice" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "customer_id" BIGINT NOT NULL,
    "sales_order_id" BIGINT,
    "service_order_id" BIGINT,
    "invoice_number" VARCHAR(40) NOT NULL,
    "invoice_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "due_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "base_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salesperson_id" BIGINT,
    "document_type" VARCHAR(3) NOT NULL DEFAULT 'FE',
    "ce_clave" CHAR(50),
    "ce_consecutivo" CHAR(20),
    "ce_security_code" CHAR(8),
    "ce_situacion" SMALLINT NOT NULL DEFAULT 1,
    "emitter_activity" VARCHAR(6),
    "receiver_activity" VARCHAR(6),
    "sale_condition" VARCHAR(2) NOT NULL DEFAULT '01',
    "payment_method" VARCHAR(2) NOT NULL DEFAULT '01',
    "hacienda_status" VARCHAR(15) NOT NULL DEFAULT 'PENDING',
    "signed_xml_url" VARCHAR(400),
    "response_xml_url" VARCHAR(400),
    "accepted_at" TIMESTAMPTZ,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_company_id_invoice_number_key" ON "invoice"("company_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invoice_clave" ON "invoice"("ce_clave") WHERE "ce_clave" IS NOT NULL;

-- CreateIndex
CREATE INDEX "idx_invoice_hacienda_status" ON "invoice"("hacienda_status");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" BIGSERIAL NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "description" VARCHAR(250),
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "cabys_code" VARCHAR(13),
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "exempt_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
