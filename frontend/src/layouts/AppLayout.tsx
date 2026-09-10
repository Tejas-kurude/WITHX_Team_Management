import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Users, Building2, CalendarCheck, ClipboardList, FileText, Star, Bell, Activity, Settings, LogOut, BarChart3, Palmtree, Menu, X, UserCircle, Clock } from 'lucide-react';
import { useState } from 'react';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = [
    ['Dashboard', '/', LayoutDashboard],
    ['My Profile', '/profile', UserCircle],
    ['Employees', '/employees', Users],
    ['Departments', '/departments', Building2],
    ['Attendance', '/attendance', CalendarCheck],
    ['Leave', '/leave', Palmtree],
    ['Tasks', '/tasks', ClipboardList],
    ['Daily Reports', '/reports', FileText],
    ['Performance', '/performance', Star],
    ['Work Hours', '/work-hours', Clock],
    ['Notifications', '/notifications', Bell],
    ['Reports & Analytics', '/analytics', BarChart3],
    ['Activity Logs', '/activity', Activity],
    ['Settings', '/settings', Settings],
  ] as const;

  const visible = (name: string) => {
    if (user?.role === 'EMPLOYEE') return !['Employees', 'Departments', 'Reports & Analytics', 'Activity Logs', 'Settings', 'Work Hours'].includes(name);
    if (user?.role === 'TEAM_LEAD') return !['Departments', 'Activity Logs', 'Settings', 'Work Hours'].includes(name);
    return true;
  };

  return (
    <div className="min-h-screen bg-[#f7f9fc]">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-navy text-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
          <img src="/withx-logo.png" className="h-11 w-40 object-contain object-left" alt="WithX" />
          <div className="sr-only">WITHX Management Platform</div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        <nav className="p-3">
          {nav.filter(x => visible(x[0])).map(([name, to, Icon]) => (
            <NavLink end={to === '/'} to={to} key={name} onClick={() => setOpen(false)} className={({ isActive }) => `mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-orange text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}>
              <Icon size={18} />{name}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-20 items-center border-b bg-white/95 px-4 backdrop-blur md:px-7">
          <button className="mr-3 lg:hidden" onClick={() => setOpen(true)}><Menu /></button>
          <div>
            <div className="font-extrabold text-navy">WITHX Management Platform</div>
            <div className="text-xs muted">People • Work • Attendance • Performance</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block"><div className="text-sm font-bold">{user?.name}</div><div className="text-xs muted">{user?.role.replace(/_/g, ' ')}</div></div>
            <button onClick={logout} className="btn btn-primary"><LogOut size={16} /><span className="hidden sm:inline">Logout</span></button>
          </div>
        </header>
        <div className="p-4 md:p-7"><Outlet /></div>
      </main>
    </div>
  );
}
