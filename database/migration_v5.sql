BEGIN;

-- ============================================================
-- TASK REVIEW HIERARCHY
--
-- Every task submission has 3 review levels:
--
-- TEAM_LEAD
-- ADMIN
-- SUPER_ADMIN
--
-- Each level has its own independent review state.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_reviews (
    id SERIAL PRIMARY KEY,

    task_id INT NOT NULL
        REFERENCES tasks(id)
        ON DELETE CASCADE,

    submission_id INT NOT NULL
        REFERENCES task_completion_submissions(id)
        ON DELETE CASCADE,

    -- The employee who actually performed the review.
    -- NULL while the review is pending.
    reviewer_id INT
        REFERENCES employees(id)
        ON DELETE SET NULL,

    reviewer_role VARCHAR(30) NOT NULL
        CHECK (
            reviewer_role IN (
                'TEAM_LEAD',
                'ADMIN',
                'SUPER_ADMIN'
            )
        ),

    -- Current state of this hierarchy level.
    decision VARCHAR(30) NOT NULL DEFAULT 'PENDING'
        CHECK (
            decision IN (
                'PENDING',
                'APPROVED',
                'NEEDS_CHANGES',
                'REJECTED',
                'SKIPPED'
            )
        ),

    comment TEXT,

    reviewed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One review record per hierarchy level
    -- for each submission.
    UNIQUE (
        submission_id,
        reviewer_role
    )
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_task_reviews_task
ON task_reviews(task_id);

CREATE INDEX IF NOT EXISTS idx_task_reviews_submission
ON task_reviews(submission_id);

CREATE INDEX IF NOT EXISTS idx_task_reviews_reviewer
ON task_reviews(reviewer_id);

CREATE INDEX IF NOT EXISTS idx_task_reviews_role
ON task_reviews(reviewer_role);

CREATE INDEX IF NOT EXISTS idx_task_reviews_decision
ON task_reviews(decision);


COMMIT;