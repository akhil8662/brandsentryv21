import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  Search, AlertTriangle, CheckCircle, Shield, Loader2, Zap,
  BarChart2, Brain, ShoppingCart,
  Download,
  FileText, Link2, XCircle, X, ArrowLeft, Eye,
} from 'lucide-react';
import { downloadBrandAnalysisReport } from '@/lib/report';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { CaseSelector } from '@/components/CaseSelector';
import { CaseFormDetailsModal } from '@/components/CaseFormDetailsModal';
import { CreateCaseModal } from '@/components/CreateCaseModal';
import { ScreeningProgress } from '@/components/ScreeningProgress';
import {
  RiskAssessmentBanner, SimilarityAnalysisCard, ConflictSourcesCard,
  ScreeningWorkflowPanel, KnockoutValidationPanel, UniquenessAndBreakdown,
} from '@/components/ScreeningResultBlocks';
import { useCart } from '@/contexts/CartContext';
import { useActiveCase } from '@/contexts/ActiveCaseContext';
import { getCase, caseDisplayName, type BrandCase } from '@/lib/caseStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  cn, getRiskBgColor, getScoreColor, formatDate,
  getSimilarityTypeIcon, getSourceBadgeStyle, cleanSimilarityType,
} from '@/lib/utils';

function getRiskBadge(level: string) {
  switch (level) {
    case 'HIGH': return <Badge variant="destructive">High Risk</Badge>;
    case 'MEDIUM': return <Badge variant="warning">Medium Risk</Badge>;
    default: return <Badge variant="success">Low Risk</Badge>;
  }
}

