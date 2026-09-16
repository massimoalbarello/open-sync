import type { ReactNode } from 'react';

export function SectionPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="flex min-h-20 items-center border-border border-b px-6 md:px-8">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
      </header>
      <div className="p-6 md:p-8">{children}</div>
    </>
  );
}
