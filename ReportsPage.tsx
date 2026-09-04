import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileSpreadsheet,
  Download,
  Search,
  Layers,
  Sparkles,
  Scale,
  ArrowUpDown,
  RefreshCw,
  Loader2,
  FileText,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

export type ReportCategory = 'marketing' | 'trademark' | 'operational';

export function ReportsPage() {
  const { isSuperAdmin, isAdmin, isBrandMarketingAdmin, isTrademarkAdmin, canAccessReports } = useAuth();

  // Active Category & Report selection
  const defaultCategory: ReportCategory = isTrademarkAdmin
    ? 'trademark'
    : 'marketing';
  const [selectedCategory, setSelectedCategory] = useState<ReportCategory>(defaultCategory);
  const [selectedReportKey, setSelectedReportKey] = useState<string>('case_summary');

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isExporting, setIsExporting] = useState(false);

  // Fetch Cases list for dropdown filter
  const { data: suggestionCases = [], refetch: refetchCases } = useQuery({
    queryKey: ['reports-suggestions-cases'],
    queryFn: () => apiClient.listSuggestions().catch(() => []),
    staleTime: 60 * 1000,
  });

  // Dynamic Live Report Data from PostgreSQL Backend
  const {
    data: liveReportData = [],
    isLoading: isLoadingReport,
    refetch: refetchReportData,
    isRefetching,
  } = useQuery({
    queryKey: ['live-report-data', selectedReportKey],
    queryFn: () => apiClient.getReportData(selectedReportKey).catch(() => []),
  });

  // Available Reports Configuration matching BRD Section 5.2.9
  const reportConfigs = useMemo(() => {
    return {
      marketing: [
        {
          key: 'case_summary',
          title: 'Case Summary Report',
          description: 'Overview of brand naming cases created by the Brand Marketing Team with submission status.',
          badge: 'MARKETING',
        },
        {
          key: 'generated_names',
          title: 'Generated Brand Names Report',
          description: 'AI-generated brand names coined per case with coining strategies and batch selections.',
          badge: 'MARKETING',
        },
        {
          key: 'brand_screening',
          title: 'Brand Screening Report',
          description: 'Summary of AI screening scores, recommendation ratings (Medium / Low), and conflict checks.',
          badge: 'MARKETING',
        },
        {
          key: 'review_batch',
          title: 'Review Batch Report',
          description: 'Review batch submission details, packaging timelines, and current trademark queue status.',
          badge: 'MARKETING',
        },
        {
          key: 'user_submissions',
          title: 'User-wise Submission Report',
          description: 'Breakdown of cases created, review batches prepared, and names submitted per user.',
          badge: 'MARKETING',
        },
      ],
      trademark: [
        {
          key: 'tm_search_results',
          title: 'Trademark Search Result Report',
          description: 'Evaluated brand names with IP risk levels, conflicting marks, pharmacy presence, and dates.',
          badge: 'LEGAL',
        },
        {
          key: 'approved_brands',
          title: 'Approved Brand Names Report',
          description: 'Full list of officially approved brand marks with clearance remarks and certificate dates.',
          badge: 'LEGAL',
        },
        {
          key: 'case_aging',
          title: 'Case Aging Report',
          description: 'Review turnaround durations, days spent in current stage, and delayed review tracking.',
          badge: 'LEGAL',
        },
        {
          key: 'tm_review_summary',
          title: 'Trademark Review Summary Report',
          description: 'Aggregated trademark review performance metrics: Total reviewed, approved, rejected, and turnaround time.',
          badge: 'LEGAL',
        },
      ],
      operational: [
        {
          key: 'ai_usage',
          title: 'AI Usage Analytics Report',
          description: 'Platform-wide AI generation, screening requests, prompt/completion token usage, and feature trends.',
          badge: 'SUPER ADMIN',
        },
      ],
    };
  }, []);

  // Update selected report if category changes
  const handleCategoryChange = (cat: ReportCategory) => {
    setSelectedCategory(cat);
    const available = reportConfigs[cat];
    if (available && available.length > 0) {
      setSelectedReportKey(available[0].key);
    }
  };

  // Filtered & Sorted Rows from live database data
  const processedRows = useMemo(() => {
    let list = [...liveReportData];

    // Search filter across all row values
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((row) =>
        Object.values(row).some((val) =>
          String(val).toLowerCase().includes(q)
        )
      );
    }

    // Case filter
    if (caseFilter !== 'all') {
      list = list.filter((row) =>
        row.case_name?.toLowerCase().includes(caseFilter.toLowerCase()) ||
        row.molecule?.toLowerCase().includes(caseFilter.toLowerCase())
      );
    }

    // Date From / To filters
    if (dateFrom) {
      list = list.filter((row) => {
        const rowDate = row.created_date || row.generation_date || row.screening_date || row.submission_date || row.approval_date || row.submitted_date || row.review_date;
        return !rowDate || rowDate >= dateFrom;
      });
    }
    if (dateTo) {
      list = list.filter((row) => {
        const rowDate = row.created_date || row.generation_date || row.screening_date || row.submission_date || row.approval_date || row.submitted_date || row.review_date;
        return !rowDate || rowDate <= dateTo;
      });
    }

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((row) => {
        const val = row.overall_status || row.batch_status || row.risk_level || row.aging_status || row.tm_status;
        return val && String(val).toLowerCase().includes(statusFilter.toLowerCase());
      });
    }

    // Sorting
    if (sortField) {
      list.sort((a, b) => {
        const aVal = a[sortField] ?? '';
        const bVal = b[sortField] ?? '';
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortOrder === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }

    return list;
  }, [liveReportData, searchQuery, caseFilter, statusFilter, dateFrom, dateTo, sortField, sortOrder]);

  // Handle Sort Toggle
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Export Current Report to Excel (.xlsx)
  const handleExportExcel = () => {
    try {
      setIsExporting(true);

      const ws = XLSX.utils.json_to_sheet(processedRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report Data');

      const fileName = `BrandSentry_${selectedReportKey}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`Exported ${processedRows.length} live records to ${fileName}`);
    } catch (err) {
      toast.error('Failed to export Excel report');
    } finally {
      setIsExporting(false);
    }
  };

  // If user does not have permission to view reports per BRD Section 5.2.9
  if (!canAccessReports) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 text-center bg-white border border-gray-200 rounded-xl shadow-sm space-y-4">
        <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mx-auto">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Reports & MIS Restricted</h2>
        <p className="text-sm text-gray-500">
          Reports & MIS access is reserved for Administrators and Team Admins per Section 5.2.9 of the BrandSentry BRD.
        </p>
      </div>
    );
  }

  // Active Report Details
  const activeReport = Object.values(reportConfigs)
    .flat()
    .find((r) => r.key === selectedReportKey);

  return (
    <div className="p-6 md:p-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center flex-shrink-0 shadow-sm">
            <FileSpreadsheet className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Reports &amp; MIS</h1>
            <p className="text-sm text-gray-500">Live role-based business intelligence, pipeline audits, and Microsoft Excel exports</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchReportData();
              refetchCases();
              toast.success('Report data refreshed from PostgreSQL');
            }}
            disabled={isLoadingReport || isRefetching}
            className="text-xs h-9 gap-1.5 border-gray-300 text-gray-700 bg-white shadow-sm"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', (isLoadingReport || isRefetching) && 'animate-spin')} />
            Refresh Data
          </Button>
          <Button
            size="sm"
            onClick={handleExportExcel}
            disabled={isExporting || processedRows.length === 0}
            className="text-xs h-9 gap-1.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-sm"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export to Excel (.xlsx)
          </Button>
        </div>
      </div>

      {/* Role-Gated Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {(isSuperAdmin || isAdmin || isBrandMarketingAdmin) && (
          <button
            onClick={() => handleCategoryChange('marketing')}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2',
              selectedCategory === 'marketing'
                ? 'bg-orange-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            Brand Marketing Reports
            <span className={cn('px-1.5 py-0.5 rounded text-[10px]', selectedCategory === 'marketing' ? 'bg-orange-700 text-white' : 'bg-gray-100 text-gray-600')}>
              {reportConfigs.marketing.length}
            </span>
          </button>
        )}

        {(isSuperAdmin || isAdmin || isTrademarkAdmin) && (
          <button
            onClick={() => handleCategoryChange('trademark')}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2',
              selectedCategory === 'trademark'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            <Scale className="w-3.5 h-3.5" />
            Trademark Clearance Reports
            <span className={cn('px-1.5 py-0.5 rounded text-[10px]', selectedCategory === 'trademark' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600')}>
              {reportConfigs.trademark.length}
            </span>
          </button>
        )}

        {(isSuperAdmin || isAdmin) && (
          <button
            onClick={() => handleCategoryChange('operational')}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2',
              selectedCategory === 'operational'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI &amp; Operational Analytics
            <span className={cn('px-1.5 py-0.5 rounded text-[10px]', selectedCategory === 'operational' ? 'bg-purple-700 text-white' : 'bg-gray-100 text-gray-600')}>
              {reportConfigs.operational.length}
            </span>
          </button>
        )}
      </div>

      {/* Sub-Reports Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {reportConfigs[selectedCategory]?.map((rpt) => {
          const isSelected = selectedReportKey === rpt.key;
          return (
            <div
              key={rpt.key}
              onClick={() => setSelectedReportKey(rpt.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setSelectedReportKey(rpt.key); } }}
              role="button"
              tabIndex={0}
              className={cn(
                'p-3.5 rounded-xl border cursor-pointer transition-all duration-150 flex flex-col justify-between text-left',
                isSelected
                  ? 'bg-orange-50/70 border-orange-400 shadow-sm ring-1 ring-orange-300'
                  : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xs'
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide', isSelected ? 'bg-orange-200 text-orange-800' : 'bg-gray-100 text-gray-600')}>
                    {rpt.badge}
                  </span>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-orange-600" />}
                </div>
                <h3 className={cn('text-xs font-bold leading-snug truncate mt-1', isSelected ? 'text-orange-950' : 'text-gray-900')}>
                  {rpt.title}
                </h3>
                <p className="text-[11px] text-gray-500 line-clamp-2 mt-1 leading-relaxed">
                  {rpt.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter & Search Toolbar */}
      <Card className="border border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
            {/* Search */}
            <div className="relative flex-1 w-full max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search within this report..."
                className="pl-9 h-9 text-xs bg-gray-50/50 border-gray-200"
              />
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
              {/* Date From */}
              <div className="flex items-center gap-1.5 bg-gray-50/50 border border-gray-200 rounded-md px-2 py-1 h-9">
                <span className="text-[11px] text-gray-500 font-medium">From:</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs text-gray-800 focus:outline-none"
                />
              </div>

              {/* Date To */}
              <div className="flex items-center gap-1.5 bg-gray-50/50 border border-gray-200 rounded-md px-2 py-1 h-9">
                <span className="text-[11px] text-gray-500 font-medium">To:</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs text-gray-800 focus:outline-none"
                />
              </div>

              {/* Case Filter */}
              <Select value={caseFilter} onValueChange={setCaseFilter}>
                <SelectTrigger className="h-9 text-xs w-52 bg-gray-50/50 border-gray-200 truncate">
                  <SelectValue placeholder="All Cases" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">All Cases</SelectItem>
                  {suggestionCases.map((c: any) => {
                    const label = c.case_name || `${c.generic_name} (${c.case_id || 'Case'})`;
                    return (
                      <SelectItem key={c.case_id || c.id} value={c.generic_name || c.case_id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {/* Reset Filters */}
              {(searchQuery || caseFilter !== 'all' || statusFilter !== 'all' || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setCaseFilter('all');
                    setStatusFilter('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="text-xs text-orange-600 hover:text-orange-700 h-9 px-2"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Report Header & Data Table */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardHeader className="bg-gray-50/70 border-b border-gray-200 px-5 py-3.5 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-orange-600" />
              {activeReport?.title}
              <span className="text-xs font-normal text-gray-500 ml-2">
                ({processedRows.length} {processedRows.length === 1 ? 'record' : 'records'})
              </span>
            </CardTitle>
            <p className="text-xs text-gray-500 mt-0.5">{activeReport?.description}</p>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {isLoadingReport ? (
              <div className="py-16 text-center text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-600 mb-2" />
                <p className="text-xs text-gray-500">Querying live reporting data from PostgreSQL database…</p>
              </div>
            ) : processedRows.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30 text-gray-400" />
                <p className="text-sm font-medium text-gray-600">No records found matching your active filters</p>
                <p className="text-xs text-gray-400 mt-1">Try broadening your date range or clearing the search query</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50/90 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
                    {Object.keys(processedRows[0] || {}).map((colKey) => (
                      <th
                        key={colKey}
                        onClick={() => handleSort(colKey)}
                        className="text-left py-3 px-4 cursor-pointer hover:bg-gray-100/70 transition-colors select-none"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{colKey.replace(/_/g, ' ')}</span>
                          <ArrowUpDown className={cn('w-3 h-3', sortField === colKey ? 'text-orange-600' : 'text-gray-400')} />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {processedRows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-orange-50/40 transition-colors">
                      {Object.entries(row).map(([colKey, cellVal]: any, cIdx) => {
                        const valStr = String(cellVal ?? '—');
                        const isRiskCol = colKey.includes('risk') || colKey.includes('recommendation');
                        const isStatusCol = colKey.includes('status');

                        return (
                          <td key={cIdx} className="py-3 px-4 whitespace-nowrap">
                            {isRiskCol ? (
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-full text-[11px] font-bold border inline-block',
                                  valStr === 'LOW' || valStr.includes('Low')
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : valStr === 'MEDIUM' || valStr.includes('Medium')
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                                )}
                              >
                                {valStr}
                              </span>
                            ) : isStatusCol ? (
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-full text-[11px] font-semibold border inline-block',
                                  valStr.includes('Approved') || valStr.includes('Completed') || valStr.includes('Cleared')
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : valStr.includes('Under Review') || valStr.includes('Track')
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : valStr.includes('Needs Attention') || valStr.includes('Delayed')
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-gray-100 text-gray-700 border-gray-200'
                                )}
                              >
                                {valStr}
                              </span>
                            ) : colKey === 'brand_name' ? (
                              <span className="font-bold text-gray-900">{valStr}</span>
                            ) : colKey === 'case_name' ? (
                              <span className="font-semibold text-gray-800">{valStr}</span>
                            ) : (
                              valStr
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
