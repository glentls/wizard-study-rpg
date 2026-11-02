import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout, usePreferenceClasses } from './components/Layout';
import { Loading } from './components/ui';
import { Adventure, Battle } from './pages/Adventure';
import { ResetPassword, VerifyEmail } from './pages/AuthLinks';
import { Dashboard } from './pages/Dashboard';
import { Focus } from './pages/Focus';
import { History } from './pages/History';
import { Onboarding } from './pages/Onboarding';
import { Research } from './pages/Research';
import { Settings } from './pages/Settings';
import { Welcome } from './pages/Welcome';
import { Wizard } from './pages/Wizard';

export function App() {
  const { status, me } = useAuth();
  usePreferenceClasses();

  if (status === 'loading') {
    return (
      <div className="center-screen">
        <Loading label="Opening the spellbook" />
      </div>
    );
  }

  // Public routes work in any state.
  const publicRoutes = [
    <Route key="reset" path="/auth/reset" element={<ResetPassword />} />,
    <Route key="verify" path="/auth/verify" element={<VerifyEmail />} />,
  ];

  if (status === 'anonymous') {
    return (
      <main id="main" className="public-shell">
        <Routes>
          {publicRoutes}
          <Route path="*" element={<Welcome />} />
        </Routes>
      </main>
    );
  }

  if (!me?.wizard) {
    return (
      <main id="main" className="public-shell">
        <Routes>
          {publicRoutes}
          <Route path="*" element={<Onboarding />} />
        </Routes>
      </main>
    );
  }

  return (
    <Routes>
      {publicRoutes}
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/focus" element={<Focus />} />
        <Route path="/research" element={<Research />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/adventure" element={<Adventure />} />
        <Route path="/adventure/:matchId" element={<Battle />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
