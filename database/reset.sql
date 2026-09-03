DROP TABLE IF EXISTS activity_logs,notifications,performance_scores,leave_requests,daily_reports,attendance,tasks,users,employees,departments,system_settings CASCADE;
\i schema.sql
\i seed.sql
