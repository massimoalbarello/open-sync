import { createFileRoute } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';

export const Route = createFileRoute('/_workspace/delivery')({ component: Delivery });

function Delivery() {
  return (
    <SectionPage title="Delivery queue">
      <div className="space-y-2">
        <p className="font-medium">Nothing waiting for delivery</p>
        <p className="text-muted-foreground text-sm">
          Pending deliveries and items that need attention will appear here.
        </p>
      </div>
    </SectionPage>
  );
}
