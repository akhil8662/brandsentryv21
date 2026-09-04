import { useEffect, useState } from 'react';
import {
  FileText,
  Pill,
  Factory,
  TrendingUp,
  ScrollText,
  Globe2,
  History,
  Target,
  Lock,
  Loader2,
  Calendar,
  User,
  Tag,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getCase, cacheFromBackend, type BrandCase } from '@/lib/caseStore';
import { apiClient } from '@/api/client';

interface CaseFormDetailsModalProps {
  open: boolean;
  onClose: () => void;
  caseId?: string | null;
  caseData?: BrandCase | null;
}

export function CaseFormDetailsModal({
  open,
  onClose,
  caseId,
  caseData,
}: CaseFormDetailsModalProps) {
  const [resolvedCase, setResolvedCase] = useState<BrandCase | null>(caseData ?? null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;

    if (caseData && (caseData.generic_name || caseData.case_id)) {
      setResolvedCase(caseData);
      return;
    }

    if (!caseId) {
      setResolvedCase(null);
      return;
    }

    // Check local store first
    const local = getCase(caseId);
    if (local && local.generic_name) {
      setResolvedCase(local);
      return;
    }

    // Otherwise fetch from backend API
    setLoading(true);
    apiClient
      .getSuggestion(caseId)
      .then((data) => {
        if (data) {
          const mapped = cacheFromBackend(data);
          setResolvedCase(mapped);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch suggestion case from backend:', err);
        if (local) setResolvedCase(local);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, caseId, caseData]);

  const c = resolvedCase;

  // Extract Naming Criteria if available in local storage or on the case object
  const naming: Record<string, string> = (() => {
    if (!c?.case_id) return {};
    try {
      const stored = localStorage.getItem(`case_naming_${c.case_id}`);
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return (c as unknown as Record<string, Record<string, string>>)?.naming_criteria || {};
  })();

  const hasNamingCriteria = Boolean(
    naming.treatment ||
    naming.emotion_connected ||
    naming.naming_style ||
    naming.product_benefit ||
    naming.brand_coining_preferences ||
    naming.description
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl lg:max-w-5xl w-[92vw] max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white shadow-2xl rounded-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-4 text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                Brand Suggestion Form Details
                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white/20 px-2 py-0.5 rounded-full text-white/90">
                  <Lock className="w-3 h-3" /> Read-Only
                </span>
              </DialogTitle>
              <p className="text-xs text-orange-100 mt-0.5">
                Complete intake parameters, therapeutic, manufacturing & regulatory specifications
              </p>
            </div>
          </div>
          {c?.case_id && (
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-mono font-bold bg-white/20 px-2.5 py-1 rounded-lg">
                {c.case_id}
              </span>
              {c.saved_at && (
                <span className="text-[11px] text-orange-100 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(c.saved_at).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              <p className="text-sm font-medium">Loading case details...</p>
            </div>
          )}

          {!loading && !c && (
            <div className="text-center py-12 text-gray-500">
              <p className="font-semibold text-gray-700">No case details found</p>
              <p className="text-xs text-gray-400 mt-1">Please select or link a valid case</p>
            </div>
          )}

          {!loading && c && (
            <>
              {/* Top Summary Banner */}
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">
                    Molecule & Division
                  </span>
                  <h2 className="text-xl font-extrabold text-gray-900 mt-0.5">
                    {c.generic_name || 'Unnamed Case'}
                    {c.division && <span className="text-orange-600 font-semibold"> · {c.division}</span>}
                  </h2>
                  <p className="text-xs text-gray-600 mt-1">
                    {c.therapy || c.segment || 'General Therapeutics'} {c.ailment ? `— ${c.ailment}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {c.suggested_by && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-lg border border-orange-200 text-gray-700">
                      <User className="w-3.5 h-3.5 text-orange-500" /> {c.suggested_by}
                    </span>
                  )}
                  {c.dosage_form && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-lg border border-orange-200 text-gray-700 font-medium">
                      <Pill className="w-3.5 h-3.5 text-orange-500" /> {c.dose ? `${c.dose} ` : ''}{c.dosage_form}
                    </span>
                  )}
                  {c.case_id && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-lg border border-orange-200 font-mono font-bold text-orange-700">
                      <Tag className="w-3.5 h-3.5 text-orange-500" /> {c.case_id}
                    </span>
                  )}
                </div>
              </div>

              {/* 1. Product Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <Pill className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    1. Product Information
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <FieldDisplay label="Generic Name" value={c.generic_name} highlight />
                  <FieldDisplay label="Dosage Form" value={c.dosage_form} />
                  <FieldDisplay label="Dose" value={c.dose} />
                  <FieldDisplay label="Division (DIV)" value={c.division} />
                  <FieldDisplay label="Suggested By" value={c.suggested_by} />
                  <FieldDisplay label="Date" value={c.date} />
                </div>
              </div>

              {/* 2. Medical Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    2. Medical Information
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <FieldDisplay label="Ailment / Curative Action" value={c.ailment} className="sm:col-span-2 md:col-span-1" />
                  <FieldDisplay label="Segment" value={c.segment} />
                  <FieldDisplay label="Therapy" value={c.therapy} />
                  <FieldDisplay
                    label="Promoting Indication(s)"
                    value={c.promoting_indications}
                    className="col-span-full"
                    isParagraph
                  />
                </div>
              </div>

              {/* 3. Manufacturing Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <Factory className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    3. Manufacturing Information
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <FieldDisplay
                    label="Product Manufacturer Name & Location"
                    value={c.manufacturer_location}
                    className="sm:col-span-2"
                  />
                  <FieldDisplay label="Manufactured In-house or Outsourced?" value={c.mfd_type} />
                  <FieldDisplay label="Is this an In-License product?" value={c.in_license} />
                  <FieldDisplay
                    label="Same manufacturer making this for others?"
                    value={c.mfg_for_others_yn || (c.mfg_for_others ? 'Yes' : undefined)}
                  />
                  <FieldDisplay label="Owner of Existing Parent Brand" value={c.parent_brand_owner} />
                  <FieldDisplay
                    label="Marks of Others"
                    value={c.mfg_for_others}
                    className="col-span-full"
                    isParagraph
                  />
                </div>
              </div>

              {/* 4. Commercial Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    4. Commercial Information
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <FieldDisplay label="Marketer Name of the Product" value={c.marketer_name} />
                  <FieldDisplay label="Product Seller's Name" value={c.seller_name} />
                  <FieldDisplay label="Expected Launch Month" value={c.expected_launch_month} />
                  <FieldDisplay label="Expected Sale of the Products" value={c.expected_sale} />
                </div>
              </div>

              {/* 5. Regulatory Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    5. Regulatory Information
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldDisplay label="Is this DCGI Combination Approved?" value={c.dcgi_combination_approved} />
                  <FieldDisplay label="Scheduled / Non-Scheduled Drug" value={c.drug_schedule} />
                </div>
              </div>

              {/* 6. Brand Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <Globe2 className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    6. Brand Information (Competitors & Innovators)
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FieldDisplay label="Domestic Brand Names" value={c.domestic_brand_names} isList />
                  <FieldDisplay label="International Brand Names" value={c.international_brand_names} isList />
                  <FieldDisplay label="Innovator Brand Names" value={c.innovator_brands} isList />
                </div>
              </div>

              {/* 7. Patent Information */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    7. Patent Information
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <FieldDisplay label="Patent Status: Expired / Valid Till" value={c.patent_validity} />
                  <FieldDisplay label="Launching After Expiry of Patent?" value={c.launch_after_expiry} />
                  <FieldDisplay
                    label="Launch Timing (Month/Year)"
                    value={c.launch_after_expiry_month}
                  />
                  <FieldDisplay label="Launching During Validity of Patent?" value={c.launch_during_validity} />
                  <FieldDisplay
                    label="Arrangement"
                    value={c.launch_during_validity_arrangement}
                    className="sm:col-span-2"
                  />
                </div>
              </div>

              {/* 8. Molecule / Product History */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                  <History className="w-4 h-4 text-orange-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    8. Molecule / Product History
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <FieldDisplay label="Inventor Name" value={c.inventor_name} />
                  <FieldDisplay label="Patient Name" value={c.patient_name} />
                  <FieldDisplay label="Place of Origin" value={c.place_of_origin} />
                  <FieldDisplay
                    label="Other Relevant Historical Association"
                    value={c.other_historical_association}
                    className="col-span-full"
                    isParagraph
                  />
                </div>
              </div>

              {/* 9. Naming Criteria */}
              {hasNamingCriteria && (
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                    <Target className="w-4 h-4 text-orange-600" />
                    <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                      9. Naming Criteria
                    </h3>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FieldDisplay label="Treatment Approach" value={naming.treatment} />
                    <FieldDisplay label="Emotional Connection" value={naming.emotion_connected} />
                    <FieldDisplay label="Naming Style" value={naming.naming_style} />
                    <FieldDisplay label="Product Benefit" value={naming.product_benefit} />
                    <FieldDisplay
                      label="Applicable Brand Coining Preferences"
                      value={naming.brand_coining_preferences}
                      className="col-span-full"
                      isParagraph
                    />
                    {naming.description && (
                      <FieldDisplay
                        label="Additional Naming Instructions"
                        value={naming.description}
                        className="col-span-full"
                        isParagraph
                      />
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 border-t border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-gray-500">
            {c?.case_id ? `Case ID: ${c.case_id}` : 'Intake Specifications'}
          </span>
          <Button onClick={onClose} variant="outline" size="sm">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldDisplay({
  label,
  value,
  highlight,
  className,
  isParagraph,
  isList,
}: {
  label: string;
  value?: string | null;
  highlight?: boolean;
  className?: string;
  isParagraph?: boolean;
  isList?: boolean;
}) {
  const displayVal = value && value.trim() ? value.trim() : '—';
  const isEmpty = displayVal === '—';

  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </label>
      {isParagraph ? (
        <div className="text-xs text-gray-800 bg-gray-50/80 rounded-lg p-2.5 border border-gray-100 whitespace-pre-wrap leading-relaxed">
          {displayVal}
        </div>
      ) : isList && !isEmpty ? (
        <div className="text-xs text-gray-800 bg-gray-50/80 rounded-lg p-2 border border-gray-100">
          {displayVal.split(/[,;\n]+/).map((item, idx) => {
            const clean = item.trim();
            if (!clean) return null;
            return (
              <span
                key={idx}
                className="inline-block bg-white border border-gray-200 rounded px-2 py-0.5 text-[11px] mr-1.5 mb-1 text-gray-700"
              >
                {clean}
              </span>
            );
          })}
        </div>
      ) : (
        <div
          className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border bg-white ${
            highlight
              ? 'border-orange-200 text-orange-950 font-bold bg-orange-50/40'
              : isEmpty
              ? 'border-gray-100 text-gray-400 italic'
              : 'border-gray-200 text-gray-800'
          }`}
        >
          {displayVal}
        </div>
      )}
    </div>
  );
}
