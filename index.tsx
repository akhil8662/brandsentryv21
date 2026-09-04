import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { landingPathFor } from '@/lib/landing';

// "/" itself never renders anything, it just forwards to wherever this user
// (or a not-yet-logged-in visitor) belongs — see landingPathFor.
export default function Index() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(landingPathFor(user));
  }, [isLoading, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500 font-medium">Loading BrandSentry...</p>
      </div>
    </div>
  );
}
