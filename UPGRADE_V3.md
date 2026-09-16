# WITHX Management Platform — V3 Upgrade Instructions

This version adds the requested attendance-mode, RBAC, department, task-assignment, ID-generation, dashboard and reporting changes.

## IMPORTANT — Existing database

If you already created and are using `withx_management`, **do not run `schema.sql` or `seed.sql` again**.

In pgAdmin:

1. Select `withx_management`.
2. Open **Query Tool**.
3. Open `database/migration_v3.sql` from this project.
4. Copy all of it into Query Tool.
5. Execute it once with **F5**.
6. Confirm `Query returned successfully`.

The migration preserves existing users/data and adds the new columns/tables/constraints.

## Environment file

For security, the distributed ZIP does not contain your real `backend/.env`.
Copy your existing `.env` into:

`backend/.env`

Example shape:

```env
PORT=5000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/withx_management
JWT_SECRET=your_secret
JWT_EXPIRES_IN=8h
FRONTEND_URL=http://localhost:5173
```

## Run locally

Backend terminal:

```powershell
cd backend
npm install
npm run dev
```

Frontend terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Key behavior in V3

- Attendance mode is selected as **Online** or **Offline**.
- Offline attendance requests browser/device location and verifies it against the company geofence.
- Admin and Super Admin can update company coordinates in Settings.
- Team Lead API access is scoped to users under that Team Lead.
- Admin cannot create Admin/Super Admin accounts; only Super Admin can.
- New user type: **Intern** or **Employee**.
- IDs are generated as `INT001...` and `EMP001...`; deleted IDs are not reused.
- Departments show member counts and can have a Department Head/Team Lead.
- A department cannot be deleted while users are assigned to it.
- Tasks can target one user, multiple users, an entire team, or a department.
- Entire-team tasks apply to current members only. New members do **not** automatically inherit old team tasks.
- Uploaded/Created By is taken from the logged-in account automatically.
- Task deadline and overdue notifications are generated automatically when task/notification data is loaded.
- Super Admin keeps destructive/edit authority for employee, department, task, leave, report and notification records.

## GPS security note

The attendance form does not provide any manual latitude/longitude input. The browser's Geolocation API supplies coordinates and the backend checks the office radius. A normal web application cannot absolutely prevent device-level GPS spoofing or developer-tool/API tampering; stronger anti-spoofing would require a managed mobile app/device attestation or dedicated biometric/GPS hardware.
