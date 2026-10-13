-- CreateEnum
CREATE TYPE "travel_kind" AS ENUM ('car', 'train', 'flight');

-- CreateEnum
CREATE TYPE "travel_status" AS ENUM ('pending_approval', 'to_book', 'booked', 'declined', 'booking_impossible', 'cancellation_requested', 'cancelled');

-- CreateEnum
CREATE TYPE "travel_approval_reason" AS ENUM ('vehicle_class_upgrade', 'car_estate', 'car_automatic_preferred', 'car_automatic_required', 'car_diesel', 'car_foreign_travel', 'car_delivery', 'car_collection', 'train_saver_fare', 'train_separate_tickets', 'flight');

-- CreateEnum
CREATE TYPE "travel_approval_exemption" AS ENUM ('executive_traveller');

-- CreateEnum
CREATE TYPE "travel_approver_selection" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "travel_vehicle_type" AS ENUM ('car', 'van');

-- CreateEnum
CREATE TYPE "travel_handover_mode" AS ENUM ('branch', 'delivery');

-- CreateEnum
CREATE TYPE "travel_drop_off_mode" AS ENUM ('branch', 'collection');

-- CreateEnum
CREATE TYPE "travel_trip_type" AS ENUM ('one_way', 'return');

-- CreateEnum
CREATE TYPE "travel_fare_type" AS ENUM ('saver', 'flex');

-- CreateTable
CREATE TABLE "travel_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" "travel_kind" NOT NULL,
    "traveller_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "approver_id" UUID,
    "approver_selection" "travel_approver_selection",
    "approver_reason" "approver_reason",
    "escalated_from_id" UUID,
    "status" "travel_status" NOT NULL,
    "needs_approval" BOOLEAN NOT NULL,
    "approval_reasons" "travel_approval_reason"[],
    "approval_exemption" "travel_approval_exemption",
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "route_summary" TEXT NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "cost_center_reason" TEXT,
    "recharge_customer" TEXT,
    "recharge_project_number" TEXT,
    "comment" TEXT,
    "status_before_cancellation" "travel_status",
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approval_acting_as" "acting_as",
    "approval_comment" TEXT,
    "approval_auto_approval" "auto_approval",
    "declined_at" TIMESTAMPTZ(3),
    "declined_by_id" UUID,
    "declined_acting_as" "acting_as",
    "decline_reason" TEXT,
    "booking_impossible_reason" TEXT,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_car_details" (
    "request_id" UUID NOT NULL,
    "vehicle_type" "travel_vehicle_type" NOT NULL,
    "car_class_id" UUID NOT NULL,
    "pickup_at" TIMESTAMPTZ(3) NOT NULL,
    "return_at" TIMESTAMPTZ(3) NOT NULL,
    "destination" TEXT NOT NULL,
    "estate" BOOLEAN NOT NULL DEFAULT false,
    "navigation" BOOLEAN NOT NULL DEFAULT false,
    "automatic_preferred" BOOLEAN NOT NULL DEFAULT false,
    "automatic_required" BOOLEAN NOT NULL DEFAULT false,
    "diesel" BOOLEAN NOT NULL DEFAULT false,
    "winter_tyres" BOOLEAN NOT NULL DEFAULT false,
    "foreign_travel" BOOLEAN NOT NULL DEFAULT false,
    "child_seat" BOOLEAN NOT NULL DEFAULT false,
    "foreign_countries" TEXT[],
    "expected_km_per_day" INTEGER,
    "min_payload_kg" INTEGER,
    "handover_mode" "travel_handover_mode" NOT NULL,
    "handover_branch" TEXT,
    "handover_street" TEXT,
    "handover_house_number" TEXT,
    "handover_postal_code" TEXT,
    "handover_city" TEXT,
    "handover_country_code" TEXT,
    "drop_off_mode" "travel_drop_off_mode" NOT NULL,
    "drop_off_branch" TEXT,
    "drop_off_street" TEXT,
    "drop_off_house_number" TEXT,
    "drop_off_postal_code" TEXT,
    "drop_off_city" TEXT,
    "drop_off_country_code" TEXT,
    "driver_first_name" TEXT NOT NULL,
    "driver_last_name" TEXT NOT NULL,
    "driver_email" TEXT NOT NULL,
    "driver_phone" TEXT NOT NULL,
    "driver_birth_date" DATE NOT NULL,
    "driver_licence_number" TEXT,
    "additional_drivers" TEXT,
    "special_equipment_reason" TEXT,

    CONSTRAINT "travel_car_details_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "travel_train_details" (
    "request_id" UUID NOT NULL,
    "trip_type" "travel_trip_type" NOT NULL,
    "outbound_at" TIMESTAMPTZ(3) NOT NULL,
    "return_at" TIMESTAMPTZ(3),
    "from_station" TEXT NOT NULL,
    "via_station" TEXT,
    "to_station" TEXT NOT NULL,
    "fare_type" "travel_fare_type" NOT NULL,
    "seat_reservations" INTEGER NOT NULL DEFAULT 0,
    "separate_tickets" BOOLEAN NOT NULL DEFAULT false,
    "local_transport_ticket" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "travel_train_details_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "travel_train_companions" (
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "travel_train_companions_pkey" PRIMARY KEY ("request_id","user_id")
);

