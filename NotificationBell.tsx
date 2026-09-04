import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, CheckCheck, CheckCircle2, XCircle, RefreshCw, Send, Trash2, X,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import type { Notification, NotificationType } from '@/types';
import { cn } from '@/lib/utils';

// ── helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const TYPE_META: Record<NotificationType, { icon: React.ElementType; color: string; bg: string }> = {
  legal_submitted:      { icon: Send,         color: 'text-blue-600',   bg: 'bg-blue-100'   },
  legal_approved:       { icon: CheckCircle2, color: 'text-green-600',  bg: 'bg-green-100'  },
  legal_rejected:       { icon: XCircle,      color: 'text-red-600',    bg: 'bg-red-100'    },
  legal_needs_revision: { icon: RefreshCw,    color: 'text-orange-600', bg: 'bg-orange-100' },
  legal_retracted:      { icon: Trash2,       color: 'text-gray-500',   bg: 'bg-gray-100'   },
};

// ── component ──────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const router = useRouter();

  // Poll unread count every 30 s
  const { data: countData } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => apiClient.getUnreadCount(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Fetch full list only when panel is open
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiClient.getNotifications(),
    enabled: open,
    staleTime: 10_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => apiClient.markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
    },
  });

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const unread = countData?.count ?? 0;

  function handleClick(n: Notification) {
    if (!n.is_read) markRead.mutate(n.id);
    setOpen(false);
    // All notification types are legal-review lifecycle events, and both
    // submitters and reviewers work out of the same shared queue page.
    router.push('/trademark-review');
  }

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
      >
        <Bell className="w-4 h-4 text-gray-600" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-orange-600 rounded-full text-[9px] font-bold text-white flex items-center justify-center px-1 leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown — fixed to the viewport's top-right corner (not just the
          bell's own edge) since the bell isn't the last icon in the header;
          CartButton/UserMenu sit to its right. */}
      {open && (
        <div className="fixed top-14 right-4 sm:right-6 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 flex flex-col max-h-[480px]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gray-700" />
              <span className="font-semibold text-gray-900 text-sm">Notifications</span>
              {unread > 0 && (
                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">
                  {unread} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  className="text-xs text-orange-600 hover:text-orange-800 font-medium flex items-center gap-1 px-2 py-1 rounded-md hover:bg-orange-50 transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => {
                const meta = TYPE_META[n.type] ?? TYPE_META.legal_submitted;
                const Icon = meta.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0',
                      !n.is_read && 'bg-orange-50/50'
                    )}
                  >
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', meta.bg)}>
                      <Icon className={cn('w-4 h-4', meta.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn('text-sm leading-snug', n.is_read ? 'text-gray-600 font-normal' : 'text-gray-900 font-semibold')}>
                          {n.title}
                        </p>
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0 mt-1.5" />}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-gray-300 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
