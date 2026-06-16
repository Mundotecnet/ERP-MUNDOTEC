-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "jti" VARCHAR(64) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_jti_key" ON "password_reset_token"("jti");

-- CreateIndex
CREATE INDEX "idx_reset_user" ON "password_reset_token"("user_id");

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
