import { Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '@/auth/protected-route';
import { Shell } from '@/layout/shell';
import { BranchesPage } from '@/pages/branches';
import { CurrenciesPage } from '@/pages/currencies';
import { DashboardPage } from '@/pages/dashboard';
import { LoginPage } from '@/pages/login';
import { MovementsPage } from '@/pages/movements';
import { ProductsPage } from '@/pages/products';
import { RolesPage } from '@/pages/roles';
import { SettingsPage } from '@/pages/settings';
import { StockPage } from '@/pages/stock';
import { UsersPage } from '@/pages/users';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="products"
            element={
              <ProtectedRoute permission="catalogs.product.read">
                <ProductsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="stock"
            element={
              <ProtectedRoute permission="inventory.stock.read">
                <StockPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="movements"
            element={
              <ProtectedRoute permission="inventory.movement.read">
                <MovementsPage />
              </ProtectedRoute>
            }
          />
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
