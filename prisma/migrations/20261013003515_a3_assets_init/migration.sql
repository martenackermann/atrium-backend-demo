-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('in_stock', 'pending_acceptance', 'in_use', 'in_repair', 'scrapped');

-- CreateEnum
CREATE TYPE "asset_return_condition" AS ENUM ('ok', 'damaged');

-- CreateTable
CREATE TABLE "device_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requires_platform" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturer_device_types" (
    "manufacturer_id" UUID NOT NULL,
    "device_type_id" UUID NOT NULL,

    CONSTRAINT "manufacturer_device_types_pkey" PRIMARY KEY ("manufacturer_id","device_type_id")
);

-- CreateTable
CREATE TABLE "platforms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_device_types" (
    "platform_id" UUID NOT NULL,
    "device_type_id" UUID NOT NULL,

    CONSTRAINT "platform_device_types_pkey" PRIMARY KEY ("platform_id","device_type_id")
);

-- CreateTable
CREATE TABLE "asset_models" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer_id" UUID NOT NULL,
    "device_type_id" UUID NOT NULL,
    "storage_gb" INTEGER,
    "color" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "serial_number" TEXT NOT NULL,
    "name" TEXT,
    "model_id" UUID NOT NULL,
    "platform_id" UUID,
    "status" "asset_status" NOT NULL DEFAULT 'in_stock',
    "assigned_user_id" UUID,
    "cost_center_id" UUID NOT NULL,
    "purchase_date" DATE,
    "mdm_enrolled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "accepted_at" TIMESTAMPTZ(3),
    "declined_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "unassigned_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "return_condition" "asset_return_condition",
    "return_note" TEXT,
    "last_reminded_at" TIMESTAMPTZ(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_types_code_key" ON "device_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_name_key" ON "manufacturers"("name");

-- CreateIndex
CREATE INDEX "manufacturer_device_types_device_type_id_idx" ON "manufacturer_device_types"("device_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_name_key" ON "platforms"("name");

-- CreateIndex
CREATE INDEX "platform_device_types_device_type_id_idx" ON "platform_device_types"("device_type_id");

-- CreateIndex
CREATE INDEX "asset_models_device_type_id_idx" ON "asset_models"("device_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_models_manufacturer_id_name_key" ON "asset_models"("manufacturer_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "assets_number_key" ON "assets"("number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_serial_number_key" ON "assets"("serial_number");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_assigned_user_id_idx" ON "assets"("assigned_user_id");

-- CreateIndex
CREATE INDEX "assets_model_id_idx" ON "assets"("model_id");

-- CreateIndex
CREATE INDEX "assets_cost_center_id_idx" ON "assets"("cost_center_id");

-- CreateIndex
CREATE INDEX "asset_assignments_asset_id_assigned_at_idx" ON "asset_assignments"("asset_id", "assigned_at");

-- CreateIndex
CREATE INDEX "asset_assignments_user_id_idx" ON "asset_assignments"("user_id");

-- AddForeignKey
ALTER TABLE "manufacturer_device_types" ADD CONSTRAINT "manufacturer_device_types_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer_device_types" ADD CONSTRAINT "manufacturer_device_types_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_device_types" ADD CONSTRAINT "platform_device_types_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_device_types" ADD CONSTRAINT "platform_device_types_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "asset_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A3: at most one open assignment per asset (SPEC §4.4; not expressible in the Prisma schema)
CREATE UNIQUE INDEX "asset_assignments_one_open_per_asset"
    ON "asset_assignments" ("asset_id")
    WHERE "declined_at" IS NULL AND "unassigned_at" IS NULL AND "returned_at" IS NULL;

-- A3: serial numbers are unique case-insensitively (SPEC §4.4 citext; the service checks too)
CREATE UNIQUE INDEX "assets_serial_number_lower_key" ON "assets" (lower("serial_number"));

