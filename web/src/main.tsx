import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { AccountsPage } from './pages/Accounts';
import { CardsPage } from './pages/Cards';
import { DashboardPage } from './pages/Dashboard';
import { ForecastPage } from './pages/Forecast';
import { GoalsPage } from './pages/Goals';
import { ImportPage } from './pages/Import';
import { InstallmentsPage } from './pages/Installments';
import { InvestmentsPage } from './pages/Investments';
import { LoginPage } from './pages/Login';
import { RecurringPage } from './pages/Recurring';
import { ReportsPage } from './pages/Reports';
import { RulesPage } from './pages/Rules';
import { SettingsPage } from './pages/Settings';
import { SimulatorPage } from './pages/Simulator';
import { TransactionsPage } from './pages/Transactions';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
});

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/entrar" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<LoginPage />} />
            <Route
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="previsao" element={<ForecastPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="lancamentos" element={<TransactionsPage />} />
              <Route path="contas" element={<AccountsPage />} />
              <Route path="cartoes" element={<CardsPage />} />
              <Route path="recorrentes" element={<RecurringPage />} />
              <Route path="parcelamentos" element={<InstallmentsPage />} />
              <Route path="metas" element={<GoalsPage />} />
              <Route path="simulador" element={<SimulatorPage />} />
              <Route path="investimentos" element={<InvestmentsPage />} />
              <Route path="importar" element={<ImportPage />} />
              <Route path="regras" element={<RulesPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
