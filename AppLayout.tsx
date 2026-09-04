import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, LogOut, HelpCircle, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { CartButton } from './CartButton';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';

function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 h-9 px-3 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center text-white text-xs font-semibold">
          {user?.full_name?.charAt(0) ?? 'U'}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-sm font-medium text-gray-900 leading-tight">{user?.full_name}</p>
          <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setOpen(false); } }}
            role="button"
            tabIndex={0}
          />
          <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20 animate-fade-in">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">{user?.full_name}</p>
              <p className="text-xs text-gray-500">{user?.email}</p>
              <Badge variant="info" className="mt-1 text-xs">{user?.department || user?.role}</Badge>
            </div>
            <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <HelpCircle className="w-4 h-4" /> Help & Support
            </button>
            <div className="border-t border-gray-100 mt-1" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop icon-rail collapse — persisted so the preference survives a
  // reload/navigation instead of resetting every time. Guarded for Next's
  // build-time static prerender (server-side, no localStorage there).
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('pharma_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const router = useRouter();

  // Safety net: always close the drawer on route change (Link clicks
  // already close it, but this also covers programmatic navigation).
  useEffect(() => setMobileNavOpen(false), [router.pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('pharma_sidebar_collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-[#fffaf5] overflow-hidden">
      {/* Sidebar is now a direct sibling of the content column in this
          full-height row, instead of sitting below a full-width header —
          its own colored header reaches the very top of the page. */}
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header — scoped to the content column only (no page-title
            breadcrumb), notification bell / Review Batch / user menu. */}
        <header className="h-11 flex-shrink-0 bg-white border-b border-gray-100 flex items-center gap-3 px-4 sm:px-6 z-30">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <NotificationBell />
            <CartButton />
            <UserMenu />
          </div>
        </header>
        <TopNav />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
