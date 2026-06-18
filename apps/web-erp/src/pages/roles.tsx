import { ResourceList } from '@/components/resource-list';

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export function RolesPage(): JSX.Element {
  return (
    <ResourceList<Role>
      title="Roles"
      endpoint="/roles?page=1&pageSize=100"
      rowKey={(r) => r.id}
      columns={[
        { header: 'Nombre', render: (r) => r.name },
        { header: 'Descripción', render: (r) => r.description ?? '—' },
        {
          header: 'Permisos',
          render: (r) =>
            r.permissions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <span key={p} className="rounded bg-muted px-2 py-0.5 text-xs">
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              '—'
            ),
        },
      ]}
    />
  );
}
