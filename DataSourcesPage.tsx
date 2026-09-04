import React, { useRef, useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Database,
  FlaskConical,
  Globe,
  ShoppingCart,
  Upload,
  Loader2,
  CheckCircle,
  ShieldAlert,
  Wifi,
  WifiOff,
  Landmark,
  Building2,
  Clock,
  History,
  ArrowLeft,
  Plus,
  Edit2,
  Copy,
  Trash2,
  Search,
  Download,
  FileSpreadsheet,
  ArrowUpDown,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/api/client';
import { listCases } from '@/lib/caseStore';
import type { DataSourceStatus } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn, formatDate } from '@/lib/utils';

const SOURCE_ICONS: Record<string, React.ElementType> = {
  who_inn: FlaskConical,
  iqvia: Database,
  epharmacy: ShoppingCart,
  google_search: Globe,
};

type MasterDataType = 'who_inn' | 'international_market' | 'registered_not_in_use' | null;

// ===========================================================================
// Screening Data Source Row
// ===========================================================================

function DataSourceRow({
  source,
  canToggle,
}: {
  source: DataSourceStatus;
  canToggle: boolean;
}) {
  const qc = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);
  const Icon = SOURCE_ICONS[source.id] ?? Database;

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => apiClient.setDataSourceEnabled(source.id, enabled),
    onSuccess: (updated) => {
      toast.success(`${updated.name} ${updated.enabled ? 'connected' : 'disconnected'}.`);
      qc.invalidateQueries({ queryKey: ['data-sources'] });
    },
    onError: () => toast.error('Could not update this data source. Please try again.'),
  });

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-4 p-4 rounded-xl border transition-colors',
          source.enabled ? 'border-gray-100 bg-white shadow-xs' : 'border-gray-200 bg-gray-50/50'
        )}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            source.enabled ? 'bg-orange-100' : 'bg-gray-100'
          )}
        >
          <Icon className={cn('w-5 h-5', source.enabled ? 'text-orange-600' : 'text-gray-400')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate">{source.name}</p>
          <p className="text-xs text-gray-500 truncate">{source.description}</p>
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0',
            source.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', source.connected ? 'bg-green-500' : 'bg-gray-400')} />
          {source.connected ? 'Connected' : 'Not Connected'}
        </span>
        <Button size="sm" variant="outline" className="flex-shrink-0 text-xs h-8" onClick={() => setShowDetails(true)}>
          View Details
        </Button>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-orange-600" /> {source.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">{source.description}</p>
          <p className="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            {source.detail}
          </p>
          {canToggle && (
            <Button
              variant="outline"
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(!source.enabled)}
              className={cn(
                'w-full flex items-center gap-1.5',
                source.enabled
                  ? 'text-gray-500 border-gray-200 hover:border-red-200 hover:text-red-500'
                  : 'text-orange-700 border-orange-200 hover:bg-orange-50'
              )}
            >
              {toggleMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : source.enabled ? (
                <WifiOff className="w-3.5 h-3.5" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              {source.enabled ? 'Disconnect' : 'Connect'}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function HistoricalCaseRow() {
  const [showDetails, setShowDetails] = useState(false);
  const connected = listCases().length > 0;

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-4 p-4 rounded-xl border transition-colors',
          connected ? 'border-gray-100 bg-white shadow-xs' : 'border-gray-200 bg-gray-50/50'
        )}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            connected ? 'bg-orange-100' : 'bg-gray-100'
          )}
        >
          <History className={cn('w-5 h-5', connected ? 'text-orange-600' : 'text-gray-400')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate">Historical Case Repository</p>
          <p className="text-xs text-gray-500 truncate">
            Identify previously generated, approved, rejected, or analysed brand names.
          </p>
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0',
            connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-gray-400')} />
          {connected ? 'Connected' : 'Not Connected'}
        </span>
        <Button size="sm" variant="outline" className="flex-shrink-0 text-xs h-8" onClick={() => setShowDetails(true)}>
          View Details
        </Button>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-orange-600" /> Historical Case Repository
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">
            Identify previously generated, approved, rejected, or analysed brand names.
          </p>
          <p className="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            {connected
              ? `${listCases().length} saved case(s) available in this session.`
              : 'No cases saved yet in this session. Create a case from AI Name Generator or Brand Analysis to populate this source.'}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Upload Card (Block Level with File Input, Upload & Replace, and Manage Link)
// ===========================================================================

function UploadCard({
  icon: Icon,
  title,
  subtitle,
  count,
  accept,
  disabled,
  disabledNote,
  onUpload,
  onManage,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  count: number;
  accept: string;
  disabled?: boolean;
  disabledNote?: string;
  onUpload?: (file: File) => Promise<{ rows_imported: number; message: string }>;
  onManage?: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => onUpload!(file),
    onSuccess: (data) => {
      toast.success(data.message);
      setResult(data.message);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['reference-data-status'] });
      qc.invalidateQueries({ queryKey: ['data-sources'] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Upload failed. Please check the file matches the expected template.');
    },
  });

  return (
    <Card className={cn(disabled && 'opacity-60', 'border border-gray-200/80 bg-white shadow-xs flex flex-col justify-between')}>
      <CardContent className="p-5 flex flex-col justify-between h-full space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 text-orange-600" />
            </div>
            {onManage && (
              <button
                type="button"
                onClick={onManage}
                className="text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline flex items-center gap-0.5"
              >
                Manage &rarr;
              </button>
            )}
          </div>

          <p className="font-semibold text-gray-900 text-sm truncate">{title}</p>
          <p className="text-xs text-gray-400 truncate">{count.toLocaleString()} entries loaded</p>
        </div>

        {disabled ? (
          <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mt-auto">
            {disabledNote}
          </p>
        ) : (
          <div className="mt-auto space-y-2 pt-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:bg-orange-50 file:text-orange-700 file:text-xs file:font-semibold hover:file:bg-orange-100 cursor-pointer"
            />
            <Button
              size="sm"
              disabled={!selectedFile || uploadMutation.isPending}
              onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
              className="w-full flex items-center justify-center gap-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold h-8 shadow-xs"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" /> Upload &amp; Replace
                </>
              )}
            </Button>
            {result && (
              <div className="flex items-start gap-1 text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-md p-1.5">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="truncate">{result}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Full Master Data List View (All features cleanly placed inside)
// ===========================================================================

function MasterDataListView({
  type,
  onBack,
}: {
  type: 'who_inn' | 'international_market' | 'registered_not_in_use';
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('brand_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [isBulkUploading, setIsBulkUploading] = useState(false);

  // Form fields
  const [brandName, setBrandName] = useState('');
  const [activeIngredient, setActiveIngredient] = useState('');
  const [country, setCountry] = useState('');
  const [tmClass, setTmClass] = useState('5');
  const [appNumber, setAppNumber] = useState('');
  const [appDate, setAppDate] = useState('');
  const [statusVal, setStatusVal] = useState('Registered');
  const [validTill, setValidTill] = useState('');
  const [remarks, setRemarks] = useState('');
  const [whoRef, setWhoRef] = useState('');

  // Fetch WHO INN records
  const whoQuery = useQuery({
    queryKey: ['master-data-who-inn', searchQuery],
    queryFn: () => apiClient.getWhoInnRecords(searchQuery || undefined),
    enabled: type === 'who_inn',
  });

  // Fetch International Market records
  const intlQuery = useQuery({
    queryKey: ['master-data-international-market', searchQuery],
    queryFn: () => apiClient.getInternationalMarketRecords(searchQuery || undefined),
    enabled: type === 'international_market',
  });

  // Fetch Registered Not in Use records
  const regQuery = useQuery({
    queryKey: ['master-data-registered-not-in-use', searchQuery],
    queryFn: () => apiClient.getRegisteredNotInUseRecords(searchQuery || undefined),
    enabled: type === 'registered_not_in_use',
  });

  const isLoading =
    type === 'who_inn'
      ? whoQuery.isLoading
      : type === 'international_market'
      ? intlQuery.isLoading
      : regQuery.isLoading;

  const records =
    (type === 'who_inn'
      ? whoQuery.data
      : type === 'international_market'
      ? intlQuery.data
      : regQuery.data) || [];

  // Sort records
  const sortedRecords = useMemo(() => {
    const list = [...records];
    list.sort((a: any, b: any) => {
      const aVal = (type === 'who_inn' ? a.inn_name : a.brand_name) ?? '';
      const bVal = (type === 'who_inn' ? b.inn_name : b.brand_name) ?? '';
      return sortOrder === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return list;
  }, [records, type, sortOrder]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const openCreateModal = () => {
    setEditingRecord(null);
    setBrandName('');
    setActiveIngredient('');
    setCountry('');
    setTmClass('5');
    setAppNumber('');
    setAppDate('');
    setStatusVal('Registered');
    setValidTill('');
    setRemarks('');
    setWhoRef('');
    setIsFormOpen(true);
  };

  const openEditModal = (rec: any) => {
    setEditingRecord(rec);
    setBrandName(rec.inn_name || rec.brand_name || '');
    setActiveIngredient(rec.active_ingredient || '');
    setCountry(rec.country || '');
    setTmClass(rec.trademark_class ? String(rec.trademark_class) : '5');
    setAppNumber(rec.application_number || '');
    setAppDate(rec.application_date ? rec.application_date.slice(0, 10) : '');
    setStatusVal(rec.status || 'Registered');
    setValidTill(rec.valid_till ? rec.valid_till.slice(0, 10) : '');
    setRemarks(rec.remarks || '');
    setWhoRef(rec.who_publication_reference || '');
    setIsFormOpen(true);
  };

  const openCopyModal = (rec: any) => {
    setEditingRecord(null);
    setBrandName(`${rec.inn_name || rec.brand_name || ''} (Copy)`);
    setActiveIngredient(rec.active_ingredient || '');
    setCountry(rec.country || '');
    setTmClass(rec.trademark_class ? String(rec.trademark_class) : '5');
    setAppNumber(rec.application_number || '');
    setAppDate(rec.application_date ? rec.application_date.slice(0, 10) : '');
    setStatusVal(rec.status || 'Registered');
    setValidTill(rec.valid_till ? rec.valid_till.slice(0, 10) : '');
    setRemarks(rec.remarks || '');
    setWhoRef(rec.who_publication_reference || '');
    setIsFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (type === 'who_inn') {
        const payload = {
          inn_name: brandName,
          who_publication_reference: whoRef || undefined,
        };
        if (editingRecord) {
          return apiClient.updateWhoInnRecord(editingRecord.id, payload);
        } else {
          return apiClient.createWhoInnRecord(payload);
        }
      } else if (type === 'international_market') {
        const payload = {
          brand_name: brandName,
          active_ingredient: activeIngredient || undefined,
          country: country || undefined,
        };
        if (editingRecord) {
          return apiClient.updateInternationalMarketRecord(editingRecord.id, payload);
        } else {
          return apiClient.createInternationalMarketRecord(payload);
        }
      } else {
        const payload = {
          brand_name: brandName,
          trademark_class: tmClass ? parseInt(tmClass, 10) : undefined,
          application_number: appNumber || undefined,
          application_date: appDate ? new Date(appDate).toISOString() : undefined,
          status: statusVal || undefined,
          valid_till: validTill ? new Date(validTill).toISOString() : undefined,
          remarks: remarks || undefined,
        };
        if (editingRecord) {
          return apiClient.updateRegisteredNotInUseRecord(editingRecord.id, payload);
        } else {
          return apiClient.createRegisteredNotInUseRecord(payload);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [
          type === 'who_inn'
            ? 'master-data-who-inn'
            : type === 'international_market'
            ? 'master-data-international-market'
            : 'master-data-registered-not-in-use',
        ],
      });
      qc.invalidateQueries({ queryKey: ['reference-data-status'] });
      toast.success(editingRecord ? 'Record updated in database' : 'New record created in database');
      setIsFormOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to save record.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (type === 'who_inn') {
        return apiClient.deleteWhoInnRecord(id);
      } else if (type === 'international_market') {
        return apiClient.deleteInternationalMarketRecord(id);
      } else {
        return apiClient.deleteRegisteredNotInUseRecord(id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [
          type === 'who_inn'
            ? 'master-data-who-inn'
            : type === 'international_market'
            ? 'master-data-international-market'
            : 'master-data-registered-not-in-use',
        ],
      });
      qc.invalidateQueries({ queryKey: ['reference-data-status'] });
      toast.success('Record deleted from master data');
      setDeleteTarget(null);
    },
    onError: () => toast.error('Failed to delete record.'),
  });

  const handleBulkUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsBulkUploading(true);
      if (type === 'who_inn') {
        const res = await apiClient.uploadWhoInnPdf(file);
        toast.success(res.message);
      } else if (type === 'international_market') {
        const res = await apiClient.uploadInternationalMarket(file);
        toast.success(res.message);
      } else {
        const res = await apiClient.uploadRegisteredNotInUse(file);
        toast.success(res.message);
      }
      qc.invalidateQueries({
        queryKey: [
          type === 'who_inn'
            ? 'master-data-who-inn'
            : type === 'international_market'
            ? 'master-data-international-market'
            : 'master-data-registered-not-in-use',
        ],
      });
      qc.invalidateQueries({ queryKey: ['reference-data-status'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Bulk upload failed.');
    } finally {
      setIsBulkUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const title =
    type === 'who_inn'
      ? 'WHO INN Registry Master Data'
      : type === 'international_market'
      ? 'International Markets Master Data'
      : 'Registered but Not in Use Master Data';

  const subtitle =
    type === 'who_inn'
      ? 'Exact template: Sr No. | INN Name | W.H.O Publication Reference'
      : type === 'international_market'
      ? 'Exact template: Sr No. | Mark | Molecule'
      : 'Exact template: Sl No | TradeMark Name | Class | Appl No | Appl Date | TMR STATUS | Valid till | Description';

  return (
    <div className="space-y-6 animate-in fade-in-0 duration-200">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="h-9 px-3 gap-1.5 border-gray-300 text-gray-700 bg-white shadow-xs hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Data Sources
          </Button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>

        {/* Action Toolbar Inside Master Details View */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Download Empty Template */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (type === 'who_inn') apiClient.downloadWhoInnTemplate();
              else if (type === 'international_market') apiClient.downloadInternationalMarketTemplate();
              else apiClient.downloadRegisteredNotInUseTemplate();
              toast.success('Downloading empty template matching official format...');
            }}
            className="text-xs h-9 gap-1.5 border-gray-300 text-gray-700 bg-white shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Download Empty Template
          </Button>

          {/* Download Current Master Data */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (type === 'who_inn') apiClient.exportWhoInnMasterData();
              else if (type === 'international_market') apiClient.exportInternationalMarketMasterData();
              else apiClient.exportRegisteredNotInUseMasterData();
              toast.success('Exporting current master data...');
            }}
            className="text-xs h-9 gap-1.5 border-gray-300 text-gray-700 bg-white shadow-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" />
            Download Current Master Data
          </Button>

          {/* Bulk Upload */}
          <div className="relative">
            <input
              type="file"
              ref={fileInputRef}
              accept={type === 'who_inn' ? '.pdf,.xlsx' : '.xlsx'}
              onChange={handleBulkUploadFile}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isBulkUploading}
              onClick={() => fileInputRef.current?.click()}
              className="text-xs h-9 gap-1.5 border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 shadow-xs font-semibold"
            >
              {isBulkUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Bulk Upload {type === 'who_inn' ? '(.pdf / .xlsx)' : '(.xlsx)'}
            </Button>
          </div>

          {/* Add Single Record */}
          <Button
            size="sm"
            onClick={openCreateModal}
            className="text-xs h-9 gap-1.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Single Record
          </Button>
        </div>
      </div>

      {/* Search Toolbar */}
      <Card className="border border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search master data records..."
              className="pl-9 h-9 text-xs bg-gray-50/50 border-gray-200"
            />
          </div>
          <span className="text-xs font-medium text-gray-500">
            Total <strong>{sortedRecords.length}</strong> master records
          </span>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="py-16 text-center text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-600 mb-2" />
                Loading master records...
              </div>
            ) : sortedRecords.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <Database className="w-10 h-10 mx-auto mb-2 opacity-30 text-gray-400" />
                <p className="text-sm font-medium text-gray-600">No master data records loaded</p>
                <p className="text-xs text-gray-400 mt-1">
                  Click "Add Single Record" to create an entry or use "Bulk Upload" to import a file.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50/90 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
                    <th
                      onClick={() => handleSort('brand_name')}
                      className="text-left py-3.5 px-4 cursor-pointer hover:bg-gray-100"
                    >
                      <div className="flex items-center gap-1">
                        <span>{type === 'who_inn' ? 'INN NAME' : 'MARK / BRAND NAME'}</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </div>
                    </th>

                    {type === 'who_inn' ? (
                      <th className="text-left py-3.5 px-4">W.H.O PUBLICATION REFERENCE</th>
                    ) : type === 'international_market' ? (
                      <th className="text-left py-3.5 px-4">MOLECULE / ACTIVE INGREDIENT</th>
                    ) : (
                      <>
                        <th className="text-left py-3.5 px-4">CLASS</th>
                        <th className="text-left py-3.5 px-4">APPL NO</th>
                        <th className="text-left py-3.5 px-4">STATUS</th>
                        <th className="text-left py-3.5 px-4">DESCRIPTION / REMARKS</th>
                      </>
                    )}

                    <th className="text-left py-3.5 px-4">CREATED</th>
                    <th className="text-center py-3.5 px-4 w-32">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {sortedRecords.map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-orange-50/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-gray-900">{rec.inn_name || rec.brand_name}</td>

                      {type === 'who_inn' ? (
                        <td className="py-3 px-4 text-gray-600 font-medium">
                          {rec.who_publication_reference || '—'}
                        </td>
                      ) : type === 'international_market' ? (
                        <td className="py-3 px-4 text-gray-600 font-medium">{rec.active_ingredient || '—'}</td>
                      ) : (
                        <>
                          <td className="py-3 px-4 text-gray-600 font-semibold">{rec.trademark_class ? `Class ${rec.trademark_class}` : '—'}</td>
                          <td className="py-3 px-4 text-gray-600">{rec.application_number || '—'}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold">
                              {rec.status || 'Registered'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{rec.remarks || '—'}</td>
                        </>
                      )}

                      <td className="py-3 px-4 text-gray-400 text-[11px]">
                        {rec.created_at ? formatDate(rec.created_at) : '—'}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openEditModal(rec)}
                            title="Edit Record"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openCopyModal(rec)}
                            title="Copy / Clone Record"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(rec)}
                            title="Delete Record"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Record Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-gray-900">
              {editingRecord ? <Edit2 className="w-4 h-4 text-orange-600" /> : <Plus className="w-4 h-4 text-orange-600" />}
              {editingRecord ? 'Edit Single Record' : 'Add Single Record'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div>
              <label className="font-bold text-gray-700 block mb-1">
                {type === 'who_inn' ? 'INN Name' : type === 'international_market' ? 'Mark (Brand Name)' : 'TradeMark Name'} <span className="text-red-500">*</span>
              </label>
              <Input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={type === 'who_inn' ? 'e.g. ABACAVIR' : type === 'international_market' ? 'e.g. TICAPLET' : 'e.g. A2CLEAR'}
                className="h-9 text-xs"
              />
            </div>

            {type === 'who_inn' ? (
              <div>
                <label className="font-bold text-gray-700 block mb-1">W.H.O Publication Reference</label>
                <Input
                  value={whoRef}
                  onChange={(e) => setWhoRef(e.target.value)}
                  placeholder="e.g. List 77 (1997)"
                  className="h-9 text-xs"
                />
              </div>
            ) : type === 'international_market' ? (
              <div>
                <label className="font-bold text-gray-700 block mb-1">Molecule (Active Ingredient)</label>
                <Input
                  value={activeIngredient}
                  onChange={(e) => setActiveIngredient(e.target.value)}
                  placeholder="e.g. TICAGRELOR"
                  className="h-9 text-xs"
                />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Class</label>
                    <Input
                      type="number"
                      value={tmClass}
                      onChange={(e) => setTmClass(e.target.value)}
                      placeholder="5"
                      className="h-9 text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Appl No</label>
                    <Input
                      value={appNumber}
                      onChange={(e) => setAppNumber(e.target.value)}
                      placeholder="5693827"
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">TMR Status</label>
                    <Input
                      value={statusVal}
                      onChange={(e) => setStatusVal(e.target.value)}
                      placeholder="Registered"
                      className="h-9 text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Appl Date</label>
                    <Input
                      type="date"
                      value={appDate}
                      onChange={(e) => setAppDate(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Description / Remarks</label>
                  <Input
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Dormant mark"
                    className="h-9 text-xs"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsFormOpen(false)} className="text-xs h-9">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!brandName.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-9 font-semibold gap-1.5"
            >
              {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editingRecord ? 'Save Changes' : 'Create Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-2">
            <Trash2 className="w-6 h-6" />
          </div>
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 text-center">
              Delete Record?
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 my-2">
            Are you sure you want to permanently delete <strong>"{deleteTarget?.inn_name || deleteTarget?.brand_name}"</strong> from master data?
          </p>
          <DialogFooter className="justify-center gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} className="text-xs h-8">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 font-semibold"
            >
              {deleteMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// Main Data Sources Page
// ===========================================================================

export function DataSourcesPage() {
  const { isAdmin } = useAuth();
  const [activeMasterData, setActiveMasterData] = useState<MasterDataType>(null);

  const sourcesQuery = useQuery({
    queryKey: ['data-sources'],
    queryFn: () => apiClient.getDataSources(),
  });

  const statusQuery = useQuery({
    queryKey: ['reference-data-status'],
    queryFn: () => apiClient.getReferenceDataStatus(),
  });

  // If viewing Master Data details
  if (activeMasterData) {
    return (
      <div className="min-h-screen bg-[#fffaf5] px-6 py-8">
        <div className="max-w-[1400px] mx-auto">
          <MasterDataListView
            type={activeMasterData}
            onBack={() => setActiveMasterData(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fffaf5] px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Page Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Database className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Data Sources</h1>
            <p className="text-gray-500 text-sm">
              Every source the Brand Analysis screening pipeline checks, its live status, and the Tier-1
              registries loaded into it.
            </p>
          </div>
        </div>

        {/* Section 1: Screening Sources */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Screening Sources{' '}
            {sourcesQuery.data && (
              <span className="text-gray-400 normal-case font-normal">
                · {sourcesQuery.data.sources.length + 1} Sources
              </span>
            )}
          </h2>
          {sourcesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading data source status…
            </div>
          ) : (
            <div className="space-y-3">
              {sourcesQuery.data?.sources.map((source) => (
                <DataSourceRow key={source.id} source={source} canToggle={isAdmin} />
              ))}
              <HistoricalCaseRow />
            </div>
          )}
          {!isAdmin && (
            <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> Connect/Disconnect requires administrator privileges.
            </p>
          )}
        </div>

        {/* Section 2: Import Data & Master Registries */}
        {isAdmin && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
              Import Data &amp; Master Registries
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              Click any master registry below to view records, add single entries, download templates, or perform bulk uploads.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* WHO INN */}
              <UploadCard
                icon={FlaskConical}
                title="WHO INN Registry"
                subtitle="PDF Import"
                count={statusQuery.data?.who_inn_row_count ?? 0}
                accept="application/pdf"
                onUpload={(f) => apiClient.uploadWhoInnPdf(f)}
                onManage={() => setActiveMasterData('who_inn')}
              />

              {/* IQVIA */}
              <UploadCard
                icon={Database}
                title="IQVIA Extract"
                subtitle="Licensed Extract"
                count={0}
                accept=""
                disabled
                disabledNote="Import coming soon, pending IQVIA licence confirmation."
              />

              {/* Registered but Not in Use */}
              <UploadCard
                icon={Landmark}
                title="Registered but Not in Use"
                subtitle="Excel Registry"
                count={statusQuery.data?.registered_not_in_use_row_count ?? 0}
                accept=".xlsx"
                onUpload={(f) => apiClient.uploadRegisteredNotInUse(f)}
                onManage={() => setActiveMasterData('registered_not_in_use')}
              />

              {/* International Market Brands */}
              <UploadCard
                icon={Building2}
                title="International Market Brands"
                subtitle="Overseas Registry"
                count={statusQuery.data?.international_market_row_count ?? 0}
                accept=".xlsx"
                onUpload={(f) => apiClient.uploadInternationalMarket(f)}
                onManage={() => setActiveMasterData('international_market')}
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              WHO INN, Registered-but-Not-in-Use, and International Market Brands are actively checked during trademark screening.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
