# WITHX 2 Sep Update

Implemented without redesigning unrelated modules:

- Attendance search across name, employee ID, department, mode and status.
- Attendance work duration shown as `xh ym`; missing checkout is flagged.
- Activity Log search plus Entity/Module and From/To date filters, backed by API filtering.
- Leave form labels changed to From Date / To Date with date-range validation.
- Task completion proof can be either the existing GitHub/Google Drive link or an uploaded file (max 5 MB).
- Existing Team Lead -> Admin -> Super Admin task review hierarchy retained and connected to uploaded proof/history.
- Daily reports now use Team Lead -> Admin -> Super Admin approval hierarchy; higher roles can act directly and skip lower pending stages.
- Performance formula changed to: Task Completion 35% + On-Time 25% + Attendance 20% + Working Hours 20%.
- Working-hours score is proportional up to the configured minimum and capped at 100% thereafter.
- Default minimum work duration: 180 minutes (3 hours), configurable in Settings.
- Only tasks with backend status COMPLETED count as completed in performance.
- Added `database/migration_v6.sql` for existing databases, including task status compatibility, uploaded proof fields, working-hours score, report review hierarchy, and the 180-minute setting.

## Existing database upgrade

Run migrations in order if they have not already been applied:

1. `database/migration_v4.sql`
2. `database/migration_v5.sql`
3. `database/migration_v6.sql`

If v4 and v5 are already installed, run only `migration_v6.sql`.
