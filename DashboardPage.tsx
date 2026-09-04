import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Folder,
  Clock,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Download,
  FileText,
  Zap,
  TrendingUp,
  FileSpreadsheet,
  ChevronDown,
  Users,
  Layers,
  Scale,
  Search,
  AlertTriangle,
  Tag,
  BarChart3,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

export type DashboardViewType = 'super_admin' | 'admin' | 'trademark_admin' | 'marketing_admin';

export function DashboardPage() {
  const { isSuperAdmin, isBrandMarketingAdmin, isTrademarkAdmin, canAccessDashboard } = useAuth();

  // Determine initial dashboard view based on user's role
  const initialView: DashboardViewType = isSuperAdmin
    ? 'super_admin'
    : isTrademarkAdmin
    ? 'trademark_admin'
    : isBrandMarketingAdmin
    ? 'marketing_admin'
    : 'admin';

  const [activeView, setActiveView] = useState<DashboardViewType>(initialView);

  // Sync view if auth changes
  useEffect(() => {
    if (isSuperAdmin) setActiveView('super_admin');
    else if (isTrademarkAdmin) setActiveView('trademark_admin');
    else if (isBrandMarketingAdmin) setActiveView('marketing_admin');
    else setActiveView('admin');
  }, [isSuperAdmin, isTrademarkAdmin, isBrandMarketingAdmin]);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedUser, setSelectedUser] = useState('all');
  const [caseFilter, setCaseFilter] = useState('all');
  const [autoRefreshInterval] = useState('off');
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

  // Fetch users for filter
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: () => apiClient.getAdminUsers().catch(() => []),
    staleTime: 60 * 1000,
  });

  // Fetch live Dashboard metrics from backend
  const {
    data: liveMetrics,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['dashboard-metrics', dateFrom, dateTo, selectedUser, caseFilter],
    queryFn: () =>
      apiClient.getDashboardMetrics({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        user_id: selectedUser === 'all' ? undefined : selectedUser,
        case_name: caseFilter === 'all' ? undefined : caseFilter,
      }),
    refetchInterval:
      autoRefreshInterval === '30s'
        ? 30000
        : autoRefreshInterval === '1m'
        ? 60000
        : autoRefreshInterval === '5m'
        ? 300000
        : false,
  });

  // Calculate Sub Case Status Distribution percentages for donut
  const subCaseStats = useMemo(() => {
    const approved = liveMetrics?.sub_case_status_distribution?.approved ?? 0;
    const rejected = liveMetrics?.sub_case_status_distribution?.rejected ?? 0;
    const revision = liveMetrics?.sub_case_status_distribution?.revision_required ?? 0;
    const underReview = liveMetrics?.sub_case_status_distribution?.under_review ?? 0;
    const pending = liveMetrics?.sub_case_status_distribution?.pending ?? 0;
    const total = approved + rejected + revision + underReview + pending || 1;

    const approvedDash = Math.round((approved / total) * 238);
    const rejectedDash = Math.round((rejected / total) * 238);
    const revisionDash = 238 - approvedDash - rejectedDash;

    return {
      approved,
      rejected,
      revision,
      underReview,
      pending,
      total,
      approvedDash,
      rejectedDash,
      revisionDash,
    };
  }, [liveMetrics]);

  // Calculate Recommendation Distribution percentages for Admin Donut
  const recStats = useMemo(() => {
    const high = liveMetrics?.recommendation_distribution?.high ?? 0;
    const med = liveMetrics?.recommendation_distribution?.medium ?? 0;
    const low = liveMetrics?.recommendation_distribution?.low ?? 0;
    const total = high + med + low || 1;

    const lowDash = Math.round((low / total) * 238);
    const medDash = Math.round((med / total) * 238);
    const highDash = 238 - lowDash - medDash;

    return { high, med, low, total, lowDash, medDash, highDash };
  }, [liveMetrics]);

  // Export to PDF handler
  const handleExportPDF = async () => {
    try {
      setShowExportMenu(false);
      setIsExporting(true);
      const doc = new jsPDF();
      const timestamp = new Date().toLocaleString();

      doc.setFontSize(18);
      doc.setTextColor(234, 88, 12);
      doc.text(`BrandSentry — ${activeView.replace('_', ' ').toUpperCase()} Dashboard`, 14, 20);

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Generated: ${timestamp} | Date Range: ${dateFrom || 'All time'} to ${dateTo || 'Present'}`, 14, 28);

      doc.setDrawColor(230, 230, 230);
      doc.line(14, 32, 196, 32);

      doc.setFontSize(12);
      doc.setTextColor(30, 30, 30);
      doc.text('Summary KPIs and Metrics', 14, 44);
      doc.setFontSize(10);

      const kpis = [
        `Total Cases: ${liveMetrics?.kpi?.total_cases ?? 0}`,
        `Active Cases: ${liveMetrics?.kpi?.active_cases ?? 0}`,
        `Closed Cases: ${liveMetrics?.kpi?.closed_cases ?? 0}`,
        `AI Brand Names Generated: ${liveMetrics?.kpi?.total_generated_names ?? 0}`,
        `Approved Sub Cases: ${liveMetrics?.sub_case_status_distribution?.approved ?? 0}`,
        `Rejected Sub Cases: ${liveMetrics?.sub_case_status_distribution?.rejected ?? 0}`,
        `Total Tokens Consumed: ${liveMetrics?.token_consumption?.summary?.total_tokens ?? 0}`,
      ];

      kpis.forEach((kpi, idx) => {
        doc.text(`• ${kpi}`, 18, 54 + idx * 8);
      });

      doc.save(`BrandSentry_Dashboard_${activeView}_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('Exported dashboard summary to PDF');
    } catch (err) {
      toast.error('Failed to export PDF');
    } finally {
      setIsExporting(false);
    }
  };

  // Export to Excel handler
  const handleExportExcel = () => {
    try {
      setShowExportMenu(false);
      setIsExporting(true);

      const summaryData = [
        { Metric: 'Total Cases', Value: liveMetrics?.kpi?.total_cases ?? 0 },
        { Metric: 'Active Cases', Value: liveMetrics?.kpi?.active_cases ?? 0 },
        { Metric: 'Closed Cases', Value: liveMetrics?.kpi?.closed_cases ?? 0 },
        { Metric: 'Active Users', Value: liveMetrics?.kpi?.active_users ?? 0 },
        { Metric: 'AI Brand Names Generated', Value: liveMetrics?.kpi?.total_generated_names ?? 0 },
        { Metric: 'Active Sub Cases', Value: liveMetrics?.kpi?.active_sub_cases ?? 0 },
        { Metric: 'Approved Sub Cases', Value: liveMetrics?.sub_case_status_distribution?.approved ?? 0 },
        { Metric: 'Rejected Sub Cases', Value: liveMetrics?.sub_case_status_distribution?.rejected ?? 0 },
        { Metric: 'Revision Required', Value: liveMetrics?.sub_case_status_distribution?.revision_required ?? 0 },
        { Metric: 'Prompt Tokens', Value: liveMetrics?.token_consumption?.summary?.prompt_tokens ?? 0 },
        { Metric: 'Completion Tokens', Value: liveMetrics?.token_consumption?.summary?.completion_tokens ?? 0 },
        { Metric: 'Total Tokens', Value: liveMetrics?.token_consumption?.summary?.total_tokens ?? 0 },
      ];

      const ws = XLSX.utils.json_to_sheet(summaryData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Dashboard KPIs');

      XLSX.writeFile(wb, `BrandSentry_Dashboard_${activeView}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported dashboard metrics to Excel');
    } catch (err) {
      toast.error('Failed to export Excel');
    } finally {
      setIsExporting(false);
    }
  };

  // Role restriction check per BRD
  if (!canAccessDashboard) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 text-center bg-white border border-gray-200 rounded-xl shadow-sm space-y-4">
        <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mx-auto">
          <LayoutDashboard className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Dashboard Restricted</h2>
        <p className="text-sm text-gray-500">
          Executive Dashboards are configured for Role Administrators per the BrandSentry BRD specification.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-[1440px] mx-auto space-y-6 animate-in fade-in-0 duration-200">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center flex-shrink-0 shadow-sm">
            <LayoutDashboard className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {activeView === 'super_admin' && 'Super Admin Dashboard'}
              {activeView === 'admin' && 'Admin Dashboard'}
              {activeView === 'trademark_admin' && 'Trademark Admin Dashboard'}
              {activeView === 'marketing_admin' && 'Brand Marketing Team Dashboard'}
            </h1>
            <p className="text-sm text-gray-500">
              {activeView === 'super_admin' && 'Live enterprise-wide metrics from PostgreSQL database'}
              {activeView === 'admin' && 'Operational overview across platform cases, coining volume, and AI metrics'}
              {activeView === 'trademark_admin' && 'Trademark review queue, clearance metrics, and case aging'}
              {activeView === 'marketing_admin' && 'Brand naming recommendations, batch generation, and submissions'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="border border-gray-200/80 shadow-sm bg-white">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap items-end gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-3">
              {/* FROM DATE */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">
                  FROM DATE
                </label>
                <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 h-9 text-xs">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="bg-transparent outline-none text-gray-800"
                  />
                </div>
              </div>

              {/* TO DATE */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">
                  TO DATE
                </label>
                <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 h-9 text-xs">
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="bg-transparent outline-none text-gray-800"
                  />
                </div>
              </div>

              {/* USER Filter (Only on Super Admin & Admin) */}
              {(activeView === 'super_admin' || activeView === 'admin') && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">
                    USER
                  </label>
                  <Select value={selectedUser} onValueChange={setSelectedUser}>
                    <SelectTrigger className="h-9 text-xs w-40 bg-white border-gray-300 truncate">
                      <SelectValue placeholder="All Users" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      {users.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Reset Filters */}
              {(dateFrom || dateTo || selectedUser !== 'all' || caseFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setSelectedUser('all');
                    setCaseFilter('all');
                  }}
                  className="text-xs text-orange-600 hover:text-orange-700 h-9 px-2 self-end"
                >
                  Reset Filters
                </Button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  refetch();
                  toast.success('Live metrics refreshed from database');
                }}
                disabled={isLoading || isRefetching}
                className="h-9 text-xs text-gray-700 hover:text-orange-600 gap-1.5 bg-white border-gray-300"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', (isLoading || isRefetching) && 'animate-spin text-orange-600')} />
                Refresh Data
              </Button>

              <div className="relative" ref={exportMenuRef}>
                <Button
                  size="sm"
                  disabled={isExporting}
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="h-9 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold gap-1.5 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download <ChevronDown className="w-3 h-3 opacity-80" />
                </Button>

                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 animate-in fade-in-0 zoom-in-95">
                    <button
                      onClick={handleExportPDF}
                      className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-orange-50 hover:text-orange-900 flex items-center gap-2 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-red-500" />
                      Download as PDF
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-orange-50 hover:text-orange-900 flex items-center gap-2 transition-colors"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      Download as Excel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ========================================================================= */}
      {/* 1. SUPER ADMIN DASHBOARD */}
      {/* ========================================================================= */}
      {activeView === 'super_admin' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border border-orange-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 flex-shrink-0">
                  <Folder className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.total_cases ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Total Cases</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-blue-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.active_users ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Active Users</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-purple-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.total_generated_names ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">AI Brand Names Generated</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-emerald-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.active_sub_cases ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Active Sub Cases</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Row (3 Widgets) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-900">Sub Case Status Distribution</h3>
                    <p className="text-[11px] text-gray-400">Sub Cases by lifecycle status</p>
                  </div>
                </div>
              </div>
              <div className="p-6 flex flex-col items-center justify-center">
                <div className="relative w-44 h-44 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="38" stroke="#e5e7eb" strokeWidth="12" fill="transparent" />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#10b981"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${subCaseStats.approvedDash} 238`}
                      strokeDashoffset="0"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#ef4444"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${subCaseStats.rejectedDash} 238`}
                      strokeDashoffset={`-${subCaseStats.approvedDash}`}
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#ec4899"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${subCaseStats.revisionDash} 238`}
                      strokeDashoffset={`-${subCaseStats.approvedDash + subCaseStats.rejectedDash}`}
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-xl font-bold text-gray-900">
                      {subCaseStats.approved.toLocaleString()}
                    </span>
                    <p className="text-[10px] text-gray-500">Approved</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 text-xs mt-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-gray-600">Approved: <strong>{subCaseStats.approved.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-gray-600">Rejected: <strong>{subCaseStats.rejected.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                    <span className="text-gray-600">Revision: <strong>{subCaseStats.revision.toLocaleString()}</strong></span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">AI Request Counts</h3>
                  <p className="text-[11px] text-gray-400">Generation vs analysis requests</p>
                </div>
              </div>
              <div className="p-6 space-y-6 my-auto">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium">Brand Analysis Requests</span>
                    <strong className="text-gray-900">
                      {(liveMetrics?.ai_request_counts?.screening_requests ?? 0).toLocaleString()}
                    </strong>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-8 overflow-hidden p-1">
                    <div
                      className="bg-purple-600 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            15,
                            Math.round(
                              ((liveMetrics?.ai_request_counts?.screening_requests ?? 1) /
                                ((liveMetrics?.ai_request_counts?.screening_requests ?? 1) +
                                  (liveMetrics?.ai_request_counts?.generation_requests ?? 1))) *
                                100
                            )
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium">Brand Generation Requests</span>
                    <strong className="text-gray-900">
                      {(liveMetrics?.ai_request_counts?.generation_requests ?? 0).toLocaleString()}
                    </strong>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-8 overflow-hidden p-1">
                    <div
                      className="bg-purple-600 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            15,
                            Math.round(
                              ((liveMetrics?.ai_request_counts?.generation_requests ?? 1) /
                                ((liveMetrics?.ai_request_counts?.screening_requests ?? 1) +
                                  (liveMetrics?.ai_request_counts?.generation_requests ?? 1))) *
                                100
                            )
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Business Activity Breakdown</h3>
                  <p className="text-[11px] text-gray-400">Total volume across workflow stages</p>
                </div>
              </div>
              <div className="p-6 my-auto space-y-4">
                <div className="flex items-center justify-between p-3 bg-orange-50/50 rounded-lg border border-orange-100">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-500" />
                    <span className="text-xs font-semibold text-gray-800">Total Cases Created</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.total_cases ?? 0).toLocaleString()}
                  </strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-xs font-semibold text-gray-800">Active Pipeline Cases</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.active_cases ?? 0).toLocaleString()}
                  </strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-gray-800">Trademark Approvals</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.sub_case_status_distribution?.approved ?? 0).toLocaleString()}
                  </strong>
                </div>
              </div>
            </Card>
          </div>

          {/* AI Token Consumption */}
          <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">AI Token Consumption</h3>
                  <p className="text-[11px] text-gray-400">Live compute token breakdown by operation</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                # {(liveMetrics?.token_consumption?.summary?.total_tokens ?? 0).toLocaleString()} total tokens
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 bg-gray-50/50 border-b border-gray-100">
              <div className="p-4 bg-orange-50/60 border border-orange-100 rounded-xl">
                <p className="text-xl font-extrabold text-orange-700">
                  {(liveMetrics?.token_consumption?.summary?.prompt_tokens ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wider mt-0.5">PROMPT TOKENS</p>
              </div>
              <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                <p className="text-xl font-extrabold text-emerald-700">
                  {(liveMetrics?.token_consumption?.summary?.completion_tokens ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider mt-0.5">COMPLETION TOKENS</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-xl shadow-xs">
                <p className="text-xl font-extrabold text-gray-900">
                  {(liveMetrics?.token_consumption?.summary?.total_tokens ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mt-0.5">TOTAL TOKENS</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider text-[10px] border-b border-gray-200">
                    <th className="text-left py-3 px-5">OPERATION</th>
                    <th className="text-left py-3 px-5">REQUESTS</th>
                    <th className="text-left py-3 px-5">PROMPT TOKENS</th>
                    <th className="text-left py-3 px-5">COMPLETION TOKENS</th>
                    <th className="text-left py-3 px-5">TOTAL TOKENS</th>
                    <th className="text-left py-3 px-5">SHARE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {liveMetrics?.token_consumption?.operations?.map((op: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-3.5 px-5 font-medium flex items-center gap-2">
                        <span className={cn('w-2 h-2 rounded-full', op.color === 'purple' ? 'bg-purple-600' : 'bg-blue-600')} />
                        {op.name}
                        <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-bold">{op.badge}</span>
                      </td>
                      <td className="py-3.5 px-5">{op.requests.toLocaleString()}</td>
                      <td className="py-3.5 px-5">{op.prompt_tokens.toLocaleString()}</td>
                      <td className="py-3.5 px-5">{op.completion_tokens.toLocaleString()}</td>
                      <td className="py-3.5 px-5 font-bold text-gray-900">{op.total_tokens.toLocaleString()}</td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div className={cn('h-full rounded-full', op.color === 'purple' ? 'bg-purple-600' : 'bg-blue-600')} style={{ width: `${op.share_pct}%` }} />
                          </div>
                          <span className="font-semibold text-gray-600">{op.share_pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50/70 font-bold text-gray-900">
                    <td className="py-3 px-5">Total</td>
                    <td className="py-3 px-5">{(liveMetrics?.token_consumption?.total?.requests ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5">{(liveMetrics?.token_consumption?.total?.prompt_tokens ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5">{(liveMetrics?.token_consumption?.total?.completion_tokens ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5 text-orange-600">{(liveMetrics?.token_consumption?.total?.total_tokens ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ADMIN DASHBOARD */}
      {/* ========================================================================= */}
      {activeView === 'admin' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border border-orange-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 flex-shrink-0">
                  <Folder className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.total_cases ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Total Cases</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-blue-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.active_cases ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Active Cases</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-emerald-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.closed_cases ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Closed Cases</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-purple-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.total_generated_names ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">AI Brand Names Generated</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Row (3 Widgets) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Recommendation Distribution</h3>
                  <p className="text-[11px] text-gray-400">Low / Medium / High AI recommendations</p>
                </div>
              </div>
              <div className="p-6 flex flex-col items-center justify-center">
                <div className="relative w-44 h-44 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="38" stroke="#e5e7eb" strokeWidth="12" fill="transparent" />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#10b981"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${recStats.lowDash} 238`}
                      strokeDashoffset="0"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#f97316"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${recStats.medDash} 238`}
                      strokeDashoffset={`-${recStats.lowDash}`}
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#ef4444"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${recStats.highDash} 238`}
                      strokeDashoffset={`-${recStats.lowDash + recStats.medDash}`}
                    />
                  </svg>
                  <div className="text-center absolute">
                    <span className="text-xl font-bold text-gray-900">
                      {recStats.total.toLocaleString()}
                    </span>
                    <p className="text-[10px] text-gray-500">Total Names</p>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3 text-xs mt-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-gray-600">Low: <strong>{recStats.low.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                    <span className="text-gray-600">Med: <strong>{recStats.med.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-gray-600">High: <strong>{recStats.high.toLocaleString()}</strong></span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">AI Request Counts</h3>
                  <p className="text-[11px] text-gray-400">Generation vs analysis requests</p>
                </div>
              </div>
              <div className="p-6 space-y-6 my-auto">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium">Brand Analysis Requests</span>
                    <strong className="text-gray-900">
                      {(liveMetrics?.ai_request_counts?.screening_requests ?? 0).toLocaleString()}
                    </strong>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-8 overflow-hidden p-1">
                    <div
                      className="bg-purple-600 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            15,
                            Math.round(
                              ((liveMetrics?.ai_request_counts?.screening_requests ?? 1) /
                                ((liveMetrics?.ai_request_counts?.screening_requests ?? 1) +
                                  (liveMetrics?.ai_request_counts?.generation_requests ?? 1))) *
                                100
                            )
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium">Brand Generation Requests</span>
                    <strong className="text-gray-900">
                      {(liveMetrics?.ai_request_counts?.generation_requests ?? 0).toLocaleString()}
                    </strong>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-8 overflow-hidden p-1">
                    <div
                      className="bg-purple-600 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            15,
                            Math.round(
                              ((liveMetrics?.ai_request_counts?.generation_requests ?? 1) /
                                ((liveMetrics?.ai_request_counts?.screening_requests ?? 1) +
                                  (liveMetrics?.ai_request_counts?.generation_requests ?? 1))) *
                                100
                            )
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Operational Pipeline Status</h3>
                  <p className="text-[11px] text-gray-400">Cases and reviews overview</p>
                </div>
              </div>
              <div className="p-6 my-auto space-y-4">
                <div className="flex items-center justify-between p-3 bg-orange-50/50 rounded-lg border border-orange-100">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-500" />
                    <span className="text-xs font-semibold text-gray-800">Total Cases</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.total_cases ?? 0).toLocaleString()}
                  </strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-gray-800">Approved Marks</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.sub_case_status_distribution?.approved ?? 0).toLocaleString()}
                  </strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-xs font-semibold text-gray-800">Pending Review</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.pending_review ?? 0).toLocaleString()}
                  </strong>
                </div>
              </div>
            </Card>
          </div>

          {/* AI Token Consumption */}
          <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">AI Token Consumption</h3>
                  <p className="text-[11px] text-gray-400">Breakdown by operation type</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                # {(liveMetrics?.token_consumption?.summary?.total_tokens ?? 0).toLocaleString()} total tokens
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 bg-gray-50/50 border-b border-gray-100">
              <div className="p-4 bg-orange-50/60 border border-orange-100 rounded-xl">
                <p className="text-xl font-extrabold text-orange-700">
                  {(liveMetrics?.token_consumption?.summary?.prompt_tokens ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wider mt-0.5">PROMPT TOKENS</p>
              </div>
              <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                <p className="text-xl font-extrabold text-emerald-700">
                  {(liveMetrics?.token_consumption?.summary?.completion_tokens ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider mt-0.5">COMPLETION TOKENS</p>
              </div>
              <div className="p-4 bg-white border border-gray-200 rounded-xl shadow-xs">
                <p className="text-xl font-extrabold text-gray-900">
                  {(liveMetrics?.token_consumption?.summary?.total_tokens ?? 0).toLocaleString()}
                </p>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mt-0.5">TOTAL TOKENS</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider text-[10px] border-b border-gray-200">
                    <th className="text-left py-3 px-5">OPERATION</th>
                    <th className="text-left py-3 px-5">REQUESTS</th>
                    <th className="text-left py-3 px-5">PROMPT TOKENS</th>
                    <th className="text-left py-3 px-5">COMPLETION TOKENS</th>
                    <th className="text-left py-3 px-5">TOTAL TOKENS</th>
                    <th className="text-left py-3 px-5">SHARE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {liveMetrics?.token_consumption?.operations?.map((op: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-3.5 px-5 font-medium flex items-center gap-2">
                        <span className={cn('w-2 h-2 rounded-full', op.color === 'purple' ? 'bg-purple-600' : 'bg-blue-600')} />
                        {op.name}
                        <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-bold">{op.badge}</span>
                      </td>
                      <td className="py-3.5 px-5">{op.requests.toLocaleString()}</td>
                      <td className="py-3.5 px-5">{op.prompt_tokens.toLocaleString()}</td>
                      <td className="py-3.5 px-5">{op.completion_tokens.toLocaleString()}</td>
                      <td className="py-3.5 px-5 font-bold text-gray-900">{op.total_tokens.toLocaleString()}</td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div className={cn('h-full rounded-full', op.color === 'purple' ? 'bg-purple-600' : 'bg-blue-600')} style={{ width: `${op.share_pct}%` }} />
                          </div>
                          <span className="font-semibold text-gray-600">{op.share_pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50/70 font-bold text-gray-900">
                    <td className="py-3 px-5">Total</td>
                    <td className="py-3 px-5">{(liveMetrics?.token_consumption?.total?.requests ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5">{(liveMetrics?.token_consumption?.total?.prompt_tokens ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5">{(liveMetrics?.token_consumption?.total?.completion_tokens ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5 text-orange-600">{(liveMetrics?.token_consumption?.total?.total_tokens ?? 0).toLocaleString()}</td>
                    <td className="py-3 px-5">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. TRADEMARK ADMIN DASHBOARD (SLIDE 3 IN PPTX & BRD 5.2.8.3) */}
      {/* ========================================================================= */}
      {activeView === 'trademark_admin' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border border-emerald-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.completed_reviews ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Completed Reviews</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-blue-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.pending_review ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Pending Review</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-purple-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0">
                  <Search className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.under_review ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Under Review</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-amber-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.revision_required ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Add Info Required</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Row (3 Widgets for Trademark Admin) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Widget 1: Sub Case Status Distribution */}
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-900">Sub Case Status Distribution</h3>
                    <p className="text-[11px] text-gray-400">Trademark review pipeline by status</p>
                  </div>
                </div>
              </div>
              <div className="p-6 flex flex-col items-center justify-center">
                <div className="relative w-44 h-44 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="38" stroke="#e5e7eb" strokeWidth="12" fill="transparent" />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#10b981"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${subCaseStats.approvedDash} 238`}
                      strokeDashoffset="0"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#ef4444"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${subCaseStats.rejectedDash} 238`}
                      strokeDashoffset={`-${subCaseStats.approvedDash}`}
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#ec4899"
                      strokeWidth="12"
                      fill="transparent"
                      strokeDasharray={`${subCaseStats.revisionDash} 238`}
                      strokeDashoffset={`-${subCaseStats.approvedDash + subCaseStats.rejectedDash}`}
                    />
                  </svg>
                  <div className="text-center absolute">
                    <span className="text-xl font-bold text-gray-900">
                      {subCaseStats.approved.toLocaleString()}
                    </span>
                    <p className="text-[10px] text-gray-500">Approved</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 text-xs mt-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-gray-600">Approved: <strong>{subCaseStats.approved.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-gray-600">Rejected: <strong>{subCaseStats.rejected.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                    <span className="text-gray-600">Revision: <strong>{subCaseStats.revision.toLocaleString()}</strong></span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Widget 2: Trademark Clearance Rate */}
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Scale className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Clearance & Review Velocity</h3>
                  <p className="text-[11px] text-gray-400">Total volume reviewed and approved</p>
                </div>
              </div>
              <div className="p-6 my-auto space-y-4">
                <div className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-gray-800">Completed Reviews</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.completed_reviews ?? 0).toLocaleString()}
                  </strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-gray-800">Pending Review Queue</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.pending_review ?? 0).toLocaleString()}
                  </strong>
                </div>

                <div className="flex items-center justify-between p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold text-gray-800">Under Senior Legal Review</span>
                  </div>
                  <strong className="text-sm font-bold text-gray-900">
                    {(liveMetrics?.kpi?.under_review ?? 0).toLocaleString()}
                  </strong>
                </div>
              </div>
            </Card>

            {/* Widget 3: Case Aging Summary */}
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Case Aging & Queue Health</h3>
                  <p className="text-[11px] text-gray-400">Review request turnaround tracking</p>
                </div>
              </div>
              <div className="p-6 my-auto space-y-4">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">Average Turnaround Time</span>
                  <strong className="text-xs font-bold text-gray-900">
                    {liveMetrics?.kpi?.avg_turnaround_days ?? 2.5} Days
                  </strong>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center justify-between">
                  <span className="text-xs font-medium text-emerald-800">On Track (&lt; 10 days)</span>
                  <strong className="text-xs font-bold text-emerald-900">
                    {(liveMetrics?.kpi?.on_track_reviews ?? liveMetrics?.kpi?.pending_review ?? 0).toLocaleString()}
                  </strong>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between">
                  <span className="text-xs font-medium text-amber-800">Needs Attention / Delayed</span>
                  <strong className="text-xs font-bold text-amber-900">
                    {(liveMetrics?.kpi?.delayed_reviews ?? 0).toLocaleString()}
                  </strong>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. BRAND MARKETING TEAM DASHBOARD (SLIDE 4 IN PPTX & BRD 5.2.8.4) */}
      {/* ========================================================================= */}
      {activeView === 'marketing_admin' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border border-amber-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.recommendation_distribution?.medium ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Medium Recommendations</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-emerald-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.recommendation_distribution?.low ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Low Recommendations</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-purple-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.total_generated_names ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">AI Brand Names Generated</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-orange-100 bg-white shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 flex-shrink-0">
                  <Tag className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    {(liveMetrics?.kpi?.submitted_for_tm_review ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Submitted for Trademark Review</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Row (3 Widgets for Brand Marketing Admin) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Widget 1: AI Processing Trend */}
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">AI Processing Volume</h3>
                  <p className="text-[11px] text-gray-400">Generation vs brand analysis requests</p>
                </div>
              </div>
              <div className="p-6 space-y-4 my-auto">
                {(() => {
                  const genReq = liveMetrics?.ai_request_counts?.generation_requests ?? 0;
                  const scrReq = liveMetrics?.ai_request_counts?.screening_requests ?? 0;
                  const total = genReq + scrReq;
                  const genW = total > 0 ? Math.round((genReq / total) * 100) : 55;
                  const scrW = total > 0 ? 100 - genW : 45;
                  return (
                    <>
                      <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-800">AI Name Generation</span>
                          <strong className="text-sm font-bold text-gray-900">
                            {genReq.toLocaleString()}
                          </strong>
                        </div>
                        <div className="w-full bg-purple-200/60 rounded-full h-2 overflow-hidden">
                          <div className="bg-purple-600 h-full rounded-full transition-all duration-500" style={{ width: `${genW}%` }} />
                        </div>
                      </div>

                      <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-800">Brand Analysis Screening</span>
                          <strong className="text-sm font-bold text-gray-900">
                            {scrReq.toLocaleString()}
                          </strong>
                        </div>
                        <div className="w-full bg-blue-200/60 rounded-full h-2 overflow-hidden">
                          <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${scrW}%` }} />
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </Card>

            {/* Widget 2: Recommendation Quality Distribution */}
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Recommendation Quality</h3>
                  <p className="text-[11px] text-gray-400">Categorization of assessed candidate names</p>
                </div>
              </div>
              <div className="p-6 my-auto space-y-3">
                <div className="flex items-center justify-between p-2.5 bg-emerald-50 rounded-lg border border-emerald-100">
                  <span className="text-xs font-semibold text-emerald-800">Low Risk Recommendations</span>
                  <strong className="text-xs font-bold text-emerald-900">
                    {(liveMetrics?.recommendation_distribution?.low ?? 0).toLocaleString()}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                  <span className="text-xs font-semibold text-amber-800">Medium Risk Recommendations</span>
                  <strong className="text-xs font-bold text-amber-900">
                    {(liveMetrics?.recommendation_distribution?.medium ?? 0).toLocaleString()}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-2.5 bg-red-50 rounded-lg border border-red-100">
                  <span className="text-xs font-semibold text-red-800">High Risk (Excluded)</span>
                  <strong className="text-xs font-bold text-red-900">
                    {(liveMetrics?.recommendation_distribution?.high ?? 0).toLocaleString()}
                  </strong>
                </div>
              </div>
            </Card>

            {/* Widget 3: Trademark Review Lifecycle */}
            <Card className="border border-gray-200/80 bg-white shadow-sm flex flex-col justify-between">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Submission Lifecycle</h3>
                  <p className="text-[11px] text-gray-400">Post-submission trademark clearance status</p>
                </div>
              </div>
              <div className="p-6 my-auto space-y-3">
                <div className="flex items-center justify-between p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                  <span className="text-xs font-medium text-blue-800">Under Legal Evaluation</span>
                  <strong className="text-xs font-bold text-blue-900">
                    {(liveMetrics?.kpi?.active_sub_cases ?? 0).toLocaleString()}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-2.5 bg-emerald-50 rounded-lg border border-emerald-100">
                  <span className="text-xs font-medium text-emerald-800">Approved for Adoption</span>
                  <strong className="text-xs font-bold text-emerald-900">
                    {(liveMetrics?.sub_case_status_distribution?.approved ?? 0).toLocaleString()}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-xs font-medium text-gray-700">Total Submissions</span>
                  <strong className="text-xs font-bold text-gray-900">
                    {(liveMetrics?.kpi?.submitted_for_tm_review ?? 0).toLocaleString()}
                  </strong>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
