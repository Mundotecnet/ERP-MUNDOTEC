import { ResourceList } from '@/components/resource-list';

interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

export function BranchesPage(): JSX.Element {
  return (
    <ResourceList<Branch>
      title="Sucursales"
      endpoint="/branches"
      rowKey={(b) => b.id}
      columns={[
        { header: 'Código', render: (b) => b.code },
        { header: 'Nombre', render: (b) => b.name },
        { header: 'Dirección', render: (b) => b.address ?? '—' },
        { header: 'Teléfono', render: (b) => b.phone ?? '—' },
        {
          header: 'Activa',
          render: (b) => (
            <span
              className={
                b.isActive
                  ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-800'
                  : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
              }
            >
              {b.isActive ? 'Sí' : 'No'}
            </span>
          ),
        },
      ]}
    />
  );
}
