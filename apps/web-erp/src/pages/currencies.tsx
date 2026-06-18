import { ResourceList } from '@/components/resource-list';

interface Currency {
  code: string;
  name: string;
  symbol: string | null;
}

export function CurrenciesPage(): JSX.Element {
  return (
    <ResourceList<Currency>
      title="Monedas"
      endpoint="/currencies"
      rowKey={(c) => c.code}
      columns={[
        { header: 'Código', render: (c) => c.code },
        { header: 'Nombre', render: (c) => c.name },
        { header: 'Símbolo', render: (c) => c.symbol ?? '—' },
      ]}
    />
  );
}
