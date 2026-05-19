import { QueryClientProvider } from '@tanstack/react-query';
import { createHashRouter, RouterProvider, NavLink, Outlet } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { queryClient } from './api/client';
import { useApiKey } from './hooks/useAuth';
import { ApiKeyPrompt } from './components/ApiKeyPrompt';

const EntryScreen = lazy(() => import('./screens/EntryScreen').then((m) => ({ default: m.EntryScreen })));
const SummaryScreen = lazy(() => import('./screens/SummaryScreen').then((m) => ({ default: m.SummaryScreen })));
const BudgetScreen = lazy(() => import('./screens/BudgetScreen').then((m) => ({ default: m.BudgetScreen })));
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })));

function NavBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center gap-0.5 py-2 flex-1 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`;

  return (
    <nav className="border-t border-gray-200 bg-white flex safe-area-pb">
      <NavLink to="/" end className={linkClass}>
        <span className="text-xl">✏️</span>
        <span>記帳</span>
      </NavLink>
      <NavLink to="/summary" className={linkClass}>
        <span className="text-xl">📊</span>
        <span>統計</span>
      </NavLink>
      <NavLink to="/budget" className={linkClass}>
        <span className="text-xl">💰</span>
        <span>預算</span>
      </NavLink>
      <NavLink to="/import" className={linkClass}>
        <span className="text-xl">📂</span>
        <span>匯入</span>
      </NavLink>
    </nav>
  );
}

function Layout() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="h-full flex items-center justify-center text-gray-400">載入中…</div>}>
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
      <AppShell />
    </QueryClientProvider>
  );
}
