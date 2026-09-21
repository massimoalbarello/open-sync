import type { ReactNode } from 'react';

export function SectionPage({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <>
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-border border-b px-6 py-4 md:px-8">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words font-semibold text-2xl tracking-tight">{title}</h1>
          {subtitle}
        </div>
        {action}
      </header>
      <div className="p-6 md:p-8 lg:p-10">{children}</div>
    </>
  );
}
