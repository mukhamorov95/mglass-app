-- Drop all Academy tables. The feature was removed from the codebase
-- (app/academy, app/admin/academy, app/api/academy deleted).
-- These tables had 0 rows in production and are no longer referenced anywhere.

DROP TABLE IF EXISTS academy_quiz_attempts  CASCADE;
DROP TABLE IF EXISTS academy_user_progress  CASCADE;
DROP TABLE IF EXISTS academy_quiz_questions CASCADE;
DROP TABLE IF EXISTS academy_lessons        CASCADE;
DROP TABLE IF EXISTS academy_modules        CASCADE;