-- CreateTable
CREATE TABLE "travel_flight_details" (
    "request_id" UUID NOT NULL,
    "trip_type" "travel_trip_type" NOT NULL,
    "outbound_departure_at" TIMESTAMPTZ(3) NOT NULL,
    "outbound_from" TEXT NOT NULL,
    "outbound_to" TEXT NOT NULL,
    "return_departure_at" TIMESTAMPTZ(3),
    "return_from" TEXT,
    "return_to" TEXT,
    "hand_luggage_only" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "travel_flight_details_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "travel_bookings" (
    "request_id" UUID NOT NULL,
    "booking_number" TEXT NOT NULL,
    "pin_encrypted" TEXT,
    "comment" TEXT,
    "booked_by_id" UUID NOT NULL,
    "booked_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travel_bookings_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "car_rental_classes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "example_models" TEXT,
    "vehicle_type" "travel_vehicle_type" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "car_rental_classes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travel_requests_number_key" ON "travel_requests"("number");

-- CreateIndex
CREATE INDEX "travel_requests_traveller_id_status_idx" ON "travel_requests"("traveller_id", "status");

-- CreateIndex
CREATE INDEX "travel_requests_approver_id_status_idx" ON "travel_requests"("approver_id", "status");

-- CreateIndex
CREATE INDEX "travel_requests_status_starts_at_idx" ON "travel_requests"("status", "starts_at");

-- CreateIndex
CREATE INDEX "travel_requests_requester_id_idx" ON "travel_requests"("requester_id");

-- CreateIndex
CREATE INDEX "travel_car_details_car_class_id_idx" ON "travel_car_details"("car_class_id");

-- CreateIndex
CREATE INDEX "travel_train_companions_user_id_idx" ON "travel_train_companions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "car_rental_classes_code_key" ON "car_rental_classes"("code");

-- CreateIndex
CREATE INDEX "car_rental_classes_vehicle_type_sort_order_idx" ON "car_rental_classes"("vehicle_type", "sort_order");

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_traveller_id_fkey" FOREIGN KEY ("traveller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_escalated_from_id_fkey" FOREIGN KEY ("escalated_from_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_declined_by_id_fkey" FOREIGN KEY ("declined_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_car_details" ADD CONSTRAINT "travel_car_details_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_car_details" ADD CONSTRAINT "travel_car_details_car_class_id_fkey" FOREIGN KEY ("car_class_id") REFERENCES "car_rental_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_train_details" ADD CONSTRAINT "travel_train_details_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_train_companions" ADD CONSTRAINT "travel_train_companions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_train_companions" ADD CONSTRAINT "travel_train_companions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_flight_details" ADD CONSTRAINT "travel_flight_details_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_booked_by_id_fkey" FOREIGN KEY ("booked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: at most one default ("Standard") car class per vehicle type (SPEC §4.3).
CREATE UNIQUE INDEX "car_rental_classes_one_default_per_vehicle_type" ON "car_rental_classes"("vehicle_type") WHERE "is_default";
