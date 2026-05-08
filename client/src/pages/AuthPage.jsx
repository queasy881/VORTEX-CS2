import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const { login, signup, loading } = useAuth();

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await signup(username, email, password);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-bg min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/3 w-72 h-72 bg-violet-500/30 rounded-full blur-3xl animate-float-slow pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-float pointer-events-none" />

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-12 h-12 rounded-xl bg-grad-primary flex items-center justify-center shadow-glow-violet animate-pulse-glow">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
          <h1 className="text-5xl font-display font-bold gradient-text mb-2">
            VORTEX
          </h1>
          <p className="text-slate-400 text-sm tracking-wide">
            Aggressive compression. Peer-to-peer sharing.
          </p>
        </div>

        <div className="card-hover p-8">
          <div className="grid grid-cols-2 gap-1 p-1 bg-black/30 rounded-lg mb-6 relative">
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-grad-primary rounded-md transition-all duration-300 ease-out shadow-glow-violet"
              style={{ left: mode === 'login' ? '4px' : 'calc(50% + 0px)' }}
            />
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`relative z-10 py-2 rounded-md font-semibold text-sm transition-colors ${
                mode === 'login' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`relative z-10 py-2 rounded-md font-semibold text-sm transition-colors ${
                mode === 'signup' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="animate-slide-up">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="input"
                placeholder="your_handle"
              />
            </div>

            {mode === 'signup' && (
              <div className="animate-scale-in">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="input"
                  placeholder="you@example.com"
                />
              </div>
            )}

            <div className="animate-slide-up">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="animate-scale-in flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-2 group">
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Please wait…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {mode === 'login' ? 'Enter the vortex' : 'Create account'}
                  <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              )}
            </button>
          </form>
        </div>

        <div className="text-center mt-6 text-xs text-slate-500">
          Files crushed with <span className="text-violet-400 font-semibold">FFmpeg</span>, <span className="text-cyan-400 font-semibold">7z</span>, and <span className="text-emerald-400 font-semibold">zstd</span>
        </div>
      </div>
    </div>
  );
}
