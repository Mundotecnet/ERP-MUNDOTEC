-- HU-10.2 — Órdenes de venta (cabecera + líneas).
-- Tablas canónicas en `db/erp_schema.sql` 394–425 + ALTERs:
--   - sección 12 (línea 887): `quotation_id` para enlazar a una cotización origen.
--   - sección 20.1 (línea 1474): `salesperson_id` para vendedor asignado.
--
-- `opportunity_id` queda como columna nullable sin FK Prisma hasta que
-- `crm_opportunity` se modele en el sprint CRM.

-- CreateTable
CREATE TABLE "sales_order" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "customer_id" BIGINT NOT NULL,
    "opportunity_id" BIGINT,
    "quotation_id" BIGINT,
    "order_number" VARCHAR(30) NOT NULL,
    "order_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "base_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" VARCHAR(300),
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salesperson_id" BIGINT,
    "channel" VARCHAR(10) NOT NULL DEFAULT 'POS',
    "external_ref" VARCHAR(60),
    "web_status" VARCHAR(15),

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_company_id_order_number_key" ON "sales_order"("company_id", "order_number");

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "sales_order_line" (
    "id" BIGSERIAL NOT NULL,
    "sales_order_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sales_order_line_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
