import { Download } from 'lucide-react';

export function AssetLink({ asset }: { asset: { id: string; name: string } }) {
  return (
    <a
      href={`/api/receiver/assets/${encodeURIComponent(asset.id)}`}
      download={asset.name}
      aria-label={`Download ${asset.name}`}
      className="inline-flex max-w-full items-center gap-2 rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Download aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 break-all">{asset.name}</span>
    </a>
  );
}
