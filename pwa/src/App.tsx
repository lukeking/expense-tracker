import { QueryClientProvider } from '@tanstack/react-query';
import { createHashRouter, RouterProvider, NavLink, Outlet } from 'react-router-dom';
import { Suspense, lazy, useState } from 'react';
import { queryClient } from './api/client';
import { useApiKey } from './hooks/useAuth';
import { ApiKeyPrompt } from './components/ApiKeyPrompt';
import { SettingsProvider } from './context/SettingsContext';
import { SettingsSheet } from './components/SettingsSheet';
import { UpdateBanner } from './components/UpdateBanner';
import { useT } from './i18n';

const EntryScreen = lazy(() => import('./screens/EntryScreen').then((m) => ({ default: m.EntryScreen })));
const SummaryScreen = lazy(() => import('./screens/SummaryScreen').then((m) => ({ default: m.SummaryScreen })));
const BudgetScreen = lazy(() => import('./screens/BudgetScreen').then((m) => ({ default: m.BudgetScreen })));
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })));

function NavBar() {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center gap-0.5 py-2 flex-1 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500 dark:text-gray-400'}`;

  return (
    <>
      <nav className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex safe-area-pb">
        <NavLink to="/" end className={linkClass}>
          <span className="text-xl">✏️</span>
          <span>{t('nav.entry')}</span>
        </NavLink>
        <NavLink to="/summary" className={linkClass}>
          <span className="text-xl">📊</span>
          <span>{t('nav.summary')}</span>
        </NavLink>
        <NavLink to="/budget" className={linkClass}>
          <span className="text-xl">💰</span>
          <span>{t('nav.budget')}</span>
        </NavLink>
        <NavLink to="/import" className={linkClass}>
          <span className="text-xl">📂</span>
          <span>{t('nav.import')}</span>
        </NavLink>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex flex-col items-center gap-0.5 py-2 px-3 text-xs text-gray-500 dark:text-gray-400"
        >
          <span className="text-xl">⚙️</span>
          <span>{t('nav.settings')}</span>
        </button>
      </nav>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function Layout() {
  const t = useT();
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div>}>
          <Outlet />
        </Suspense>
      </div>
      <NavBar />
    </div>
  );
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <EntryScreen /> },
      { path: '/summary', element: <SummaryScreen /> },
      { path: '/budget', element: <BudgetScreen /> },
      { path: '/import', element: <ImportScreen /> },
    ],
  },
]);

function AppShell() {
  const { apiKey, refresh } = useApiKey();

  if (!apiKey) {
    return <ApiKeyPrompt onSuccess={refresh} />;
  }

  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AppShell />
        <UpdateBanner />
      </SettingsProvider>
    </QueryClientProvider>
  );
}
