import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AssetDownload } from '../../components/asset-link';
import { SectionPage } from '../../components/section-page';
import { SourceTimestamps } from '../../components/source-timestamps';
import { assetOptions } from '../../queries/assets';
import { AssetPreview } from './-assets/asset-preview';

export const Route = createFileRoute('/_workspace/assets/$id')({ component: AssetDetail });
function AssetDetail() {
  const { userId } = Route.useRouteContext();
  const { id } = Route.useParams();
  const query = useQuery(assetOptions({ userId, id }));
  const asset = query.data;
  return (
    <SectionPage
      title={asset?.name ?? 'Asset'}
      subtitle={
        asset && (
          <p className="break-words text-muted-foreground text-sm">
            {asset.mediaType} · {asset.size.toLocaleString()} bytes
            <SourceTimestamps createdAt={asset.createdAt} updatedAt={asset.updatedAt} />
          </p>
        )
      }
      action={
        <div className="flex items-center gap-5">
          <Link to="/assets" search={{ syncId: asset?.syncId }} className="text-sm underline">
            Back to assets
          </Link>
          {asset && <AssetDownload asset={asset} />}
        </div>
      }
    >
      {query.isPending && <p>Loading asset…</p>}
      {query.error && (
        <div className="space-y-3">
          <p role="alert">{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {asset === null && <p>This asset is no longer available.</p>}
      {asset && (
        <div className="max-w-5xl">
          <AssetPreview key={asset.id} asset={asset} userId={userId} />
        </div>
      )}
    </SectionPage>
  );
}
