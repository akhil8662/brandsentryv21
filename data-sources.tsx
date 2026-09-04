import { ProtectedPage } from '@/components/ProtectedPage';
import { DataSourcesPage } from '@/screens/DataSourcesPage';

export default function DataSourcesRoute() {
  return (
    <ProtectedPage businessToolsOnly>
      <DataSourcesPage />
    </ProtectedPage>
  );
}
