-- Sección 20.6 del canónico: multi-sucursal por usuario.
--
-- - `app_user.default_branch_id` (nullable): sucursal por defecto del usuario.
--   Puede quedar NULL si la default queda fuera de las permitidas al recortar
--   el set (el servicio hace auto-null en la misma tx).
-- - `user_branch` (pivote): sucursales operables por el usuario. Los usuarios
--   con permiso `branch.access_all` (admin/owner) operan TODAS sin necesidad
--   de una fila acá — el permiso corta la validación.
--
-- La FK `default_branch_id` no valida contra `user_branch` a nivel DB (una
-- CHECK constraint no puede referenciar otra tabla en Postgres); la
-- consistencia se garantiza en el service dentro de una tx.

ALTER TABLE "app_user"
  ADD COLUMN "default_branch_id" BIGINT REFERENCES "branch"("id");

CREATE TABLE "user_branch" (
  "user_id"    BIGINT      NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "branch_id"  BIGINT      NOT NULL REFERENCES "branch"("id")   ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "branch_id")
);

CREATE INDEX "idx_user_branch_branch" ON "user_branch"("branch_id");