// Note: the old "Submit for Legal Review" modal that used to live here was
// removed along with its trigger button (see BrandAnalysisPage's action bar)
// — that flow now belongs to the future Trademark Review page. The backend
// `POST /legal/submit` endpoint itself is untouched; it simply has no caller
// in this file until that page exists.

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function BrandAnalysisPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const cart = useCart();
  const { setActiveCase: setTopBarCase } = useActiveCase();
  // localStorage survives a full page reload (unlike sessionStorage in some
  // embeds) — guard the initial read so it doesn't crash during Next's
  // build-time static prerender (server-side, no localStorage there).
  const initialPersistedQ = (() => {
    try { return localStorage.getItem('pharma_last_query') || ''; } catch { return ''; }
  })();
  // Which case was linked/created — survives a remount the same way
  // pharma_last_query does, so navigating away and back (or a hard reload)
  // doesn't silently drop back to "Select a Case…" while the analyzed name
  // itself stays put. Cleared only by "New Search" or explicitly unlinking.
  const initialCaseId = (() => {
    try { return localStorage.getItem('pharma_active_case_id') || ''; } catch { return ''; }
  })();
  const initialCase = initialCaseId ? getCase(initialCaseId) ?? null : null;
  const [query, setQuery] = useState(initialPersistedQ);
  const [submittedName, setSubmittedName] = useState(initialPersistedQ);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialCase?.case_id ?? '');
  // A case must be created or linked before a name can be screened, matching
  // the mock's Create New Case / Link Existing Case cards gating the search.
  const [activeCase, setActiveCase] = useState<BrandCase | null>(initialCase);
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [showViewCaseModal, setShowViewCaseModal] = useState(false);

  // Restores the top-bar case chip on remount, silently — no toast, no
  // touching `query` (which already restored the actual searched name
  // independently and may differ from the case's own generic name).
  useEffect(() => {
    if (initialCase) {
      setTopBarCase({
        caseId: initialCase.case_id,
        createdBy: initialCase.suggested_by || 'Unknown',
        createdAt: formatDate(initialCase.saved_at),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCase = (c: BrandCase | null, opts?: { silent?: boolean }) => {
    setSelectedCaseId(c?.case_id ?? '');
    setActiveCase(c);
    try {
      if (c) localStorage.setItem('pharma_active_case_id', c.case_id);
      else localStorage.removeItem('pharma_active_case_id');
    } catch { /* ignore */ }
    if (!c) {
      setTopBarCase(null);
      return;
    }
    // Deliberately does NOT prefill query with c.generic_name — that's the
    // molecule/composition (e.g. "ghasin"), not the candidate brand NAME the
    // user wants screened, which is almost always something different. The
    // search box stays empty so they type the actual name to check.
    setTopBarCase({
      caseId: c.case_id,
      createdBy: c.suggested_by || 'Unknown',
      createdAt: formatDate(c.saved_at),
    });
    // silent: true when linked automatically via a ?case= deep link (e.g.
    // Compare Names' "View Screening") — an analysis is about to auto-fire
    // right after, so "enter a brand name" would be a stale/confusing toast.
    if (!opts?.silent) toast.info(`Loaded ${c.case_id}. Enter a brand name to screen.`);
  };

  const handleCaseCreated = ({ caseRecord }: { caseRecord: BrandCase }) => {
    applyCase(caseRecord);
    setShowCreateCase(false);
  };

  // Brand Screening — DB-first, same as Compare Names and the AI Generator's
  // Detail modal: apiClient.compareBrand checks React Query's own cache
  // first (staleTime below), then a recent (within 90 days) Brand Screening
  // or AI Name Generator history record for this exact name, and only runs
  // the full WHO INN/IQVIA/Google/e-pharmacy pipeline if neither exists —
  // instead of always re-running the whole pipeline on every search.
  const screeningQuery = useQuery({
    queryKey: ['screening', submittedName, activeCase?.case_id],
    queryFn: () => apiClient.compareBrand({ brand_name: submittedName, case_id: activeCase?.case_id }),
    enabled: submittedName.length >= 2,
    staleTime: 10 * 60 * 1000,
  });

  // Brand Intelligence query — fires when submittedName is set
  const intelligenceQuery = useQuery({
    queryKey: ['intelligence', submittedName],
    queryFn: () => apiClient.getBrandIntelligence(submittedName),
    enabled: submittedName.length >= 2,
  });

  const lastAnalyzedRef = useRef(initialPersistedQ);

  const handleAnalyze = (name?: string, addToHistory = false) => {
    if (!activeCase) return;
    const n = (name ?? query).trim();
    if (n.length < 2) return;
    setQuery(n);
    setSubmittedName(n);
    lastAnalyzedRef.current = n;
    try { localStorage.setItem('pharma_last_query', n); } catch { /* ignore */ }
    const href = `/brand-analysis?q=${encodeURIComponent(n)}`;
    if (addToHistory) router.push(href); else router.replace(href);
  };

  // Link a case carried over via ?case= (e.g. Compare Names' "View Screening"
  // button) before the ?q= auto-trigger below runs — handleAnalyze requires
  // an active case, so without this a q-only deep link with no case yet
  // linked would silently no-op instead of screening the name.
  useEffect(() => {
    if (!router.isReady) return;
    const caseId = typeof router.query.case === 'string' ? router.query.case : '';
    if (caseId && caseId !== activeCase?.case_id) {
      const record = getCase(caseId);
      if (record) applyCase(record, { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.case]);

  // Auto-trigger on URL ?q= param (initial load, top-nav search, or a case
  // just linked via ?case= above). lastAnalyzedRef prevents the loop caused
  // by router.push updating router.query. Also depends on activeCase since a
  // ?case= link only resolves into state one render after the effect above.
  useEffect(() => {
    if (!router.isReady) return;
    const q = typeof router.query.q === 'string' ? router.query.q : '';
    if (q && q !== lastAnalyzedRef.current) handleAnalyze(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.q, activeCase]);

  const screeningResult = screeningQuery.data ?? null;
  const sr = screeningResult?.screening_result;
  const intel = intelligenceQuery.data;
  const hasResults = !!submittedName;
  const screeningLoading = screeningQuery.isLoading;
  const intelLoading = intelligenceQuery.isLoading;

  // Briefly freeze the pipeline progress panel on the stage that actually
  // rejected the name, instead of letting it vanish straight to the results
  // section — a fast Stage 1 rejection resolves before the panel's own
  // time-based animation gets anywhere near that step, so without this the
  // WHO INN card could still be showing "Completed" right as it disappears.
  const [frozenRejection, setFrozenRejection] = useState<{ stage: number; reason: string } | null>(null);
  const freezeShownForRef = useRef<string | null>(null);

  useEffect(() => {
    if (sr?.rejected_at_stage && sr.rejection_reason && sr.id !== freezeShownForRef.current) {
      freezeShownForRef.current = sr.id;
      setFrozenRejection({ stage: sr.rejected_at_stage, reason: sr.rejection_reason });
      const t = setTimeout(() => setFrozenRejection(null), 1800);
      return () => clearTimeout(t);
    }
  }, [sr]);

  const similarNames = sr ? (sr.similar_names || []) : [];
  const conflicts = sr ? (sr.conflicts || []) : [];

  const inCart = screeningResult ? cart.has(screeningResult.brand_name) : false;
  // A name leaves the cart the moment it's submitted for Trademark Review,
  // so `inCart` alone goes back to false right after — checked separately so
  // "Add to Review Batch" stays disabled for a name that's already been
  // through this workflow, instead of silently re-enabling.
  const alreadySubmitted = screeningResult ? cart.isSubmitted(screeningResult.brand_name) : false;

  const handleAddToReviewBatch = async () => {
    if (!screeningResult || !sr || inCart || alreadySubmitted) return;
    const added = await cart.add({
      brand_name: screeningResult.brand_name,
      source_type: 'screening',
      brand_search_id: screeningResult.id,
      risk_score: sr.overall_risk_score,
      risk_level: sr.risk_classification,
      risk_ai_assessment: sr.ai_assessment ?? undefined,
      case_id: activeCase?.case_id,
      case_name: activeCase ? caseDisplayName(activeCase) : undefined,
    });
    if (added) toast.success(`"${screeningResult.brand_name}" added to review batch`);
    else toast.info(`"${screeningResult.brand_name}" is already in your review batch`);
  };

  // Resets both the searched name and the linked case — the mock has no
  // separate "change case" control, so this single action covers what the
  // old "New Search" button and the case pill's "change" link each did.
  const handleNewSearch = () => {
    setSubmittedName(''); setQuery('');
    try { localStorage.removeItem('pharma_last_query'); } catch { /* ignore */ }
    applyCase(null);
    router.replace('/brand-analysis');
  };

  const handleStopScreening = () => {
    queryClient.cancelQueries({ queryKey: ['screening', submittedName] });
    queryClient.cancelQueries({ queryKey: ['intelligence', submittedName] });
    lastAnalyzedRef.current = '';
    setSubmittedName('');
    setQuery('');
    try { localStorage.removeItem('pharma_last_query'); } catch { /* ignore */ }
    setFrozenRejection(null);
    router.replace('/brand-analysis');
    toast.info('Brand screening cancelled by user');
  };

  return (
    <div className="min-h-screen bg-[#fffaf5]">

      {/* ── Header — icon/title/subtitle on the left, actions on the right
          once results exist, matching the mock's top bar (which puts
          Download Report / Add to Review Batch there instead of on a
          separate tab row). ── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-1.5 text-xs text-gray-500 hover:text-orange-600 -ml-2"
            title="Go back to previous page"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Search className="w-4 h-4 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Brand Analysis</h1>
            <p className="text-gray-500 text-xs truncate">Screen a brand name for conflicts, phonetic similarity &amp; market intelligence</p>
          </div>
          {hasResults && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {intelLoading && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading market data...
                </span>
              )}
              <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-orange-600" onClick={handleNewSearch}>
                New Search
              </Button>
              {screeningResult && (
                <>
                  <Button variant="outline" size="sm"
                    disabled={!intel || intelLoading}
                    title={!intel ? 'Waiting for analysis data…' : 'Download full screening report'}
                    className="flex items-center gap-1.5 text-xs text-gray-600 border-gray-200 hover:border-orange-400 hover:text-orange-600 disabled:opacity-50"
                    onClick={() => intel && downloadBrandAnalysisReport(screeningResult, intel)}>
                    <Download className="w-3.5 h-3.5" />
                    {intelLoading ? 'Preparing…' : 'Download Report'}
                  </Button>
                  <Button size="sm"
                    disabled={inCart || alreadySubmitted}
                    title={alreadySubmitted ? 'Already submitted for Trademark Review' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 text-xs text-white',
                      (inCart || alreadySubmitted) ? 'bg-gray-400 hover:bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'
                    )}
                    onClick={handleAddToReviewBatch}>
                    {(inCart || alreadySubmitted) ? <CheckCircle className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                    {alreadySubmitted ? 'Submitted for Review' : inCart ? 'In Review Batch' : 'Add to Review Batch'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="py-6 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Create New Case / Link Existing Case — a case must be active before a name can be screened */}
          {!activeCase && (
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
                <p className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-orange-600" /> Create New Case
                </p>
                <p className="text-sm text-gray-500 mb-3">Create a new case to start brand analysis</p>
                <Button className="gap-1.5" onClick={() => setShowCreateCase(true)}>
                  <FileText className="w-4 h-4" /> Create a Case
                </Button>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <p className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-orange-500" /> Link Existing Case
                </p>
                <p className="text-sm text-gray-500 mb-3">Select an existing case to continue analysis</p>
                <CaseSelector value={selectedCaseId} onSelect={applyCase} />
                {selectedCaseId && (
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowViewCaseModal(true)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" /> View Form Details
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Single row — name input, case (read-only), Run Screening — matching
              the mock's layout instead of a separate case pill on its own line. */}
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Enter a Name to Screen</label>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                  placeholder={activeCase ? 'e.g. Vivantor' : 'Create or link a case to begin screening'}
                  disabled={!activeCase}
                  className="w-full h-12 pl-11 pr-9 text-sm rounded-xl border border-gray-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-300 placeholder:text-gray-400 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {query && activeCase && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {/* Only shown once a case is linked — the Create/Link cards
                above are the sole way to attach a case; once one is active
                this becomes a read-only summary plus a way to unlink it,
                instead of a re-openable case dropdown. */}
            {activeCase && (
              <div className="w-full sm:w-72 md:w-80 min-w-0 flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-500">Case</label>
                  <button
                    type="button"
                    onClick={() => setShowViewCaseModal(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-700 hover:underline cursor-pointer"
                    title="View case form details"
                  >
                    <Eye className="w-3.5 h-3.5" /> View Form Details
                  </button>
                </div>
                <div className="h-12 px-3 flex items-center justify-between gap-2 rounded-xl border border-orange-200 bg-orange-50 text-sm">
                  <button
                    type="button"
                    onClick={() => setShowViewCaseModal(true)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer group"
                    title="Click to view case form details"
                  >
                    <FileText className="w-4 h-4 text-orange-500 flex-shrink-0 group-hover:text-orange-600" />
                    <span className="truncate text-gray-800 group-hover:text-orange-950 group-hover:underline font-medium" title={caseDisplayName(activeCase)}>
                      {caseDisplayName(activeCase)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNewSearch}
                    aria-label="Remove linked case"
                    title="Remove linked case"
                    className="flex-shrink-0 text-gray-400 hover:text-red-500 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            <Button onClick={() => handleAnalyze()}
              disabled={!activeCase || query.trim().length < 2 || screeningLoading}
              className="h-12 px-6 bg-orange-500 hover:bg-orange-600 text-white rounded-xl shadow font-semibold text-sm flex-shrink-0">
              {screeningLoading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Screening...</>
                : <><Zap className="w-4 h-4 mr-2" /> Run Screening</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ══ RISK SCREENING RESULTS ══ */}
        {hasResults && (
          <>
            {(screeningLoading || frozenRejection) && (
              <ScreeningProgress
                isScreening={screeningLoading}
                brandName={submittedName}
                rejectedAt={frozenRejection}
                onStop={handleStopScreening}
              />
            )}

            {screeningQuery.isError && (
              <div className="text-center py-20 text-red-500">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3" />
                <p>Screening failed. Please try again.</p>
              </div>
            )}

            {sr && !screeningLoading && !frozenRejection && (
              <div className="space-y-6 animate-fade-in">
                <RiskAssessmentBanner sr={sr} brandName={screeningResult?.brand_name ?? ''} />

                {/* Sequential pipeline stopped early (see backend
                    brand_screening.py) — call out exactly which stage found
                    the conflict and why, so it's not left to be inferred from
                    a workflow panel that simply has fewer cards than usual. */}
                {sr.rejected_at_stage && sr.rejection_reason && (
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="py-4">
                      <div className="flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-bold text-red-800">
                            Rejected at Stage {sr.rejected_at_stage}: {sr.rejected_stage_name}
                          </p>
                          <p className="text-sm text-red-700 mt-1">{sr.rejection_reason}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Similarity Analysis + Conflict Sources — mirrors the mock's
                    Detailed Analysis layout, placed right after the risk banner */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <SimilarityAnalysisCard sr={sr} />
                  <ConflictSourcesCard sr={sr} />
                </div>

                <ScreeningWorkflowPanel sr={sr} stagesCompleted={sr.stages_completed} />
                {/* Knockout Validation and Market Intelligence both need
                    evidence from stages that never ran once the pipeline
                    stops early — showing them would either be blank or
                    misleadingly imply "checked, clean," so they're skipped
                    entirely for a rejected-early result. */}
                {!sr.rejected_at_stage && (
                  <KnockoutValidationPanel sr={sr} brandName={screeningResult?.brand_name ?? ''} />
                )}
                {!sr.rejected_at_stage && intel && <UniquenessAndBreakdown intel={intel} sr={sr} />}

                {/* AI Assessment */}
                {sr.ai_assessment && (
                  <Card className="border-orange-100 bg-gradient-to-r from-orange-50 to-indigo-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-orange-800">
                        <Brain className="w-5 h-5 text-orange-600" /> AI Assessment
                        <Badge variant="info" className="ml-2 text-xs">Claude Sonnet Powered</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-gray-700 leading-relaxed text-sm">{sr.ai_assessment}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Similar Names Table */}
                {similarNames.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Search className="w-5 h-5 text-orange-600" /> Similar Brand Names
                        </CardTitle>
                        <Badge variant="secondary">{similarNames.length} found</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100">
                              {['Brand Name', 'Similarity Type', 'Score', 'Source', 'Therapeutic Area', 'Risk'].map(h => (
                                <th key={h} className="text-left py-3 px-2 text-gray-500 font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {similarNames.map(sn => (
                              <tr key={sn.id} className="hover:bg-gray-50">
                                <td className="py-3 px-2">
                                  <span className="font-semibold text-gray-900">{sn.name}</span>
                                  {sn.manufacturer && <p className="text-xs text-gray-400">{sn.manufacturer}</p>}
                                </td>
                                <td className="py-3 px-2">
                                  <span className="flex items-center gap-1.5">
                                    {getSimilarityTypeIcon(sn.similarity_type)}
                                    <span className="text-gray-700">{cleanSimilarityType(sn.similarity_type)}</span>
                                  </span>
                                </td>
                                <td className="py-3 px-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                      <div className={cn('h-1.5 rounded-full', sn.similarity_score >= 0.7 ? 'bg-red-500' : sn.similarity_score >= 0.45 ? 'bg-orange-400' : 'bg-green-500')}
                                        style={{ width: `${sn.similarity_score * 100}%` }} />
                                    </div>
                                    <span className={cn('font-semibold text-xs', getScoreColor(sn.similarity_score * 100))}>
                                      {(sn.similarity_score * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-2"><span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', getSourceBadgeStyle(sn.source))}>{sn.source}</span></td>
                                <td className="py-3 px-2 text-gray-600 text-xs">{sn.therapeutic_area || 'N/A'}</td>
                                <td className="py-3 px-2">{getRiskBadge(sn.risk_level)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Conflicts Detail */}
                {conflicts.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-red-700">
                          <AlertTriangle className="w-5 h-5" /> Detected Conflicts
                        </CardTitle>
                        <Badge variant="destructive">{conflicts.length} conflicts</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {conflicts.map(c => (
                          <div key={c.id} className={cn('p-4 rounded-xl border', getRiskBgColor(c.severity))}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-bold text-gray-900">{c.conflicting_name}</span>
                                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', getSourceBadgeStyle(c.source))}>{c.source}</span>
                                </div>
                                <p className="text-sm text-gray-600">{c.details}</p>
                                {c.owner && <p className="text-xs text-gray-500 mt-1">Owner: {c.owner}</p>}
                                {c.registration_number && <p className="text-xs text-gray-500">Reg #: {c.registration_number}</p>}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {getRiskBadge(c.severity)}
                                <span className="text-xs text-gray-500">{c.conflict_type.replace(/_/g, ' ')}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!hasResults && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            {[
              { icon: Shield, title: 'Risk Screening', desc: 'Exact, phonetic, spelling & semantic conflict detection against connected sources', color: 'blue' },
              { icon: BarChart2, title: 'Uniqueness & Similarity', desc: 'Brand uniqueness score, market saturation and similarity breakdown across all sources', color: 'purple' },
              { icon: Brain, title: 'AI Assessment', desc: 'Claude Sonnet powered rationale explaining why a name is recommended, flagged or rejected', color: 'green' },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="bg-white rounded-xl border border-gray-100 p-6 text-center">
                <div className={cn('w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center', `bg-${color}-100`)}>
                  <Icon className={cn('w-6 h-6', `text-${color}-600`)} />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateCaseModal
        open={showCreateCase}
        onClose={() => setShowCreateCase(false)}
        onSuccess={handleCaseCreated}
        submitLabel="Create Case"
      />

      <CaseFormDetailsModal
        open={showViewCaseModal}
        onClose={() => setShowViewCaseModal(false)}
        caseData={activeCase}
        caseId={selectedCaseId}
      />
    </div>
  );
}
