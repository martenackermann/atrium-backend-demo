-- CreateEnum
CREATE TYPE "training_format" AS ENUM ('in_person', 'online', 'hybrid');

-- CreateEnum
CREATE TYPE "training_attendee_status" AS ENUM ('pending_manager_approval', 'pending_executive_approval', 'to_book', 'booked', 'declined', 'booking_impossible', 'cancellation_requested', 'cancelled', 'attended', 'not_attended');

-- CreateEnum
CREATE TYPE "training_billing_status" AS ENUM ('open', 'invoice_received', 'free_of_charge');

-- CreateEnum
CREATE TYPE "training_likert" AS ENUM ('A', 'B', 'C', 'D');

-- CreateTable
CREATE TABLE "training_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "topic" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "format" "training_format" NOT NULL,
    "location" TEXT,
    "registration_url" TEXT,
    "registration_details" TEXT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "cost_center_id" UUID NOT NULL,
    "executive_approver_id" UUID,
    "certificate_expected" BOOLEAN NOT NULL DEFAULT false,
    "reimbursement_agreement" BOOLEAN NOT NULL DEFAULT false,
    "requester_comment" TEXT,
    "requester_id" UUID NOT NULL,
    "back_office_comment" TEXT,
    "billing_status" "training_billing_status" NOT NULL DEFAULT 'open',
    "actual_cost_cents" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_attendees" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "status" "training_attendee_status" NOT NULL,
    "status_before_cancellation" "training_attendee_status",
    "approver_id" UUID,
    "approver_reason" "approver_reason" NOT NULL,
    "escalated_from_id" UUID,
    "executive_approver_id" UUID,
    "hotel_needed" BOOLEAN NOT NULL DEFAULT false,
    "hotel_check_in_on" DATE,
    "hotel_check_out_on" DATE,
    "hotel_cost_cents" INTEGER,
    "goal1" TEXT,
    "goal2" TEXT,
    "goals_updated_at" TIMESTAMPTZ(3),
    "goals_reminded_at" TIMESTAMPTZ(3),
    "booking_reference" TEXT,
    "manager_decision_at" TIMESTAMPTZ(3),
    "manager_decision_by_id" UUID,
    "manager_decision_as" "acting_as",
    "manager_decision_comment" TEXT,
    "manager_auto_approval" "auto_approval",
    "executive_decision_at" TIMESTAMPTZ(3),
    "executive_decision_by_id" UUID,
    "executive_decision_as" "acting_as",
    "executive_decision_comment" TEXT,
    "executive_auto_approval" "auto_approval",
    "decline_reason" TEXT,
    "booking_impossible_reason" TEXT,
    "cancellation_reason" TEXT,
    "booked_at" TIMESTAMPTZ(3),
    "booked_by_id" UUID,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_ratings" (
    "id" UUID NOT NULL,
    "attendee_id" UUID NOT NULL,
    "loop" INTEGER NOT NULL,
    "rater_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "last_reminded_at" TIMESTAMPTZ(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "participated" BOOLEAN,
    "overall_grade" INTEGER,
    "trainer_grade" INTEGER,
    "expectations_grade" INTEGER,
    "applies_learned" "training_likert",
    "supervisor_supported" "training_likert",
    "worthwhile_for_organization" "training_likert",
    "improvement_observed" INTEGER,
    "certification_gained" BOOLEAN,
    "certification_comment" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_requests_number_key" ON "training_requests"("number");

-- CreateIndex
CREATE INDEX "training_requests_requester_id_idx" ON "training_requests"("requester_id");

-- CreateIndex
CREATE INDEX "training_requests_starts_on_idx" ON "training_requests"("starts_on");

-- CreateIndex
CREATE INDEX "training_requests_billing_status_idx" ON "training_requests"("billing_status");

-- CreateIndex
CREATE INDEX "training_attendees_user_id_status_idx" ON "training_attendees"("user_id", "status");

-- CreateIndex
CREATE INDEX "training_attendees_approver_id_status_idx" ON "training_attendees"("approver_id", "status");

-- CreateIndex
CREATE INDEX "training_attendees_executive_approver_id_status_idx" ON "training_attendees"("executive_approver_id", "status");

-- CreateIndex
CREATE INDEX "training_attendees_status_idx" ON "training_attendees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "training_attendees_request_id_user_id_key" ON "training_attendees"("request_id", "user_id");

-- CreateIndex
CREATE INDEX "training_ratings_rater_id_submitted_at_idx" ON "training_ratings"("rater_id", "submitted_at");

-- CreateIndex
CREATE INDEX "training_ratings_due_at_idx" ON "training_ratings"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "training_ratings_attendee_id_loop_key" ON "training_ratings"("attendee_id", "loop");

-- AddForeignKey
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_executive_approver_id_fkey" FOREIGN KEY ("executive_approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "training_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_escalated_from_id_fkey" FOREIGN KEY ("escalated_from_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_executive_approver_id_fkey" FOREIGN KEY ("executive_approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_manager_decision_by_id_fkey" FOREIGN KEY ("manager_decision_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_executive_decision_by_id_fkey" FOREIGN KEY ("executive_decision_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_booked_by_id_fkey" FOREIGN KEY ("booked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_ratings" ADD CONSTRAINT "training_ratings_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "training_attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_ratings" ADD CONSTRAINT "training_ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rating loops are 1, 2 or 3 (SPEC §4.2); not expressible in the Prisma schema.
ALTER TABLE "training_ratings" ADD CONSTRAINT "training_ratings_loop_check" CHECK ("loop" IN (1, 2, 3));
