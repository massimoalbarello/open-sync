import { createFileRoute } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';

export const Route = createFileRoute('/_workspace/providers')({ component: Providers });

function Providers() {
  return (
    <SectionPage title="Providers">
      <div className="space-y-2">
        <p className="font-medium">No providers connected</p>
        <p className="text-muted-foreground text-sm">Provider setup will be available here.</p>
      </div>
    </SectionPage>
  );
}
