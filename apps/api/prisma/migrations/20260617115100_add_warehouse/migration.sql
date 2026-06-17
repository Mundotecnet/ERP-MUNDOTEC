-- CreateTable
CREATE TABLE "warehouse" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_company_id_code_key" ON "warehouse"("company_id", "code");

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
