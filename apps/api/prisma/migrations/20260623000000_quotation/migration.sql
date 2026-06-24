-- HU-10.1 — Cotizaciones de venta (cabecera + líneas).
-- Tablas canónicas en `db/erp_schema.sql` 848–884, más las extensiones de la
-- sección 18.1 (costo/margen/ajustes/envío) que sí están en el canónico pero
-- cuya lógica de negocio queda para el sprint de Precios.
--
-- `opportunity_id` y `converted_sales_order_id` quedan como columnas nullable
-- sin FK hasta que `crm_opportunity` y `sales_order` se modelen en Prisma
-- (sprints CRM/PR-28). La FK se agregará en su migración correspondiente.

-- CreateTable
CREATE TABLE "quotation" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "customer_id" BIGINT,
    "opportunity_id" BIGINT,
    "quote_number" VARCHAR(30) NOT NULL,
    "quote_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "valid_until" DATE,
    "status" VARCHAR(15) NOT NULL DEFAULT 'DRAFT',
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "base_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "converted_sales_order_id" BIGINT,
    "notes" VARCHAR(300),
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cost_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "margin_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "margin_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "global_adjust_type" VARCHAR(12),
    "global_adjust_value" DECIMAL(18,4),
    "sent_at" TIMESTAMPTZ,
    "sent_to_email" VARCHAR(150),
    "sales_stage" VARCHAR(20),
    "salesperson_id" BIGINT,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_company_id_quote_number_key" ON "quotation"("company_id", "quote_number");

-- CreateIndex
CREATE INDEX "idx_quotation_status" ON "quotation"("status");

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "quotation_line" (
    "id" BIGSERIAL NOT NULL,
    "quotation_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "description" VARCHAR(250),
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "margin_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "margin_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_line_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
