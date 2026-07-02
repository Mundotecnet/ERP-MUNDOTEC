import { Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '@/auth/protected-route';
import { Shell } from '@/layout/shell';
import { BranchesPage } from '@/pages/branches';
import { CurrenciesPage } from '@/pages/currencies';
import { DashboardPage } from '@/pages/dashboard';
import { DepartmentsPage } from '@/pages/departments';
import { InvoicesPage } from '@/pages/invoices';
import { LoginPage } from '@/pages/login';
import { MovementsPage } from '@/pages/movements';
import { PartnersPage } from '@/pages/partners';
import { ProductCategoriesPage } from '@/pages/product-categories';
import { ProductsPage } from '@/pages/products';
import { PurchaseOrdersPage } from '@/pages/purchase-orders';
import { QuotationsPage } from '@/pages/quotations';
import { ReceiptsPage } from '@/pages/receipts';
import { RolesPage } from '@/pages/roles';
import { SalesOrdersPage } from '@/pages/sales-orders';
import { SettingsPage } from '@/pages/settings';
import { StockPage } from '@/pages/stock';
import { TaxesPage } from '@/pages/taxes';
import { UnitsOfMeasurePage } from '@/pages/units-of-measure';
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
          <Route
            path="partners"
            element={
              <ProtectedRoute permission="partners.read">
                <PartnersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="purchase-orders"
            element={
              <ProtectedRoute permission="purchases.po.read">
                <PurchaseOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="receipts"
            element={
              <ProtectedRoute permission="purchases.receipt.read">
                <ReceiptsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="quotations"
            element={
              <ProtectedRoute permission="sales.quote.read">
                <QuotationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="sales-orders"
            element={
              <ProtectedRoute permission="sales.order.read">
                <SalesOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="invoices"
            element={
              <ProtectedRoute permission="sales.invoice.read">
                <InvoicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="branches"
            element={
              <ProtectedRoute permission="branch.read">
                <BranchesPage />
              </ProtectedRoute>
            }
          />
          <Route path="users" element={<UsersPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route
            path="product-categories"
            element={
              <ProtectedRoute permission="catalogs.product-category.read">
                <ProductCategoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="departments"
            element={
              <ProtectedRoute permission="catalogs.department.read">
                <DepartmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="units-of-measure"
            element={
              <ProtectedRoute permission="catalogs.uom.read">
                <UnitsOfMeasurePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="taxes"
            element={
              <ProtectedRoute permission="catalogs.tax.read">
                <TaxesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="currencies"
            element={
              <ProtectedRoute permission="catalogs.currency.read">
                <CurrenciesPage />
              </ProtectedRoute>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
