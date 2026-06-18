import { ResourceList } from '@/components/resource-list';

interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isSalesperson: boolean;
  commissionPct: string;
  lastLoginAt: string | null;
}

export function UsersPage(): JSX.Element {
  return (
    <ResourceList<User>
      title="Usuarios"
      endpoint="/users?page=1&pageSize=100"
      rowKey={(u) => u.id}
      columns={[
        { header: 'Usuario', render: (u) => u.username },
        { header: 'Correo', render: (u) => u.email },
        { header: 'Nombre', render: (u) => u.fullName },
        {
          header: 'Vendedor',
          render: (u) => (u.isSalesperson ? `${(Number(u.commissionPct) * 100).toFixed(2)}%` : '—'),
        },
        {
          header: 'Último login',
          render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'),
        },
      ]}
    />
  );
}
