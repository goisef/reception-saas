import Link from 'next/link';
import type { ReactNode } from 'react';
import { currentSession } from '@/lib/admin/session';

const NAV = [
  { href: '/admin', label: 'ダッシュボード' },
  { href: '/admin/reservations', label: '予約' },
  { href: '/admin/visits', label: '来店・退出' },
  { href: '/admin/customers', label: '顧客' },
  { href: '/admin/access-numbers', label: '番号' },
  { href: '/admin/exports', label: '帳票' },
  { href: '/admin/settings', label: '端末設定' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="text-lg font-semibold">
            Reception 管理
          </Link>
          <div className="text-sm text-slate-500">
            {session.displayName}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
              {session.role}
            </span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
