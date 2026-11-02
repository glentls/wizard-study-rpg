import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ELEMENT_ICON } from '../lib/format';

const NAV = [
  { to: '/dashboard', label: 'Home' },
  { to: '/focus', label: 'Focus' },
  { to: '/research', label: 'Research' },
  { to: '/wizard', label: 'Wizard' },
  { to: '/adventure', label: 'Adventure' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

/** Applies accessibility preferences to the document root (NFR-005). */
export function usePreferenceClasses() {
  const { me } = useAuth();
  useEffect(() => {
    const a = me?.preferences.accessibility;
    const root = document.documentElement;
    root.classList.toggle('reduced-motion', Boolean(a?.reducedMotion));
    root.classList.toggle('high-contrast', Boolean(a?.highContrast));
    root.classList.toggle('large-text', Boolean(a?.largeText));
  }, [me?.preferences.accessibility]);
}

export function Layout() {
  const { me } = useAuth();
  usePreferenceClasses();
  const wizard = me?.wizard;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/dashboard" className="brand" aria-label="Wizard Study home">
          <span aria-hidden="true">🪄</span> Wizard Study
        </NavLink>
        {wizard && (
          <div className="topbar-wizard" aria-label="Your wizard">
            <span aria-hidden="true">{ELEMENT_ICON[wizard.element]}</span>
            <span className="topbar-name">{wizard.name}</span>
            <span className="pill">{me.balances.RESEARCH_POINTS} RP</span>
          </div>
        )}
        <nav aria-label="Main">
          <ul className="nav-list">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer muted">
        Focus time is self-reported. Wizard Study rewards consistent focus; it does not verify learning.
      </footer>
    </div>
  );
}
