import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ClipboardList,
  Search,
  Download,
  FileSpreadsheet,
  FileText,
  ScanSearch,
  Sparkles,
  Lock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  Code2,
  ChevronDown,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { AuditLog } from '@/types';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

const ACTION_CONFIG: Record<
  string,
  { label: string; icon: string; color: string; border: string }
> = {
  BRAND_SCREENING: {
    label: 'Brand Screening',
    icon: '🔍',
    color: 'bg-orange-50 text-orange-800',
    border: 'border-orange-200',
  },
  GENERATE_BRAND_NAMES: {
    label: 'Generate Brand Names',
    icon: '✨',
    color: 'bg-purple-50 text-purple-800',
    border: 'border-purple-200',
  },
  LOGIN: {
    label: 'Login',
    icon: '🔐',
    color: 'bg-emerald-50 text-emerald-800',
    border: 'border-emerald-200',
  },
  LOGIN_FAILED: {
    label: 'Login Failed',
    icon: '⚠️',
    color: 'bg-red-50 text-red-800',
    border: 'border-red-200',
  },
  LOGOUT: {
    label: 'Logout',
    icon: '👋',
    color: 'bg-amber-50 text-amber-800',
    border: 'border-amber-200',
  },
  EXPORT: {
    label: 'Export',
    icon: '📥',
    color: 'bg-rose-50 text-rose-800',
    border: 'border-rose-200',
  },
  TRADEMARK_REVIEW: {
    label: 'Trademark Review',
    icon: '⚖️',
    color: 'bg-indigo-50 text-indigo-800',
    border: 'border-indigo-200',
  },
  SETTINGS_UPDATE: {
    label: 'Settings Update',
    icon: '⚙️',
    color: 'bg-blue-50 text-blue-800',
    border: 'border-blue-200',
  },
  USER_CREATED: {
    label: 'User Created',
    icon: '👤',
    color: 'bg-teal-50 text-teal-800',
    border: 'border-teal-200',
  },
  USER_UPDATED: {
    label: 'User Updated',
    icon: '✏️',
    color: 'bg-teal-50 text-teal-800',
    border: 'border-teal-200',
  },
  USER_DEACTIVATED: {
    label: 'User Deactivated',
    icon: '🚫',
    color: 'bg-amber-50 text-amber-800',
    border: 'border-amber-200',
  },
  USER_DELETED: {
    label: 'User Deleted',
    icon: '🗑️',
    color: 'bg-red-50 text-red-800',
    border: 'border-red-200',
  },
  PROFILE_UPDATE: {
    label: 'Profile Update',
    icon: '📝',
    color: 'bg-cyan-50 text-cyan-800',
    border: 'border-cyan-200',
  },
  PASSWORD_CHANGE: {
    label: 'Password Change',
    icon: '🔑',
    color: 'bg-lime-50 text-lime-800',
    border: 'border-lime-200',
  },
};

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return isoString;
  }
}

