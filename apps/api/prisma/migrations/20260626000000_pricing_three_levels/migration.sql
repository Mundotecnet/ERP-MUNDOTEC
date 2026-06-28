-- HU-11.2 / PR-34 — Precios: 3 niveles fijos por producto.
-- Canónico en db/erp_schema.sql §8 (price_list/price_list_item) + §22.
--
-- Pasamos de precio único a 3 niveles fijos reusando price_list /
-- price_list_item. Por empresa se seedean P1/P2/P3 (tipo SALE). Por
-- producto se tiene una fila por nivel con su propio (margin_pct, price).
--
-- product.cost_price y product.min_margin_pct siguen siendo uno por producto.
-- product.sale_price / product.margin_pct quedan como denormalización del
-- nivel "Precio 1" (lista por defecto) para no romper la columna del listado
-- ni la vista v_web_catalog. Se sincronizan al guardar desde el módulo
-- de Precios.
--
-- Como las tablas price_list / price_list_item están en el canónico pero
-- nunca habían sido modeladas en Prisma, este PR las crea desde cero en
-- la migración (mismo patrón que product_price_history en PR-32).

-- 1. price_list (canónico §8 líneas 549–557 + extensión PR-34).
CREATE TABLE "price_list" (
    "id"            BIGSERIAL NOT NULL,
    "company_id"    BIGINT NOT NULL,
    "name"          VARCHAR(100) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "list_type"     VARCHAR(10) NOT NULL DEFAULT 'SALE',
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "price_list"
    ADD CONSTRAINT "price_list_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "company"("id")
        ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "price_list"
    ADD CONSTRAINT "price_list_currency_code_fkey"
        FOREIGN KEY ("currency_code") REFERENCES "currency"("code")
        ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE UNIQUE INDEX "price_list_company_id_name_key"
    ON "price_list" ("company_id", "name");

-- 2. price_list_item (canónico §8 líneas 559–568 + extensión §22 PR-34).
CREATE TABLE "price_list_item" (
    "id"             BIGSERIAL NOT NULL,
    "price_list_id"  BIGINT NOT NULL,
    "product_id"     BIGINT NOT NULL,
    "price"          DECIMAL(18,4) NOT NULL,
    "min_quantity"   DECIMAL(18,4) NOT NULL DEFAULT 1,
    "valid_from"     DATE,
    "valid_to"       DATE,
    "margin_pct"     DECIMAL(7,4) NOT NULL DEFAULT 0,
    "out_of_margin"  BOOLEAN      NOT NULL DEFAULT false,
    CONSTRAINT "price_list_item_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "price_list_item"
    ADD CONSTRAINT "price_list_item_price_list_id_fkey"
        FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_item"
    ADD CONSTRAINT "price_list_item_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "product"("id")
        ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE UNIQUE INDEX "price_list_item_price_list_id_product_id_min_quantity_key"
    ON "price_list_item" ("price_list_id", "product_id", "min_quantity");
ALTER TABLE "price_list_item"
    ADD CONSTRAINT "chk_pli_margin_pct"
        CHECK ("margin_pct" >= 0 AND "margin_pct" < 1);

-- 3. product_price_history: referencia al nivel afectado (NULL para
-- cambios de costo o de min_margin_pct).
ALTER TABLE "product_price_history"
    ADD COLUMN "price_list_id" BIGINT;
ALTER TABLE "product_price_history"
    ADD CONSTRAINT "product_price_history_price_list_id_fkey"
        FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_pricehist_pricelist" ON "product_price_history" ("price_list_id");

-- 4. Backfill: por cada empresa existente, asegurar P1/P2/P3.
INSERT INTO "price_list" ("company_id", "name", "currency_code", "list_type", "is_active")
SELECT c.id, n.name, c.currency_code, 'SALE', true
FROM "company" c
CROSS JOIN (VALUES ('Precio 1'), ('Precio 2'), ('Precio 3')) AS n(name)
ON CONFLICT ("company_id", "name") DO NOTHING;

-- 5. Backfill: por cada producto existente, crear los 3 price_list_item
-- inicializados con sale_price y margin_pct vigentes del producto (los 3
-- niveles parten iguales para que el operador vea los mismos números hasta
-- que decida configurarlos).
INSERT INTO "price_list_item" (
    "price_list_id", "product_id", "price", "min_quantity",
    "margin_pct", "out_of_margin"
)
SELECT pl.id, p.id, p.sale_price, 1,
       p.margin_pct,
       (p.min_margin_pct > 0 AND p.margin_pct < p.min_margin_pct)
FROM "product" p
JOIN "price_list" pl
    ON pl.company_id = p.company_id
   AND pl.name IN ('Precio 1', 'Precio 2', 'Precio 3')
ON CONFLICT ("price_list_id", "product_id", "min_quantity") DO NOTHING;
