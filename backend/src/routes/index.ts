import { Router } from 'express';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { login, me } from '../controllers/authController.js';
import * as c from '../controllers/coreController.js';
const r = Router();
r.post('/auth/login', login); r.get('/auth/me', authenticate, me);
r.get('/dashboard', authenticate, c.dashboard);
r.get('/departments', authenticate, c.listDepartments); r.get('/departments/:id', authenticate, c.getDepartment); r.post('/departments', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN'), c.createDepartment); r.put('/departments/:id', authenticate, allowRoles('SUPER_ADMIN'), c.updateDepartment); r.delete('/departments/:id', authenticate, allowRoles('SUPER_ADMIN'), c.deleteDepartment);
r.get('/employees', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'), c.listEmployees); r.get('/employees/:id', authenticate, c.getEmployee); r.post('/employees', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN'), c.createEmployee); r.put('/employees/:id', authenticate, allowRoles('SUPER_ADMIN'), c.updateEmployee); r.delete('/employees/:id', authenticate, allowRoles('SUPER_ADMIN'), c.deleteEmployee);
r.get('/tasks', authenticate, c.listTasks);
r.get(
  '/tasks/:id/review-history',
  authenticate,
  c.taskReviewHistory
);

r.post(
    '/tasks',
    authenticate,
    allowRoles('SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'),
    c.createTask
);

r.put(
    '/tasks/:id',
    authenticate,
    c.updateTask
);

r.post(
    '/tasks/:id/submit',
    authenticate,
    c.submitTaskForReview
);

r.post(
    '/tasks/:id/review',
    authenticate,
    allowRoles('SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'),
    c.reviewTask
);

r.put(
    '/tasks/:id/admin',
    authenticate,
    allowRoles('SUPER_ADMIN'),
    c.adminUpdateTask
);

r.delete(
    '/tasks/:id',
    authenticate,
    allowRoles('SUPER_ADMIN'),
    c.deleteTask
);

r.get('/attendance/today', authenticate, c.attendanceToday); r.get('/attendance', authenticate, c.listAttendance); r.post('/attendance/check-in', authenticate, c.checkIn); r.post('/attendance/check-out', authenticate, c.checkOut);
r.get('/reports', authenticate, c.listReports); r.post('/reports', authenticate, c.submitReport); r.put('/reports/:id/review', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'), c.reviewReport); r.put('/reports/:id', authenticate, allowRoles('SUPER_ADMIN'), c.adminUpdateReport); r.delete('/reports/:id', authenticate, allowRoles('SUPER_ADMIN'), c.deleteReport);
r.get('/leave', authenticate, c.listLeaves); r.post('/leave', authenticate, c.applyLeave); r.put('/leave/:id/decision', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN'), c.decideLeave); r.put('/leave/:id', authenticate, allowRoles('SUPER_ADMIN'), c.updateLeaveRequest); r.delete('/leave/:id', authenticate, allowRoles('SUPER_ADMIN'), c.deleteLeave);
r.get('/performance', authenticate, c.performanceList); r.post('/performance/calculate', authenticate, c.performance);
r.get('/notifications', authenticate, c.notifications); r.put('/notifications/:id/read', authenticate, c.markNotification); r.put('/notifications/:id', authenticate, allowRoles('SUPER_ADMIN'), c.updateNotification); r.delete('/notifications/:id', authenticate, allowRoles('SUPER_ADMIN'), c.deleteNotification);
r.get('/activity', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN'), c.activity);
r.get('/analytics', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'), c.analytics);
r.get('/export/:kind', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'), c.exportCsv);
r.get('/settings', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN'), c.getSettings); r.put('/settings', authenticate, allowRoles('SUPER_ADMIN', 'ADMIN'), c.saveSettings);
export default r;
