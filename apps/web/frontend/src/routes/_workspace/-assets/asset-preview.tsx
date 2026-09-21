import { lazy, Suspense, useState } from 'react';
import { documentPreviewLimits } from '../../../queries/asset-preview/contract';
import { DocumentPreview } from './document-preview';
import { previewFormat } from './format';

const PdfPreview = lazy(() => import('./pdf-preview'));
export function AssetPreview({
  asset,
  userId,
}: {
  userId: string;
  asset: { id: string; name: string; mediaType: string; size: number };
}) {
  const [failed, setFailed] = useState(false);
  const format = previewFormat(asset);
  const url = `/api/receiver/assets/${encodeURIComponent(asset.id)}/preview`;
  if (failed) {
    return (
      <p role="alert">
        This browser could not display the file. Download it to open it in another application.
      </p>
    );
  }
  if (format === 'image') {
    return (
      <img
        src={url}
        alt={asset.name}
        onError={() => setFailed(true)}
        className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain"
      />
    );
  }
  if (format === 'video') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: Synced assets do not supply caption tracks.
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={asset.name}
        onError={() => setFailed(true)}
        className="max-h-[75vh] w-full rounded-lg bg-black"
      />
    );
  }
  if (format === 'audio') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: Synced assets do not supply caption tracks.
      <audio
        src={url}
        controls
        preload="metadata"
        aria-label={asset.name}
        onError={() => setFailed(true)}
        className="w-full"
      />
    );
  }
  if (format === 'pdf') {
    return (
      <Suspense fallback={<p role="status">Loading PDF viewer…</p>}>
        <PdfPreview url={url} />
      </Suspense>
    );
  }
  if (format) {
    return asset.size > documentPreviewLimits.bytes ? (
      <p>
        This file is too large for an in-browser document preview. Download it to view the full
        file.
      </p>
    ) : (
      <DocumentPreview userId={userId} id={asset.id} format={format} />
    );
  }
  return (
    <p className="text-muted-foreground">
      Preview is not available for this file type. Download it to open it in another application.
    </p>
  );
}
