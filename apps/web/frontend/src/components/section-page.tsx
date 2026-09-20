import type { ReactNode } from 'react';

export function SectionPage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <>
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-border border-b px-6 py-4 md:px-8">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {action}
      </header>
      <div className="p-6 md:p-8 lg:p-10">{children}</div>
    </>
  );
}
