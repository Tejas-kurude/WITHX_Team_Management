import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { messageOf } from '../services/api';
import { Navigate } from 'react-router-dom';

export default function Login() {
  const { user, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);

    try {
      await login(email, password);
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white md:grid md:grid-cols-2">

      {/* LEFT SIDE - LOGIN */}
      <div className="flex items-center justify-center bg-white p-8 md:p-12 lg:p-16">
        <div className="w-full max-w-xl">

          {/* LOGO + WELCOME TEXT */}
          <div className="mb-14 flex items-center gap-6">

            <img
              src="/withx-logo.png"
              alt="WITHX Logo"
              className="h-24 w-24 shrink-0 object-contain"
            />

            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-navy md:text-5xl">
                Welcome back
              </h1>

              <p className="mt-3 text-base text-slate-500 md:text-lg">
                Sign in to the WITHX Management Platform.
              </p>

              <div className="mt-6 h-1 w-16 bg-orange" />
            </div>

          </div>

          {/* LOGIN FORM */}
          <form onSubmit={submit} className="space-y-7">

            {/* EMAIL */}
            <div>
              <label className="label">
                Email
              </label>

              <input
                className="input mt-2 w-full"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {/* PASSWORD */}
            <div>
              <label className="label">
                Password
              </label>

              <input
                className="input mt-2 w-full"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {/* ERROR MESSAGE */}
            {err && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}

            {/* SIGN IN BUTTON */}
            <button
              className="btn btn-primary w-full"
              disabled={busy}
            >
              {busy ? 'Signing in...' : 'Sign In'}
            </button>

          </form>

          {/* ADMIN MESSAGE */}
          <p className="mt-8 text-sm text-slate-500">
            Accounts are created only by authorized administrators.
          </p>

        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="hidden items-center justify-center bg-navy p-12 text-white md:flex">
        <div className="max-w-lg">

          <div className="text-sm font-bold uppercase tracking-[.2em] text-orange">
            WITHX Innovations
          </div>

          <h2 className="mt-4 text-5xl font-extrabold leading-tight">
            One connected platform for company operations.
          </h2>

          <p className="mt-5 text-lg text-white/70">
            Employees, attendance, tasks, daily work, leave,
            performance and analytics — together in real time.
          </p>

        </div>
      </div>

    </div>
  );
}
