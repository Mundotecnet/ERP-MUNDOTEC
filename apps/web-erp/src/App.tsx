import { Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '@/auth/protected-route';
import { Shell } from '@/layout/shell';
import { BranchesPage } from '@/pages/branches';
import { CurrenciesPage } from '@/pages/currencies';
import { DashboardPage } from '@/pages/dashboard';
import { LoginPage } from '@/pages/login';
import { RolesPage } from '@/pages/roles';
import { SettingsPage } from '@/pages/settings';
import { UsersPage } from '@/pages/users';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="branches" element={<BranchesPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="currencies" element={<CurrenciesPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
