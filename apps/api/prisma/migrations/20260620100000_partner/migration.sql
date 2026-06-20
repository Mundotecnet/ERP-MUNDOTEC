-- HU-9.1 — Terceros (clientes y proveedores) y sus contactos.
-- Tablas canónicas en `db/erp_schema.sql` líneas 264–293.

-- CreateTable
CREATE TABLE "partner" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "partner_type" VARCHAR(10) NOT NULL,
    "code" VARCHAR(30),
    "legal_name" VARCHAR(200) NOT NULL,
    "trade_name" VARCHAR(200),
    "tax_id" VARCHAR(50),
    "email" VARCHAR(150),
    "phone" VARCHAR(50),
    "address" VARCHAR(300),
    "currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "credit_limit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "customer_category_id" BIGINT,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_company_id_code_key" ON "partner"("company_id", "code");

-- CreateIndex
CREATE INDEX "idx_partner_name" ON "partner"("legal_name");

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_customer_category_id_fkey" FOREIGN KEY ("customer_category_id") REFERENCES "customer_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "partner_contact" (
    "id" BIGSERIAL NOT NULL,
    "partner_id" BIGINT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "position" VARCHAR(100),
    "email" VARCHAR(150),
    "phone" VARCHAR(50),

    CONSTRAINT "partner_contact_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "partner_contact" ADD CONSTRAINT "partner_contact_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
