-- Catálogos: completar campos para mantenimiento desde UI.
--
-- - currency: `decimals` (default 2, rango 0..6) y `is_active` (default true)
--   para soportar moneda inmutable por code, edición de presentación y
--   "retiro suave" sin borrar (la moneda es FK por code en todo el sistema).
--
-- - unit_of_measure: `is_active` (default true) para retirar UoM sin borrar.
--
-- Filas existentes adoptan los defaults (decimals=2, is_active=true).

ALTER TABLE "currency"
  ADD COLUMN "decimals"  INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "currency"
  ADD CONSTRAINT "currency_decimals_check" CHECK ("decimals" BETWEEN 0 AND 6);

ALTER TABLE "unit_of_measure"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE;
