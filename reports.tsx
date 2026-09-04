import { ProtectedPage } from '@/components/ProtectedPage';
import { ReportsPage } from '@/screens/ReportsPage';

export default function ReportsRoute() {
  return (
    <ProtectedPage>
      <ReportsPage />
    </ProtectedPage>
  );
}
