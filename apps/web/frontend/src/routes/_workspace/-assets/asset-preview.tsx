import { lazy, Suspense, useState } from 'react';
import { documentByteLimit } from '../../../queries/asset-preview';
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
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={asset.name}
        onError={() => setFailed(true)}
        className="max-h-[75vh] w-full rounded-lg bg-black"
      >
        <track kind="captions" />
      </video>
    );
  }
  if (format === 'audio') {
    return (
      <audio
        src={url}
        controls
        preload="metadata"
        aria-label={asset.name}
        onError={() => setFailed(true)}
        className="w-full"
      >
        <track kind="captions" />
      </audio>
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
    return asset.size > documentByteLimit ? (
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
