-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "task_column" AS ENUM ('backlog', 'assigned', 'working', 'pr', 'merged');

-- CreateEnum
CREATE TYPE "cronjob_status" AS ENUM ('active', 'paused');

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'string',
    "label" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "template" TEXT NOT NULL DEFAULT '',
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "timeout_ms" INTEGER NOT NULL DEFAULT 1800000,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "project_status" NOT NULL DEFAULT 'active',
    "worker_timeout_ms" INTEGER,
    "default_labels" TEXT,
    "max_attempts" INTEGER,
    "notify_on_success" BOOLEAN,
    "notify_on_failure" BOOLEAN,
    "error_watcher_enabled" BOOLEAN NOT NULL DEFAULT false,
    "error_watcher_channel" TEXT,
    "error_watcher_labels" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "column_id" "task_column" NOT NULL DEFAULT 'backlog',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "github_url" TEXT NOT NULL DEFAULT '',
    "project_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cronjobs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL DEFAULT '* * * * *',
    "description" TEXT NOT NULL DEFAULT '',
    "command" TEXT NOT NULL DEFAULT '',
    "status" "cronjob_status" NOT NULL DEFAULT 'active',
    "last_run" TIMESTAMPTZ,
    "next_run" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cronjobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_cronjobs" (
    "project_id" INTEGER NOT NULL,
    "cronjob_id" INTEGER NOT NULL,

    CONSTRAINT "project_cronjobs_pkey" PRIMARY KEY ("project_id","cronjob_id")
);

-- CreateTable
CREATE TABLE "github_issues" (
    "id" SERIAL NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "labels" JSONB NOT NULL DEFAULT '[]',
    "assignee" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_prs" (
    "id" SERIAL NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "head_ref" TEXT NOT NULL DEFAULT '',
    "base_ref" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "mergeable" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "review_decision" TEXT NOT NULL DEFAULT '',
    "ci_status" TEXT NOT NULL DEFAULT 'none',
    "status_check_rollup" JSONB DEFAULT '[]',
    "linked_issue_numbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "latest_review_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_prs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_github_issues_assignee_state" ON "github_issues"("assignee", "state");

-- CreateIndex
CREATE UNIQUE INDEX "github_issues_repo_number_key" ON "github_issues"("repo", "number");

-- CreateIndex
CREATE INDEX "idx_github_prs_repo_head_ref_state" ON "github_prs"("repo", "head_ref", "state");

-- CreateIndex
CREATE INDEX "idx_github_prs_author_state" ON "github_prs"("author", "state");

-- CreateIndex
CREATE INDEX "idx_github_prs_author_state_review" ON "github_prs"("author", "state", "review_decision");

-- CreateIndex
CREATE INDEX "idx_github_prs_author_state_mergeable" ON "github_prs"("author", "state", "mergeable");

-- CreateIndex
CREATE UNIQUE INDEX "github_prs_repo_number_key" ON "github_prs"("repo", "number");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cronjobs" ADD CONSTRAINT "project_cronjobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cronjobs" ADD CONSTRAINT "project_cronjobs_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
