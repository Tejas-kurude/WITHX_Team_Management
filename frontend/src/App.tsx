import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Departments from './pages/Departments';
import Tasks from './pages/Tasks';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import Reports from './pages/Reports';
import Performance from './pages/Performance';
import Notifications from './pages/Notifications';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import Profile from './pages/Profile';
import Messages from './pages/Messages';
import Notepad from './pages/Notepad';
import WorkHours from './pages/WorkHours';
import Legal from './pages/Legal';

function Guard() {
  const { user } = useAuth();
  return user ? <AppLayout /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Guard />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/notepad" element={<Notepad />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/departments" element={<Departments />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/leave" element={<Leave />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/work-hours" element={<WorkHours />} />
          <Route path="/legal" element={<Legal />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
