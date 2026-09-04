import { ProtectedPage } from '@/components/ProtectedPage';
import { SettingsPage } from '@/screens/SettingsPage';

export default function SettingsRoute() {
  return (
    <ProtectedPage>
      <SettingsPage />
    </ProtectedPage>
  );
}
