-- CreateTable
CREATE TABLE "company_param" (
    "company_id" BIGINT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_param_pkey" PRIMARY KEY ("company_id","key")
);

-- AddForeignKey
ALTER TABLE "company_param" ADD CONSTRAINT "company_param_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
