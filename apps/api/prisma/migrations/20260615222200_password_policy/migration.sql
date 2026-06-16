-- CreateTable
CREATE TABLE "password_policy" (
    "company_id" BIGINT NOT NULL,
    "min_length" INTEGER NOT NULL DEFAULT 10,
    "require_upper" BOOLEAN NOT NULL DEFAULT true,
    "require_lower" BOOLEAN NOT NULL DEFAULT true,
    "require_digit" BOOLEAN NOT NULL DEFAULT true,
    "require_special" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_policy_pkey" PRIMARY KEY ("company_id")
);

-- AddForeignKey
ALTER TABLE "password_policy" ADD CONSTRAINT "password_policy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
