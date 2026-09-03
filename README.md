# WITHX Management Platform

A full-stack company management platform based on the supplied WITHX project guide and visual identity.

## Included modules

- Role-based authentication: Super Admin, Admin, Team Lead, Employee
- Employee management and admin-created accounts
- Department management
- GPS-assisted attendance with check-in/check-out and configurable office geofence
- Leave application with Super Admin/Admin approval (Team Lead approval removed)
- Task creation, assignment, priorities, deadlines, status and progress
- Daily work reports with hierarchy-based review permissions
- Automatic performance scoring
- Notifications
- Reports & analytics with CSV export
- Search/filter support
- Activity/audit logs
- System settings
- Responsive WITHX-themed UI using #0A192F and ochre/golden #AC7D0C


## Role rules applied in the 27 Aug 2026 bug-fix build

- Super Admin: full leave edit/delete controls; can view all daily reports.
- Admin: cannot approve/reject their own leave; their daily report is visible only to themselves and Super Admin reviews it.
- Team Lead: no leave approval permission; daily reports include their own report plus directly supervised team-member reports; they cannot review their own report.
- Employee: retains own-task, own-leave and own-report access.
- Tasks: a task assignee can update their own task progress even when the assignee role is Team Lead/Admin; management assignment APIs remain connected to the same backend.
- Brand accent: ochre/golden `#AC7D0C` (`rgb(172, 125, 12)`) and the supplied WithX logo image.

## Technology

Frontend: React + TypeScript + Vite + Tailwind CSS
Backend: Node.js + Express + TypeScript
Database: PostgreSQL
Authentication: JWT + bcrypt
Charts: Recharts

## Performance formula

- Task completion: 30%
- On-time completion: 25%
- Attendance: 20%
- Punctuality: 10%
- Daily report consistency: 15%

The calculation uses the latest 30 days of operational data. Report consistency currently assumes 22 expected working-report days in a 30-day period; this can be made configurable later.

## First-time setup (recommended: Docker for PostgreSQL)

Requirements:
- Node.js 20+
- npm
- Docker Desktop (recommended) OR PostgreSQL 14+

### 1. Start PostgreSQL

From the project root:

```bash
docker compose up -d postgres
```

The database, schema and starter Super Admin account are initialized automatically the first time the volume is created.

If you do not use Docker, create a PostgreSQL database named `withx_management`, then run:

```bash
psql -U postgres -d withx_management -f database/schema.sql
psql -U postgres -d withx_management -f database/seed.sql
```

### Existing database upgrade

If this project is replacing an older WITHX build, run the existing V3 migration once before starting the API:

```bash
psql -U postgres -d withx_management -f database/migration_v3.sql
```

This is important for the Task module because it adds the assignment batch/scope, start date, attachment and notification fields expected by the current backend.

### 2. Configure backend

Copy:

```bash
cd backend
cp .env.example .env
```

On Windows PowerShell you can use:

```powershell
Copy-Item .env.example .env
```

Change `JWT_SECRET` in `backend/.env`.

### 3. Configure frontend

```bash
cd ../frontend
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 4. Install dependencies

From the project root:

```bash
npm install
```

### 5. Run both frontend and backend

```bash
npm run dev
```

Open:

`http://localhost:5173`

API health check:

`http://localhost:5000/api/health`

## Starter login

Email: `admin@withx.local`
Password: `Admin@123`

Change this account/password before any real deployment. The starter credentials are for local development only.

## GPS attendance setup

1. Sign in as Super Admin.
2. Open **Settings**.
3. Enter the real office latitude and longitude.
4. Set the allowed geofence radius in metres (default: 300 m).
5. Employees must allow browser location access when checking in/out.

When office coordinates are not configured, the platform still captures GPS coordinates but does not mark the location as verified. When coordinates are configured, check-in is rejected outside the allowed radius.

For a live deployment, browser geolocation should be served over HTTPS.

## Roles

### Super Admin
Full system access, including platform settings, employees, departments, analytics and audit logs.

### Admin / Management
Manages employees, departments, attendance, tasks, reports, performance, analytics and leave decisions.

### Team Lead
Sees their own team, assigns tasks, reviews reports, tracks attendance/performance and approves/rejects team leave requests.

### Employee
Sees their own work only: attendance, assigned tasks, leave, daily reports, performance and notifications.

## Important note about biometric attendance

GPS attendance is implemented in this version. Real fingerprint/biometric attendance cannot be implemented honestly without knowing the physical biometric device or vendor API. The database and application architecture can be extended once the hardware/device API is selected.

## Project structure

```text
WITHX-Management-Platform/
├── frontend/
│   ├── public/withx-logo.jpeg
│   └── src/
│       ├── components/
│       ├── context/
│       ├── layouts/
│       ├── pages/
│       ├── services/
│       └── types/
├── backend/
│   └── src/
│       ├── config/
│       ├── controllers/
│       ├── middleware/
│       ├── routes/
│       ├── services/
│       └── utils/
├── database/
│   ├── schema.sql
│   └── seed.sql
├── docker-compose.yml
└── README.md
```

## Before going live

- Replace development credentials and JWT secret.
- Configure a managed PostgreSQL database.
- Configure production CORS URL.
- Set actual office geofence coordinates.
- Add rate limiting and email-based password reset if required.
- Configure HTTPS.
- Add automated backups.
- Review privacy policy and employee consent for GPS attendance.
- Connect biometric hardware only through an approved vendor/device API.
