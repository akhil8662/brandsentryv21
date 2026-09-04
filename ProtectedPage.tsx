import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { isRestrictedFromBusinessTools } from '@/lib/landing';
import { apiClient } from '@/api/client';

export function ProtectedPage({
  children,
  businessToolsOnly = false,
  adminOnly = false,
}: {
  children: React.ReactNode;
  businessToolsOnly?: boolean;
  adminOnly?: boolean;
}) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(adminOnly);

  const isAdmin = user?.is_superuser || user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (adminOnly) {
      // M-25: Re-validate admin status with GET /auth/me on the server
      setIsVerifyingAdmin(true);
      apiClient.getMe()
        .then((me) => {
          if (!me.is_superuser && me.role !== 'admin' && me.role !== 'super_admin') {
            router.replace('/no-access');
          } else {
            setIsVerifyingAdmin(false);
          }
        })
        .catch(() => {
          router.replace('/no-access');
        });
      return;
    }
    if (businessToolsOnly && isRestrictedFromBusinessTools(user)) {
      router.replace('/no-access');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, user, adminOnly, businessToolsOnly]);

  if (
    isLoading ||
    !isAuthenticated ||
    (adminOnly && (isVerifyingAdmin || !isAdmin)) ||
    (businessToolsOnly && isRestrictedFromBusinessTools(user))
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center animate-pulse">
            <span className="text-white text-2xl font-bold">BS</span>
          </div>
          <p className="text-gray-500 text-sm">Loading BrandSentry Platform...</p>
        </div>
      </div>
    );
  }

  return <AppLayout>{children}</AppLayout>;
}
