-- CreateEnum
CREATE TYPE "news_type" AS ENUM ('changelog', 'update', 'information');

-- CreateEnum
CREATE TYPE "news_status" AS ENUM ('draft', 'scheduled', 'published', 'archived');

-- CreateEnum
CREATE TYPE "people_request_type" AS ENUM ('onboarding', 'offboarding', 'role_change');

-- CreateEnum
CREATE TYPE "people_request_status" AS ENUM ('open', 'in_progress', 'waiting_internal', 'waiting_on_requester', 'reopened', 'completed', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "people_priority" AS ENUM ('critical', 'high', 'normal', 'low');

-- CreateEnum
CREATE TYPE "people_salutation" AS ENUM ('mr', 'ms', 'mx');

-- CreateEnum
CREATE TYPE "people_comment_kind" AS ENUM ('comment', 'question', 'status_note');

-- CreateTable
CREATE TABLE "news_posts" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "news_type" NOT NULL,
    "status" "news_status" NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "cover_image_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publish_at" TIMESTAMPTZ(3),
    "expire_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "author_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "useful_links" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT,
    "sort_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "useful_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "type" "people_request_type" NOT NULL,
    "title" TEXT NOT NULL,
    "priority" "people_priority" NOT NULL DEFAULT 'normal',
    "status" "people_request_status" NOT NULL DEFAULT 'open',
    "job_role_id" UUID,
    "subject_user_id" UUID,
    "salutation" "people_salutation",
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "department_id" UUID,
    "site_id" UUID,
    "manager_id" UUID,
    "manager_deputy_id" UUID,
    "requester_id" UUID NOT NULL,
    "assignee_id" UUID,
    "reason" TEXT,
    "further_information" TEXT,
    "equipment_notes" TEXT,
    "birth_date" DATE,
    "place_of_birth" TEXT,
    "nationality" CHAR(2),
    "private_street" TEXT,
    "private_house_number" TEXT,
    "private_postal_code" TEXT,
    "private_city" TEXT,
    "private_country_code" CHAR(2),
    "private_phone" TEXT,
    "private_email" TEXT,
    "internal_note" TEXT,
    "status_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "people_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people_request_comments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "kind" "people_comment_kind" NOT NULL DEFAULT 'comment',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "news_posts_status_publish_at_idx" ON "news_posts"("status", "publish_at");

-- CreateIndex
CREATE INDEX "news_posts_status_published_at_idx" ON "news_posts"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "useful_links_sort_order_idx" ON "useful_links"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "job_roles_name_key" ON "job_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "people_requests_number_key" ON "people_requests"("number");

-- CreateIndex
CREATE INDEX "people_requests_requester_id_idx" ON "people_requests"("requester_id");

-- CreateIndex
CREATE INDEX "people_requests_manager_id_idx" ON "people_requests"("manager_id");

-- CreateIndex
CREATE INDEX "people_requests_status_priority_idx" ON "people_requests"("status", "priority");

-- CreateIndex
CREATE INDEX "people_requests_assignee_id_idx" ON "people_requests"("assignee_id");

-- CreateIndex
CREATE INDEX "people_request_comments_request_id_created_at_idx" ON "people_request_comments"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "useful_links" ADD CONSTRAINT "useful_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_manager_deputy_id_fkey" FOREIGN KEY ("manager_deputy_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_requests" ADD CONSTRAINT "people_requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_request_comments" ADD CONSTRAINT "people_request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "people_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_request_comments" ADD CONSTRAINT "people_request_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
