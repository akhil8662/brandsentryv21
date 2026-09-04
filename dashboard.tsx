import { ProtectedPage } from '@/components/ProtectedPage';
import { DashboardPage } from '@/screens/DashboardPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function DashboardRoute() {
  return (
    <ProtectedPage>
      <ErrorBoundary>
        <DashboardPage />
      </ErrorBoundary>
    </ProtectedPage>
  );
}