export function AuditTrailPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchFilter, setSearchFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch users for the dropdown filter
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users-audit'],
    queryFn: () => apiClient.getAdminUsers().catch(() => []),
    staleTime: 60 * 1000,
  });

  // Fetch audit stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['audit-stats'],
    queryFn: () => apiClient.getAuditStats(),
    staleTime: 30 * 1000,
  });

  // Fetch audit logs with query params
  const {
    data: logsData,
    isLoading: logsLoading,
  } = useQuery({
    queryKey: ['audit-logs', page, pageSize, actionFilter, userFilter, searchFilter],
    queryFn: () =>
      apiClient.getAuditLogs({
        page,
        page_size: pageSize,
        action: actionFilter === 'all' ? undefined : actionFilter,
        user_id: userFilter === 'all' ? undefined : userFilter,
        search: searchFilter || undefined,
      }),
  });

  const totalRecords = logsData?.total || 0;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const items = logsData?.items || [];

  const startEntry = (page - 1) * pageSize + (items.length > 0 ? 1 : 0);
  const endEntry = Math.min(page * pageSize, totalRecords);

  // Export handlers
  const handleExportCSV = async () => {
    try {
      setShowExportMenu(false);
      setIsExporting(true);
      const fullLogs = await apiClient.getAuditLogs({ page: 1, page_size: 100 });
      const exportRows = (fullLogs?.items || []).map((l) => ({
        ID: l.id,
        Timestamp: formatTimestamp(l.created_at),
        Action: l.action,
        User: l.user_name || l.user_email || 'System',
        Email: l.user_email || '—',
        Details: l.details || '—',
        IP_Address: l.ip_address || '—',
        Status: l.status,
      }));

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BrandSentry_AuditTrail_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      await apiClient.logExport('Audit Trail', 'excel');
      toast.success('Audit trail exported as CSV');
    } catch {
      toast.error('Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setShowExportMenu(false);
      setIsExporting(true);
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.setTextColor(234, 88, 12);
      doc.text('BrandSentry — Audit Trail Activity Log', 14, 20);

      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(`Generated: ${new Date().toLocaleString()} | 21 CFR Part 11 Electronic Records`, 14, 26);

      doc.setDrawColor(220, 220, 220);
      doc.line(14, 29, 196, 29);

      let y = 38;
      doc.setFontSize(9);
      doc.setTextColor(50, 50, 50);

      items.slice(0, 20).forEach((l, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        const time = formatTimestamp(l.created_at);
        const user = l.user_email || l.user_name || 'System';
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. [${l.action}] ${time} — ${user}`, 14, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`   Details: ${l.details || '—'} (IP: ${l.ip_address || '—'})`, 14, y + 5);
        y += 12;
      });

      doc.save(`BrandSentry_AuditTrail_${new Date().toISOString().slice(0, 10)}.pdf`);
      await apiClient.logExport('Audit Trail', 'pdf');
      toast.success('Audit trail exported as PDF');
    } catch {
      toast.error('Failed to export PDF');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      {/* Header with Title and Export Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center flex-shrink-0 shadow-sm">
            <ClipboardList className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Audit Trail</h1>
            <p className="text-sm text-gray-500">Complete activity history across all users and actions</p>
          </div>
        </div>

        {/* Export Dropdown */}
        <div className="relative" ref={exportMenuRef}>
          <Button
            variant="outline"
            size="sm"
            disabled={isExporting}
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="h-9 px-4 text-xs font-semibold text-gray-700 hover:text-orange-600 border-gray-300 gap-1.5 shadow-sm self-start sm:self-auto"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export CSV / PDF <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
          </Button>

          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 animate-in fade-in-0 zoom-in-95">
              <button
                onClick={handleExportCSV}
                className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-orange-50 hover:text-orange-900 flex items-center gap-2 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Export as CSV
              </button>
              <button
                onClick={handleExportPDF}
                className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-orange-50 hover:text-orange-900 flex items-center gap-2 transition-colors"
              >
                <FileText className="w-4 h-4 text-rose-500" />
                Export as PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4 KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Actions */}
        <Card className="border border-gray-200/80 bg-white shadow-sm hover:border-orange-200 transition-colors">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-semibold mb-1">Total Actions</p>
              <p className="text-3xl font-bold text-gray-900 tracking-tight">
                {statsLoading ? '...' : (stats?.total || 0).toLocaleString()}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
              <ClipboardList className="w-5 h-5 text-gray-600" />
            </div>
          </CardContent>
        </Card>

        {/* Screenings */}
        <Card className="border border-orange-100 bg-white shadow-sm hover:border-orange-300 transition-colors">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-semibold mb-1">Screenings</p>
              <p className="text-3xl font-bold text-orange-600 tracking-tight">
                {statsLoading ? '...' : (stats?.screenings || 0).toLocaleString()}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center flex-shrink-0">
              <ScanSearch className="w-5 h-5 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        {/* Generations */}
        <Card className="border border-purple-100 bg-white shadow-sm hover:border-purple-300 transition-colors">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-semibold mb-1">Generations</p>
              <p className="text-3xl font-bold text-purple-600 tracking-tight">
                {statsLoading ? '...' : (stats?.generations || 0).toLocaleString()}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        {/* Logins */}
        <Card className="border border-emerald-100 bg-white shadow-sm hover:border-emerald-300 transition-colors">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-semibold mb-1">Logins</p>
              <p className="text-3xl font-bold text-emerald-600 tracking-tight">
                {statsLoading ? '...' : (stats?.logins || 0).toLocaleString()}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
              <Lock className="w-5 h-5 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full max-w-lg">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={searchFilter}
            onChange={(e) => {
              setSearchFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Search by user, action, or brand name..."
            className="pl-9 h-9 text-xs bg-white border-gray-200"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Action Filter */}
          <Select
            value={actionFilter}
            onValueChange={(v) => {
              setActionFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-xs w-48 bg-white border-gray-200">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="BRAND_SCREENING">Brand Screening</SelectItem>
              <SelectItem value="GENERATE_BRAND_NAMES">Generate Brand Names</SelectItem>
              <SelectItem value="LOGIN">Login / Logout</SelectItem>
              <SelectItem value="EXPORT">Export</SelectItem>
              <SelectItem value="TRADEMARK_REVIEW">Trademark Review</SelectItem>
              <SelectItem value="SETTINGS_UPDATE">Settings Update</SelectItem>
              <SelectItem value="USER_CREATED">User Management</SelectItem>
            </SelectContent>
          </Select>

          {/* User Filter */}
          <Select
            value={userFilter}
            onValueChange={(v) => {
              setUserFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-xs w-44 bg-white border-gray-200">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Audit Log Table */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
                  <th className="text-left py-3.5 px-5">ACTION</th>
                  <th className="text-left py-3.5 px-5">USER</th>
                  <th className="text-left py-3.5 px-5">DETAILS</th>
                  <th className="text-left py-3.5 px-5">TIMESTAMP</th>
                  <th className="text-left py-3.5 px-5">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {logsLoading ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-400">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-600 mb-2" />
                      Loading audit trail records...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-400">
                      <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30 text-gray-400" />
                      No audit records found
                    </td>
                  </tr>
                ) : (
                  items.map((log) => {
                    const cfg =
                      ACTION_CONFIG[log.action] || {
                        label: log.action.replace(/_/g, ' '),
                        icon: '📋',
                        color: 'bg-gray-100 text-gray-700',
                        border: 'border-gray-200',
                      };

                    const userEmail = log.user_email || 'system@brandsentry.local';
                    const initial = (log.user_name || userEmail).charAt(0).toUpperCase();

                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className="hover:bg-orange-50/40 cursor-pointer transition-colors"
                      >
                        {/* ACTION */}
                        <td className="py-3.5 px-5 whitespace-nowrap">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border',
                              cfg.color,
                              cfg.border
                            )}
                          >
                            <span>{cfg.icon}</span>
                            {cfg.label}
                          </span>
                        </td>

                        {/* USER */}
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {initial}
                            </div>
                            <span className="text-gray-600 font-medium truncate max-w-xs block">
                              {userEmail}
                            </span>
                          </div>
                        </td>

                        {/* DETAILS */}
                        <td className="py-3.5 px-5 text-gray-700 max-w-md font-medium">
                          <p className="truncate">{log.details || '—'}</p>
                        </td>

                        {/* TIMESTAMP */}
                        <td className="py-3.5 px-5 text-gray-500 font-medium whitespace-nowrap">
                          {formatTimestamp(log.created_at)}
                        </td>

                        {/* IP */}
                        <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px] whitespace-nowrap">
                          {log.ip_address || '127.0.0.1'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="p-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
            <p>
              Showing {startEntry}–{endEntry} of {totalRecords} entries
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-8 px-2.5 text-xs text-gray-600 gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                const pNum = idx + 1;
                const isCurrent = page === pNum;
                return (
                  <Button
                    key={pNum}
                    variant={isCurrent ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(pNum)}
                    className={cn(
                      'h-8 w-8 text-xs font-semibold',
                      isCurrent
                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                        : 'text-gray-600'
                    )}
                  >
                    {pNum}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-8 px-2.5 text-xs text-gray-600 gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 21 CFR Part 11 Audit Record Detail Modal */}
      <Dialog open={!!selectedLog} onOpenChange={(v) => { if (!v) setSelectedLog(null); }}>
        <DialogContent className="max-w-lg p-6 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Shield className="w-5 h-5 text-orange-600" />
              21 CFR Part 11 Audit Record
            </DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Record ID</span>
                  <span className="font-mono text-gray-800 text-[11px] break-all">{selectedLog.id}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Timestamp</span>
                  <span className="text-gray-800 font-semibold">{formatTimestamp(selectedLog.created_at)}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">User Email</span>
                  <span className="text-gray-800 font-medium">{selectedLog.user_email || 'System'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">IP Address</span>
                  <span className="font-mono text-gray-800">{selectedLog.ip_address || '127.0.0.1'}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Action & Details</span>
                <p className="p-3 bg-orange-50/50 border border-orange-100 rounded-lg text-gray-800 font-medium">
                  {selectedLog.details || selectedLog.action}
                </p>
              </div>

              {selectedLog.log_metadata && Object.keys(selectedLog.log_metadata).length > 0 && (
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1 flex items-center gap-1">
                    <Code2 className="w-3.5 h-3.5" /> Structured Metadata
                  </span>
                  <pre className="p-3 bg-gray-900 text-emerald-400 rounded-lg text-[11px] font-mono overflow-x-auto max-h-48">
                    {JSON.stringify(selectedLog.log_metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
