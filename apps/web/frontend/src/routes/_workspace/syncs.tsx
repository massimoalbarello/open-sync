import { createFileRoute } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';

export const Route = createFileRoute('/_workspace/syncs')({ component: Syncs });

function Syncs() {
  return (
    <SectionPage title="Syncs">
      <div className="space-y-2">
        <p className="font-medium">No syncs yet</p>
        <p className="text-muted-foreground text-sm">
          Syncs and their latest progress will appear here.
        </p>
      </div>
    </SectionPage>
  );
}
