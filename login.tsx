import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { landingPathFor } from '@/lib/landing';
import { LoginPage } from '@/screens/LoginPage';

export default function Login() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  // Already signed in? Don't show the login form — bounce straight to
  // wherever this user belongs (mirrors the old
  // `isAuthenticated ? <Navigate to={landing}/> : <LoginPage/>` route).
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(landingPathFor(user));
    }
  }, [isLoading, isAuthenticated, user, router]);

    if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center animate-pulse">
            <span className="text-white text-2xl font-bold">BS</span>
          </div>
          <p className="text-gray-500 text-sm">Loading BrandSentry...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) return null;

  return <LoginPage />;
}
