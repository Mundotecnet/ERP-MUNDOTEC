import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

interface StockRow {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  avgCost: string;
  updatedAt: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

export function StockPage(): JSX.Element {
  const [productId, setProductId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');

  const productsQ = useQuery<Product[]>({
    queryKey: ['products', 'list-for-stock'],
    queryFn: async () => (await api.get('/products')).data,
  });
  const warehousesQ = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });

  const params = new URLSearchParams();
  if (productId) params.set('productId', productId);
  if (warehouseId) params.set('warehouseId', warehouseId);
  const qs = params.toString();

  const stockQ = useQuery<StockRow[]>({
    queryKey: ['stock', qs],
    queryFn: async () => (await api.get(`/stock${qs ? `?${qs}` : ''}`)).data,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Existencias por almacén</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="filter-product">Producto</Label>
            <Select
              id="filter-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">— Todos —</option>
              {productsQ.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="filter-warehouse">Almacén</Label>
            <Select
              id="filter-warehouse"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">— Todos —</option>
              {warehousesQ.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {stockQ.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {stockQ.error && (
          <p className="text-sm text-destructive">No se pudo cargar el inventario.</p>
        )}
        {!stockQ.isLoading && (stockQ.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin existencias para los filtros aplicados.
          </p>
        )}
        {(stockQ.data ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">SKU</th>
                  <th className="py-2 pr-4 font-medium">Producto</th>
                  <th className="py-2 pr-4 font-medium">Almacén</th>
                  <th className="py-2 pr-4 font-medium text-right">Cantidad</th>
                  <th className="py-2 pr-4 font-medium text-right">Costo prom.</th>
                </tr>
              </thead>
              <tbody>
                {stockQ.data!.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 font-mono text-xs">{s.productSku}</td>
                    <td className="py-2 pr-4">{s.productName}</td>
                    <td className="py-2 pr-4">
                      <span className="font-mono text-xs">{s.warehouseCode}</span> —{' '}
                      {s.warehouseName}
                    </td>
                    <td className="py-2 pr-4 text-right">{s.quantity}</td>
                    <td className="py-2 pr-4 text-right">{s.avgCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ''}`}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
