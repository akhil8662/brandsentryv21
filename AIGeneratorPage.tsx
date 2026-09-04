import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Loader2, CheckCircle, AlertTriangle,
  Shield, Download, Brain,
  Star, ChevronDown, RotateCcw, PanelLeftOpen, PanelLeftClose,
  ShoppingCart, FileText, Link2, Database, X, ArrowLeft, Eye,
} from 'lucide-react';
import { downloadNameDetailReport, downloadBulkNamesReport } from '@/lib/report';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useActiveCase } from '@/contexts/ActiveCaseContext';
import { CaseSelector } from '@/components/CaseSelector';
import { CaseFormDetailsModal } from '@/components/CaseFormDetailsModal';
import { GenerationProgress } from '@/components/GenerationProgress';
import { CreateCaseModal, type CreateCaseResult } from '@/components/CreateCaseModal';
import {
  RiskAssessmentBanner, SimilarityAnalysisCard, ConflictSourcesCard,
  ScreeningWorkflowPanel, KnockoutValidationPanel, UniquenessAndBreakdown,
} from '@/components/ScreeningResultBlocks';
import { getCase, buildStructuredPayload, caseDisplayName, cacheFromBackend, type BrandCase } from '@/lib/caseStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn, getRecommendationColor, getRecommendationLabel, formatDate } from '@/lib/utils';
import type { GeneratedName, User, BrandIntelligence, ScreeningResult, SimilarName, Conflict } from '@/types';

const MAX_SHORTLIST = 5;

const DEFAULT_FORM = {
  molecule: '',
  therapeutic_area: '',
  ailment: '',
  treatment: '',
  emotion_connected: '',
  outcome: '',
  geography: '',
  product_attributes: '',
  naming_style: '',
  description: '',
  count: '10',
};

// Turns the backend's raw AI-service error (often a full Bedrock/Anthropic
// exception dump) into one short, human-readable sentence for the pipeline
// panel — nobody should have to read a stack trace to know "the API key is
// wrong."
function describeGenerationFailure(rawDetail: string | undefined): string {
  const detail = rawDetail || '';
  // The backend only ever raises this exact wording from one place —
  // ai.py's AIService.generate_brand_names(), the instant it finds the
  // Bedrock Claude client unconfigured (self.client is None) — so this
  // branch can't misfire for a failure at any other pipeline stage (market
  // verification, scoring, etc.).
  if (/Bedrock Claude client is not configured/i.test(detail)) {
    return 'LLM key not integrated. Please contact your administrator to configure the AI service.';
  }
  if (/invalid_api_key|incorrect api key|401|UnrecognizedClientException|AccessDeniedException|ExpiredTokenException|InvalidSignatureException|authentication_error/i.test(detail)) {
    return 'The AI service is not configured correctly (invalid or missing API key). Contact your administrator.';
  }
  if (/rate limit|429|quota|ThrottlingException|TooManyRequestsException/i.test(detail)) {
    return 'The AI service is temporarily rate-limited or over quota. Please try again shortly.';
  }
  if (/timed out|timeout|etimedout/i.test(detail)) {
    return 'The AI service took too long to respond. Please try again.';
  }
  if (/unexpected response format/i.test(detail)) {
    return 'The AI service returned an unexpected response. Please try again.';
  }
  return 'Name generation could not be completed. Please try again or contact your administrator.';
}

// Plain, always-expanded card — the mock (Sun_Pharma_Screens_V1.2, slide 2)
// shows Knockout Rules and Reference Sources as static reference reading,
// never collapsed and with no toggle affordance at all, so this deliberately
// has no expand/collapse state.
function StaticInfoCard({
  title, icon, children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-3.5">
        <span className="text-sm flex items-center gap-2 text-gray-700 uppercase tracking-wide font-semibold">
          {icon}
          {title}
        </span>
      </div>
      <div className="px-6 pb-5 pt-1 space-y-3 border-t border-gray-50">
        {children}
      </div>
    </Card>
  );
}

function NameDetailModal({ name, open, onClose, activeCase }: { name: GeneratedName; open: boolean; onClose: () => void; activeCase: BrandCase | null }) {
  const cart = useCart();
  const inCart = cart.has(name.generated_name);
  const alreadySubmitted = cart.isSubmitted(name.generated_name);

  // DB-first, same as Compare Names: this exact name was very likely just
  // screened moments ago as part of generation (generator_history), so
  // apiClient.compareBrand serves that stored result straight from the DB
  // instead of re-running the whole WHO INN/IQVIA/Google/e-pharmacy pipeline
  // from scratch. Only a genuinely new/stale name (>90 days) pays for a
  // fresh pipeline run. Gives this modal the exact same Similarity Analysis
  // / Conflict Sources / Screening Workflow / Knockout & Validation / Brand
  // Uniqueness blocks as Brand Analysis, not fabricated data.
  const screeningQuery = useQuery({
    queryKey: ['screening', name.generated_name],
    queryFn: () => apiClient.compareBrand({ brand_name: name.generated_name }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const intelligenceQuery = useQuery({
    queryKey: ['intelligence', name.generated_name],
    queryFn: () => apiClient.getBrandIntelligence(name.generated_name),
    enabled: open,
  });

  const sr = screeningQuery.data?.screening_result;
  const intel = intelligenceQuery.data;

  // Instant data fallback: candidate already has conflict_details & scores from generation
  const rawTopConflicts = name.conflict_details?.top_conflicts ?? [];
  const fallbackSimilarNames: SimilarName[] = (() => {
    const list: SimilarName[] = [];
    let idx = 0;
    for (const c of rawTopConflicts) {
      const phon = c.phonetic_score ?? 0;
      const lev = c.spelling_score ?? 0;
      const look = c.lookalike_score ?? 0;
      const sem = c.semantic_similarity_score ?? ((c.similarity_score ?? 0) >= 0.30 ? Number(((c.similarity_score ?? 0) * 0.5).toFixed(3)) : 0);

      const dims = [
        { type: 'Phonetic', score: phon },
        { type: 'Spelling', score: lev },
        { type: 'Visual', score: look },
        { type: 'Conceptual', score: sem },
      ];
      for (const d of dims) {
        if (d.score >= 0.45) {
          list.push({
            id: `sn-${c.name}-${d.type}-${idx++}`,
            name: c.name,
            similarity_score: d.score,
            similarity_type: d.type,
            source: c.source || 'E-Pharmacy',
            risk_level: d.score >= 0.70 ? 'HIGH' : d.score >= 0.50 ? 'MEDIUM' : 'LOW',
            manufacturer: c.owner,
          });
        }
      }
    }
    return list;
  })();

  const fallbackConflicts: Conflict[] = rawTopConflicts
    .filter((c: any) => (c.similarity_score ?? 0) >= 0.70)
    .map((c: any, idx: number) => ({
      id: `fc-${c.name}-${idx}`,
      conflicting_name: c.name,
      conflict_type: 'SIMILARITY_MATCH',
      similarity_score: c.similarity_score,
      source: c.source || 'E-Pharmacy',
      severity: ((c.similarity_score ?? 0) >= 0.85 ? 'HIGH' : (c.similarity_score ?? 0) >= 0.70 ? 'MEDIUM' : 'LOW') as 'LOW' | 'MEDIUM' | 'HIGH',
      owner: c.owner,
      status: 'Conflict',
      details: `${Math.round((c.similarity_score ?? 0) * 100)}% similarity match`,
    }));

  const getFallbackMax = (type: string) => {
    const ms = fallbackSimilarNames.filter(n => n.similarity_type === type);
    return ms.length > 0 ? Math.max(...ms.map(n => n.similarity_score)) : 0;
  };

  const fallbackSr: ScreeningResult = {
    id: name.id,
    brand_search_id: name.id,
    overall_risk_score: name.risk_score,
    risk_classification: name.recommendation_status === 'high_risk' ? 'HIGH' : name.recommendation_status === 'review_required' ? 'MEDIUM' : 'LOW',
    exact_match_score: name.conflict_details?.exact_match_score ?? 0,
    spelling_similarity_score: getFallbackMax('Spelling'),
    phonetic_similarity_score: getFallbackMax('Phonetic'),
    semantic_similarity_score: getFallbackMax('Conceptual'),
    lookalike_score: getFallbackMax('Visual'),
    soundalike_score: 0,
    trademark_conflict_score: name.conflict_details?.trademark_conflict_score ?? 0,
    market_presence_score: name.conflict_details?.market_presence_score ?? 0,
    memorability_score: name.memorability_score,
    pronunciation_score: name.pronunciation_score,
    ai_assessment: name.ai_explanation ?? name.conflict_details?.rationale,
    ai_recommendation: name.recommendation_status === 'high_risk' ? 'REJECT' : name.recommendation_status === 'review_required' ? 'LEGAL_REVIEW' : 'PROCEED',
    total_conflicts: fallbackConflicts.length,
    trademark_conflicts: 0,
    market_conflicts: 0,
    epharmacy_conflicts: 0,
    similar_names: fallbackSimilarNames,
    conflicts: fallbackConflicts,
    created_at: new Date().toISOString(),
  };

  const activeSr = sr || fallbackSr;

  const fallbackBreakdown = (() => {
    const counts: Record<string, number> = {};
    for (const item of (activeSr?.similar_names ?? [])) {
      counts[item.similarity_type] = (counts[item.similarity_type] || 0) + 1;
    }
    const colors: Record<string, string> = {
      'Phonetic': '#3b82f6',
      'Spelling': '#a855f7',
      'Visual': '#f97316',
      'Conceptual': '#6366f1',
    };
    return Object.entries(counts).map(([type, count]) => ({
      type,
      count,
      color: colors[type] || '#6b7280',
    }));
  })();

  const activeIntel: BrandIntelligence = intel || {
    brand_name: name.generated_name,
    trademark_presence: 0,
    market_presence: activeSr?.market_presence_score ?? 0,
    epharmacy_presence: 0,
    geographic_reach: 0,
    competitor_count: activeSr?.similar_names?.length ?? 0,
    market_saturation: 0,
    brand_uniqueness_score: activeSr ? Math.round(100 - activeSr.overall_risk_score) : Math.round(name.availability_score),
    ai_summary: name.ai_explanation || name.conflict_details?.rationale,
    similar_brands: activeSr?.similar_names ?? [],
    competitive_landscape: [],
    trend_data: [],
    similarity_breakdown: fallbackBreakdown,
    risk_distribution: [],
  };

  const handleAddToCart = async () => {
    if (!activeCase) {
      toast.error('Link or create a case first, every review batch entry needs a case attached.');
      return;
    }
    if (alreadySubmitted) {
      toast.info(`"${name.generated_name}" was already submitted for Trademark Review`);
      return;
    }
    const added = await cart.add({
      brand_name: name.generated_name,
      source_type: 'generated',
      generated_name_id: name.id,
      therapeutic_area: name.therapeutic_area,
      risk_score: activeSr?.overall_risk_score ?? name.risk_score,
      risk_level: activeSr?.risk_classification ?? (name.recommendation_status === 'high_risk' ? 'HIGH'
        : name.recommendation_status === 'review_required' ? 'MEDIUM' : 'LOW'),
      risk_ai_assessment: activeSr?.ai_assessment ?? name.ai_explanation ?? undefined,
      case_id: activeCase?.case_id,
      case_name: activeCase ? caseDisplayName(activeCase) : undefined,
    });
    if (added) toast.success(`"${name.generated_name}" added to review batch`);
    else toast.info(`"${name.generated_name}" is already in your review batch`);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-orange-600">Detailed Analysis</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-1 overflow-y-auto flex-1 pr-2">
          {/* Generation metrics — unique to AI-generated candidates, not part of a plain screening result */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border bg-orange-50 border-orange-200 text-center">
              <p className="text-xs text-gray-500 mb-1">Availability</p>
              <p className="text-2xl font-bold text-orange-600">{name.availability_score.toFixed(0)}</p>
            </div>
            <div className="p-3 rounded-xl border bg-blue-50 border-blue-200 text-center">
              <p className="text-xs text-gray-500 mb-1">Memorability</p>
              <p className="text-2xl font-bold text-blue-600">{name.memorability_score.toFixed(0)}</p>
            </div>
            <div className="p-3 rounded-xl border bg-purple-50 border-purple-200 text-center">
              <p className="text-xs text-gray-500 mb-1">Pronunciation</p>
              <p className="text-2xl font-bold text-purple-600">{name.pronunciation_score.toFixed(0)}</p>
            </div>
          </div>

          {activeSr && (
            <>
              <RiskAssessmentBanner sr={activeSr} brandName={name.generated_name} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SimilarityAnalysisCard sr={activeSr} />
                <ConflictSourcesCard sr={activeSr} />
              </div>
              <ScreeningWorkflowPanel sr={activeSr} />
              <KnockoutValidationPanel sr={activeSr} brandName={name.generated_name} />
              {activeIntel && <UniquenessAndBreakdown intel={activeIntel} sr={activeSr} />}
            </>
          )}

          {/* Section 10: Rationale Behind the Name & Coining Principles Applied */}
          <div className="p-4 bg-orange-50/70 rounded-xl border border-orange-200/80 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-600" />
                <p className="text-sm font-bold text-orange-950">Rationale Behind the Name</p>
              </div>
              <Badge variant="secondary" className="text-[10px] font-bold bg-orange-100 text-orange-900 border border-orange-200">
                8 COINING PRINCIPLES
              </Badge>
            </div>

            {/* Coining Principles Badges */}
            {(name.coining_principles || (name.conflict_details as any)?.coining_principles) && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] font-bold text-orange-900 uppercase tracking-wider">
                  Coining Principles Applied:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {((name.coining_principles || (name.conflict_details as any)?.coining_principles) as string[]).map((cp: string, idx: number) => (
                    <span key={idx} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white text-orange-800 border border-orange-300 shadow-2xs">
                      ✓ {cp}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Business Alignment */}
            {(name.business_alignment || (name.conflict_details as any)?.business_alignment) && (
              <div className="pt-1.5 border-t border-orange-200/60">
                <p className="text-[11px] font-bold text-orange-900 uppercase tracking-wider">
                  Business Alignment:
                </p>
                <p className="text-xs text-orange-950 mt-0.5 leading-relaxed">
                  {name.business_alignment || (name.conflict_details as any)?.business_alignment}
                </p>
              </div>
            )}

            {/* AI Linguistic & Clearance Rationale */}
            {name.ai_explanation && (
              <div className="pt-1.5 border-t border-orange-200/60">
                <p className="text-[11px] font-bold text-orange-900 uppercase tracking-wider">
                  Linguistic Rationale & Clearance:
                </p>
                <p className="text-xs text-gray-800 mt-0.5 leading-relaxed">
                  {name.ai_explanation}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1 flex-wrap">
            <Button className="flex-1" variant="outline" onClick={onClose}>Close</Button>
            <Button className="flex-1 gap-2" onClick={() => downloadNameDetailReport(name)}>
              <Download className="w-4 h-4" /> Download
            </Button>
            <Button
              className="flex-1 gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              disabled={inCart || alreadySubmitted || !activeCase}
              title={
                !activeCase ? 'Link or create a case first'
                  : alreadySubmitted ? 'Already submitted for Trademark Review'
                    : undefined
              }
              onClick={handleAddToCart}
            >
              {(inCart || alreadySubmitted) ? <CheckCircle className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
              {alreadySubmitted ? 'Submitted for Review' : inCart ? 'In Review Batch' : 'Add to Review Batch'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function loadPersisted<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

// Builds the /brands/generate request body. When a Suggestion Form case is
// loaded, its data already travels inside `suggestion_form` (grouped by
// section — see caseStore.buildStructuredPayload), so the molecule /
// therapeutic_area / ailment / product_attributes fields derived from that
// same case are left out here — sending them too would duplicate the exact
// same values under a second set of keys. Only genuinely new refinement
// inputs typed on this page (geography, naming style, free-text brief, etc.)
// are still included alongside the structured payload.
//
// `requester` identifies the logged-in account making the request (one
// email == one user_id) — attached to every generate call, case-based or
// not, so the backend can attribute/audit who triggered a given generation.
function buildGeneratePayload(
  form: typeof DEFAULT_FORM,
  activeCase: BrandCase | null,
  requester: User | null,
): NonNullable<Parameters<typeof apiClient.generateBrandNames>[0]> {
  const count = parseInt(form.count, 10);
  const identity = {
    user_id: requester?.id || undefined,
    user_email: requester?.email || undefined,
  };
  const refinements = {
    treatment: form.treatment || undefined,
    emotion_connected: form.emotion_connected || undefined,
    outcome: form.outcome || undefined,
    geography: form.geography || undefined,
    naming_style: form.naming_style || undefined,
    description: form.description || undefined,
  };
  if (activeCase) {
    return {
      id: activeCase.id,
      case_id: activeCase.case_id,
      suggestion_form: buildStructuredPayload(activeCase),
      count,
      ...identity,
      ...refinements,
    };
  }
  return {
    molecule: form.molecule || undefined,
    therapeutic_area: form.therapeutic_area || undefined,
    ailment: form.ailment || undefined,
    product_attributes: form.product_attributes || undefined,
    count,
    ...identity,
    ...refinements,
  };
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AIGeneratorPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { setActiveCase: setTopBarCase } = useActiveCase();
  const [form, setForm] = useState(() => loadPersisted('pharma_gen_form', DEFAULT_FORM));
  const [cachedResults, setCachedResults] = useState<GeneratedName[]>(() =>
    loadPersisted('pharma_gen_results', [])
  );
  const cart = useCart();
  const [selectedName, setSelectedName] = useState<GeneratedName | null>(null);
  const [shortlisted, setShortlisted] = useState<Set<string>>(new Set());
  const [cartSelection, setCartSelection] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'risk_asc' | 'risk_desc' | 'availability' | 'memorability'>('risk_asc');
  const [filterStatus, setFilterStatus] = useState<'all' | 'recommended' | 'review_required' | 'high_risk'>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Which case was linked/created — survives a remount (navigating away and
  // back, or a reload) the same way the generated results themselves already
  // do via pharma_gen_results. Without this, activeCase silently reset to
  // null on remount while the results stayed visible, so a later "Add to
  // Review Batch" click would still succeed but attach no case — an entry
  // Review Batch can't group or act on ("these names have no case attached").
  const GEN_CASE_STORAGE_KEY = 'pharma_gen_active_case_id';
  const initialCaseId = (() => {
    try { return localStorage.getItem(GEN_CASE_STORAGE_KEY) || ''; } catch { return ''; }
  })();
  const initialCase = initialCaseId ? getCase(initialCaseId) ?? null : null;
  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialCase?.case_id ?? '');
  // Full record for the currently-loaded Suggestion Form case (if any) — kept
  // alongside selectedCaseId so the mutation can attach the complete,
  // structured intake JSON to the generate request, not just the few fields
  // mapped into this page's own form.
  const [activeCase, setActiveCase] = useState<BrandCase | null>(initialCase);
  // The case actually tied to `cachedResults` — deliberately separate from
  // `activeCase`, which tracks whatever is picked in the Link/Create Case
  // panel right now. Without this, browsing a different case in that panel
  // after generating (without regenerating) silently relabeled the case
  // badge above the already-generated results, and would attach the wrong
  // case to anything added to the review batch from them. Only updated on a
  // successful generation (see mutation.onSuccess + pendingCaseRef below),
  // never by just changing the Link a Case selector.
  const [resultsCase, setResultsCase] = useState<BrandCase | null>(
    cachedResults.length > 0 ? initialCase : null
  );
  const pendingCaseRef = useRef<BrandCase | null>(null);
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [showViewCaseModal, setShowViewCaseModal] = useState(false);
  // Collapsed once results land (so results get the full-width tab); forced
  // open again whenever there are no results to show yet. Starts collapsed
  // if results were already restored from localStorage on load.
  const [panelCollapsed, setPanelCollapsed] = useState(() => cachedResults.length > 0);
  const router = useRouter();
  const autoCaseRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [streamStepIndex, setStreamStepIndex] = useState<number | undefined>(undefined);
  const [streamPercent, setStreamPercent] = useState<number | undefined>(undefined);
  const [streamSubtitle, setStreamSubtitle] = useState<string | undefined>(undefined);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    mutation.reset();
    setStreamStepIndex(undefined);
    setStreamPercent(undefined);
    setStreamSubtitle(undefined);
    toast.info('Generation cancelled by user');
  };

  const mutation = useMutation({
    // Pass an explicit request to bypass form state (used when auto-generating
    // from a case on redirect, or right after Create a Case, where form state
    // hasn't settled yet).
    mutationFn: async (override?: Parameters<typeof apiClient.generateBrandNames>[0]) => {
      const payload = override ?? buildGeneratePayload(form, activeCase, user);
      setStreamStepIndex(0);
      setStreamPercent(15);
      setStreamSubtitle(undefined);
      const controller = new AbortController();
      abortControllerRef.current = controller;
      return await apiClient.generateBrandNamesStream(
        payload,
        (evt) => {
          if (evt.step_index !== undefined) setStreamStepIndex(evt.step_index);
          if (evt.percent !== undefined) setStreamPercent(evt.percent);
          if (evt.subtitle) setStreamSubtitle(evt.subtitle);
        },
        controller.signal
      );
    },
    onSuccess: (data) => {
      // Snapshotted at click-time (see pendingCaseRef writes below), not
      // read live here — activeCase could have already moved on to a
      // different linked case by the time this resolves.
      setResultsCase(pendingCaseRef.current);
      setCachedResults(data);
      setShortlisted(new Set());
      setCartSelection(new Set());
      setPanelCollapsed(true);
      setStreamStepIndex(undefined);
      setStreamPercent(undefined);
      setStreamSubtitle(undefined);
      localStorage.setItem('pharma_gen_results', JSON.stringify(data));

      // Every one of these names was just screened as part of this exact
      // generate call, so compareBrand resolves from generator_history
      // (a cheap DB read, no LLM, no fresh pipeline) in well under a second.
      // Warming the query cache with that now — instead of waiting for the
      // user to open a name's Detailed Analysis modal — means the modal
      // finds the data already sitting in cache and shows results
      // immediately, rather than animating the 5-stage pipeline for data
      // that was, in effect, already computed the moment Generate Names
      // was clicked.
      data.forEach((n) => {
        qc.prefetchQuery({
          queryKey: ['screening', n.generated_name],
          queryFn: () => apiClient.compareBrand({ brand_name: n.generated_name }),
          staleTime: 10 * 60 * 1000,
        });
        qc.prefetchQuery({
          queryKey: ['intelligence', n.generated_name],
          queryFn: () => apiClient.getBrandIntelligence(n.generated_name),
        });
      });
    },
    onError: () => {
      setStreamStepIndex(undefined);
      setStreamPercent(undefined);
      setStreamSubtitle(undefined);
    },
  });

  const cartRiskLevel = (n: GeneratedName) =>
    n.recommendation_status === 'high_risk' ? 'HIGH'
      : n.recommendation_status === 'review_required' ? 'MEDIUM' : 'LOW';

  const updateForm = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    localStorage.setItem('pharma_gen_form', JSON.stringify(next));
  };

  // Silently restores the top-bar case chip on remount — no toast, mirrors
  // the same pattern already used on Brand Analysis and Compare Names.
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

  const applyCase = (c: BrandCase | null) => {
    setSelectedCaseId(c?.case_id ?? '');
    setActiveCase(c);
    try {
      if (c) localStorage.setItem(GEN_CASE_STORAGE_KEY, c.case_id);
      else localStorage.removeItem(GEN_CASE_STORAGE_KEY);
    } catch { /* ignore */ }
    if (!c) {
      setTopBarCase(null);
      return;
    }
    updateForm({
      molecule: c.generic_name || '',
      therapeutic_area: c.therapy || c.segment || '',
      ailment: c.ailment || '',
      product_attributes: c.promoting_indications || '',
    });
    setTopBarCase({
      caseId: c.case_id,
      createdBy: c.suggested_by || 'Unknown',
      createdAt: formatDate(c.saved_at),
    });
  };

  // Create a Case modal's "Generate Names" — the modal has already saved the
  // case to the backend; apply it here exactly like Link a Case does, fold in
  // the naming-criteria fields collected in the modal, then fire generation
  // immediately with an explicit payload (state from applyCase/updateForm
  // hasn't necessarily settled yet, so this builds the request directly
  // instead of relying on `form`/`activeCase` state).
  const handleCaseCreated = ({ caseRecord, namingCriteria }: CreateCaseResult) => {
    applyCase(caseRecord);
    setShowCreateCase(false);
    const request = buildGeneratePayload(
      { ...DEFAULT_FORM, ...namingCriteria },
      caseRecord,
      user,
    );
    pendingCaseRef.current = caseRecord;
    mutation.mutate(request);
  };

  // Auto-load (but do NOT auto-generate) when redirected from the
  // Suggestion Form with ?case=<id>.
  useEffect(() => {
    if (!router.isReady) return;
    const caseId = typeof router.query.case === 'string' ? router.query.case : undefined;
    if (!caseId || autoCaseRef.current === caseId) return;
    const localCase = getCase(caseId);
    if (localCase) {
      autoCaseRef.current = caseId;
      applyCase(localCase);
      router.replace('/generator', undefined, { shallow: true });
    } else {
      apiClient.listSuggestions().then((suggestions) => {
        const found = suggestions.find((s) => s.case_id === caseId);
        if (found) {
          const cached = cacheFromBackend(found);
          autoCaseRef.current = caseId;
          applyCase(cached);
          router.replace('/generator', undefined, { shallow: true });
        }
      }).catch(() => { });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.case]);

  const toggleCartSelection = (id: string) => {
    setCartSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addSelectedToCart = async () => {
    // resultsCase (not activeCase) — these names were generated under
    // whichever case was linked at generation time, not whatever's currently
    // sitting in the Link a Case panel.
    if (!resultsCase) {
      toast.error('Link or create a case first, every review batch entry needs a case attached.');
      return;
    }
    const selected = results.filter(n => cartSelection.has(n.id));
    const picked = selected.filter(n => !cart.isSubmitted(n.generated_name));
    const skippedSubmitted = selected.length - picked.length;
    const outcomes = await Promise.all(picked.map(n => cart.add({
      brand_name: n.generated_name,
      source_type: 'generated',
      generated_name_id: n.id,
      therapeutic_area: n.therapeutic_area,
      risk_score: n.risk_score,
      risk_level: cartRiskLevel(n),
      // This bulk path has no fresh screening result to draw from (unlike
      // the single-name detail dialog) — the name's own already-generated
      // rationale is the only source, but it's always present.
      risk_ai_assessment: n.ai_explanation || undefined,
      case_id: resultsCase?.case_id,
      case_name: resultsCase ? caseDisplayName(resultsCase) : undefined,
    })));
    const added = outcomes.filter(Boolean).length;
    if (added > 0) {
      toast.success(
        `${added} name(s) added to review batch` +
        (skippedSubmitted > 0 ? ` (${skippedSubmitted} already submitted for Trademark Review, skipped)` : '')
      );
    } else if (skippedSubmitted > 0) {
      toast.info('Selected name(s) were already submitted for Trademark Review');
    } else {
      toast.info('Selected name(s) are already in your review batch');
    }
    setCartSelection(new Set());
  };

  const handleClear = () => {
    setForm(DEFAULT_FORM);
    setCachedResults([]);
    setShortlisted(new Set());
    setCartSelection(new Set());
    setSelectedName(null);
    setSortBy('risk_asc');
    setFilterStatus('all');
    setCollapsedGroups(new Set());
    setSelectedCaseId('');
    setActiveCase(null);
    setResultsCase(null);
    setTopBarCase(null);
    setPanelCollapsed(false);
    mutation.reset();
    localStorage.removeItem('pharma_gen_form');
    localStorage.removeItem('pharma_gen_results');
    toast.success('Cleared, starting fresh');
  };

  // While a new generation is running, don't fall back to the previous
  // batch's cachedResults — that stale list would render below the pipeline
  // panel at the same time, looking like results the in-progress run had
  // already produced.
  const results = mutation.isPending ? [] : (mutation.data ?? cachedResults);
  // Ignore a stale `true` if results were cleared out from under the panel.
  const isPanelCollapsed = panelCollapsed && results.length > 0;
  const recommended = results.filter((n) => n.recommendation_status === 'recommended');
  const review = results.filter((n) => n.recommendation_status === 'review_required');
  const highRisk = results.filter((n) => n.recommendation_status === 'high_risk');
  const shortlistedNames = results.filter(n => shortlisted.has(n.id));

  const filteredResults = filterStatus === 'all' ? results : results.filter(n => n.recommendation_status === filterStatus);
  const sortedResults = [...filteredResults].sort((a, b) => {
    if (sortBy === 'risk_asc') return a.risk_score - b.risk_score;
    if (sortBy === 'risk_desc') return b.risk_score - a.risk_score;
    if (sortBy === 'availability') return b.availability_score - a.availability_score;
    return b.memorability_score - a.memorability_score;
  });
  const cardGroups = [
    { key: 'recommended', label: 'Recommended', Icon: CheckCircle, color: 'green', items: sortedResults.filter(n => n.recommendation_status === 'recommended') },
    { key: 'review_required', label: 'Medium', Icon: AlertTriangle, color: 'orange', items: sortedResults.filter(n => n.recommendation_status === 'review_required') },
  ].filter(g => g.items.length > 0);

  return (
    <div className="min-h-screen bg-[#fffaf5]">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="gap-1.5 text-xs text-gray-500 hover:text-orange-600 -ml-2"
              title="Go back to previous page"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-orange-600" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Name Generator</h1>
              <p className="text-gray-500 text-sm">Product intake, captured before brand name screening and generation</p>
            </div>
            <Button
              variant="outline"
              className="gap-2 text-gray-600 border-gray-200 hover:border-orange-400 hover:text-orange-600 flex-shrink-0"
              onClick={handleClear}
              disabled={mutation.isPending}
              title="Reset the form and clear generated names"
            >
              <RotateCcw className="w-4 h-4" /> Clear
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Collapse toggle — only meaningful once there are results to make room for */}
        {results.length > 0 && (
          <button
            onClick={() => setPanelCollapsed((c) => !c)}
            className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-orange-600 border border-gray-200 hover:border-orange-300 rounded-lg px-3 py-1.5 bg-white transition-colors"
          >
            {isPanelCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            {isPanelCollapsed ? 'Show Case Form' : 'Hide Case Form'}
          </button>
        )}
        <div className={cn('grid grid-cols-1 gap-6', !isPanelCollapsed && 'lg:grid-cols-3')}>
          {/* Generation Parameters Panel */}
          {!isPanelCollapsed && (
            <div className="lg:col-span-1 space-y-4 lg:sticky lg:top-6 self-start">
              {/* Brand Suggestion Form — Create a Case or Link an existing one */}
              <Card className="overflow-hidden">
                <div className="px-6 py-4 space-y-3">
                  <span className="text-sm flex items-center gap-2 text-gray-700 uppercase tracking-wide font-semibold">
                    <FileText className="w-4 h-4 text-orange-600" />
                    Brand Suggestion Form
                  </span>
                  <div>
                    <Button className="w-full gap-1.5" onClick={() => setShowCreateCase(true)}>
                      <FileText className="w-4 h-4" /> Create a Case
                    </Button>
                    <p className="text-xs text-gray-400 mt-1.5">Create a new case to start your AI brand name generation</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="flex-1 h-px bg-gray-100" /> or <div className="flex-1 h-px bg-gray-100" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <Link2 className="w-4 h-4 text-orange-500" /> Link a Case
                      </div>
                      {selectedCaseId && (
                        <button
                          type="button"
                          onClick={() => applyCase(null)}
                          aria-label="Remove linked case"
                          title="Remove linked case"
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <CaseSelector value={selectedCaseId} onSelect={applyCase} />
                    {selectedCaseId && (
                      <div className="mt-1.5 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setShowViewCaseModal(true)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                        >
                          <Eye className="w-3.5 h-3.5" /> View Form Details
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-1.5">
                      {selectedCaseId
                        ? <>Parameters prefilled from <span className="font-mono text-orange-600">{selectedCaseId}</span></>
                        : 'Select an existing case to continue brand name generation'}
                    </p>
                  </div>
                </div>
              </Card>

              {/* Knockout Rules Reminder */}
              <StaticInfoCard
                title="Knockout Rules"
                icon={<AlertTriangle className="w-4 h-4 text-orange-600" />}
              >
                <p className="text-xs text-gray-400 -mt-1 mb-1.5">
                  The platform validates generated brand names against the following references to ensure the proposed names are distinctive and do not directly copy or closely resemble:
                </p>
                <ul className="text-xs text-orange-700 space-y-1.5">
                  {[
                    'Molecule or INN stems',
                    'Disease, ailment, or organ names',
                    'Chemical or compound names',
                    'Existing brand names',
                    'Existing brand names with significant prefix or suffix similarities',
                  ].map((rule, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-orange-400 mt-0.5">·</span>{rule}
                    </li>
                  ))}
                </ul>
              </StaticInfoCard>

              {/* Reference Sources */}
              <StaticInfoCard
                title="Reference Sources"
                icon={<Database className="w-4 h-4 text-orange-600" />}
              >
                <p className="text-xs text-gray-400 -mt-1 mb-1.5">
                  The platform validates and screens brand names using the following reference sources:
                </p>
                <ul className="text-xs text-orange-700 space-y-1.5">
                  {[
                    'WHO INN',
                    'IQVIA Database',
                    'E-Pharmacy Platforms',
                    'Google Search',
                  ].map((src, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-orange-400 mt-0.5">·</span>{src}
                    </li>
                  ))}
                </ul>
              </StaticInfoCard>

              {/* Generate / Regenerate Names — below all the boxes, always visible */}
              <div>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => { pendingCaseRef.current = activeCase; mutation.mutate(undefined); }}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Generating...</>
                  ) : activeCase || selectedCaseId ? (
                    <><Sparkles className="w-4 h-4 mr-2" /> Regenerate Names</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-2" /> Generate Names</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Results — the fixed max-height + own scrollbar only makes sense
              once this column is full-width (isPanelCollapsed) with nothing
              beside it to match. Side-by-side with the case form, it should
              just grow with its content like that column does, so the two
              stay level and the page scrolls as one instead of the results
              column getting stuck half-height with its own inner scroll. */}
          <div className={cn(
            'space-y-4',
            isPanelCollapsed ? 'overflow-y-auto max-h-[calc(100vh-140px)] pr-2' : 'lg:col-span-2'
          )}>
            {(mutation.isPending || mutation.isError) && (
              <GenerationProgress
                isGenerating={mutation.isPending}
                activeStepIndex={streamStepIndex}
                activePercent={streamPercent}
                activeSubtitle={streamSubtitle}
                onStop={handleStopGeneration}
                error={
                  mutation.isError
                    ? describeGenerationFailure(
                      (mutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                    )
                    : null
                }
                moleculeName={form.molecule || activeCase?.generic_name}
              />
            )}

            {!mutation.isPending && !mutation.isError && results.length === 0 && (
              <div className="flex flex-col items-center justify-center h-80 text-center gap-4">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
                  <Brain className="w-8 h-8 text-gray-300" />
                </div>
                <div>
                  <p className="font-semibold text-gray-500 mb-1">No names generated yet</p>
                  <p className="text-sm text-gray-400">Fill in the product details and naming criteria, then click Generate Names</p>
                </div>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-4">
                {/* Summary bar */}
                <div className="flex items-center gap-3 flex-wrap p-4 bg-white rounded-xl border border-gray-100">
                  <div className="flex-1 min-w-[180px]">
                    <p className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                      {results.length} names generated
                      {resultsCase && (
                        <span
                          className="text-xs font-bold text-orange-700 bg-orange-100 border border-orange-300 rounded-full px-2.5 py-1 inline-block max-w-[280px] truncate align-bottom"
                          title={caseDisplayName(resultsCase)}
                        >
                          Case: {caseDisplayName(resultsCase)}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-400">
                      {shortlisted.size > 0
                        ? <><Star className="w-3.5 h-3.5 text-orange-500 inline mr-1" />{shortlisted.size}/{MAX_SHORTLIST} shortlisted for download</>
                        : 'Tick names to add to the review batch · Star to shortlist for download · Click a name for details'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex gap-3">
                      <div className="text-center">
                        <p className="text-xl font-bold text-green-600">{recommended.length}</p>
                        <p className="text-xs text-gray-400">Recommended</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-orange-500">{review.length}</p>
                        <p className="text-xs text-gray-400">Review</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-red-500">{highRisk.length}</p>
                        <p className="text-xs text-gray-400">High Risk</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 text-gray-600 border-gray-200 hover:border-orange-400 hover:text-orange-600"
                      onClick={() => downloadBulkNamesReport(
                        results.filter(n => n.recommendation_status !== 'high_risk'),
                        { molecule: form.molecule, therapeutic_area: form.therapeutic_area, geography: form.geography },
                      )}>
                      <Download className="w-4 h-4" /> Download All
                    </Button>
                  </div>
                </div>

                {/* Cart selection action bar (checkbox-driven) */}
                {cartSelection.size > 0 && (
                  <div className="flex items-center justify-between gap-2 flex-wrap bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <ShoppingCart className="w-4 h-4 text-purple-600 flex-shrink-0" />
                      <span className="text-sm font-semibold text-purple-800 whitespace-nowrap">
                        {cartSelection.size} name{cartSelection.size > 1 ? 's' : ''} selected
                      </span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0 flex-wrap">
                      <Button size="sm" variant="outline" className="border-gray-300 text-gray-600 hover:bg-gray-100"
                        onClick={() => setCartSelection(new Set())}>
                        Clear
                      </Button>
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
                        disabled={!resultsCase}
                        title={!resultsCase ? 'Link or create a case first' : undefined}
                        onClick={addSelectedToCart}>
                        <ShoppingCart className="w-3.5 h-3.5" /> Add {cartSelection.size} to Review Batch
                      </Button>
                    </div>
                  </div>
                )}

                {/* Shortlist action bar */}
                {shortlisted.size > 0 && (
                  <div className="flex items-center justify-between gap-2 flex-wrap bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Star className="w-4 h-4 text-orange-500 fill-orange-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-orange-800 whitespace-nowrap">
                        {shortlisted.size} of {MAX_SHORTLIST} names shortlisted
                      </span>
                      <span className="text-xs text-orange-600 truncate max-w-[240px] sm:max-w-none">
                        {shortlistedNames.map(n => n.generated_name).join(', ')}
                      </span>
                    </div>
                    <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100 gap-1.5 flex-shrink-0"
                      onClick={() => downloadBulkNamesReport(shortlistedNames, { molecule: form.molecule, therapeutic_area: form.therapeutic_area, geography: form.geography })}>
                      <Download className="w-3.5 h-3.5" /> Download
                    </Button>
                  </div>
                )}

                {/* Sort & Filter Bar */}
                <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border border-gray-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Sort by</span>
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                      <SelectTrigger className="h-8 text-xs w-52">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="risk_asc">Risk Score: Low to Medium</SelectItem>
                        <SelectItem value="risk_desc">Risk Score: Medium to Low</SelectItem>
                        <SelectItem value="availability">Availability: Best first</SelectItem>
                        <SelectItem value="memorability">Memorability: Best first</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-px h-5 bg-gray-200 hidden sm:block" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Show</span>
                    <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
                      <SelectTrigger className="h-8 text-xs w-52">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All names ({recommended.length + review.length})</SelectItem>
                        <SelectItem value="recommended">Recommended only ({recommended.length})</SelectItem>
                        <SelectItem value="review_required">Review Required only ({review.length})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Grouped Name Cards */}
                <div className="space-y-3">
                  {cardGroups.map((group) => {
                    const isCollapsed = collapsedGroups.has(group.key);
                    const { Icon } = group;
                    const headerCls = group.color === 'green'
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : group.color === 'orange'
                        ? 'bg-orange-50 border-orange-200 text-orange-800'
                        : 'bg-red-50 border-red-200 text-red-800';
                    const iconCls = group.color === 'green' ? 'text-green-600' : group.color === 'orange' ? 'text-orange-500' : 'text-red-600';
                    const badgeCls = group.color === 'green'
                      ? 'bg-green-100 text-green-800'
                      : group.color === 'orange'
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-red-100 text-red-800';
                    const borderAccent = group.color === 'green' ? 'border-l-green-500' : group.color === 'orange' ? 'border-l-orange-400' : 'border-l-red-500';

                    return (
                      <div key={group.key} className="rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                        {/* Section header */}
                        <button
                          className={cn('w-full flex items-center justify-between px-4 py-3 border-b', headerCls)}
                          onClick={() => setCollapsedGroups(prev => {
                            const next = new Set(prev);
                            if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                            return next;
                          })}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className={cn('w-4 h-4', iconCls)} />
                            <span className="text-sm font-semibold">{group.label}</span>
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-bold', badgeCls)}>{group.items.length}</span>
                          </div>
                          <ChevronDown className={cn('w-4 h-4 transition-transform duration-200', iconCls, isCollapsed && '-rotate-90')} />
                        </button>

                        {/* Cards grid */}
                        {!isCollapsed && (
                          <div className="p-3 bg-gray-50/40 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {group.items.map((name) => (
                              <div
                                key={name.id}
                                className={cn(
                                  'relative bg-white rounded-xl border-l-4 border border-gray-100 p-4 transition-all group',
                                  borderAccent,
                                  cartSelection.has(name.id) ? 'shadow-md ring-1 ring-purple-300'
                                    : shortlisted.has(name.id) ? 'shadow-md ring-1 ring-orange-200'
                                      : 'hover:shadow-md hover:border-gray-200'
                                )}
                              >
                                {/* Cart select checkbox */}
                                <label
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}
                                  role="button"
                                  tabIndex={0}
                                  className="absolute top-3 left-3 z-10 flex items-center cursor-pointer"
                                  title={
                                    cart.isSubmitted(name.generated_name) ? 'Already submitted for Trademark Review'
                                      : cartSelection.has(name.id) ? 'Remove from selection'
                                        : 'Select to add to review batch'
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={cartSelection.has(name.id)}
                                    disabled={cart.isSubmitted(name.generated_name)}
                                    onChange={() => toggleCartSelection(name.id)}
                                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                  />
                                </label>

                                <button className="text-left w-full" onClick={() => setSelectedName(name)}>
                                  {/* Name + area */}
                                  <div className="pl-7 pr-8 mb-2">
                                    <p className="text-base font-bold text-gray-900 group-hover:text-orange-600 transition-colors leading-tight">
                                      {name.generated_name}
                                    </p>
                                    {name.therapeutic_area && (
                                      <p className="text-xs text-gray-400 mt-0.5">{name.therapeutic_area}</p>
                                    )}
                                  </div>

                                  {/* Coining Principle Badges */}
                                  {(name.coining_principles || (name.conflict_details as any)?.coining_principles) && (
                                    <div className="flex flex-wrap gap-1 mb-2.5">
                                      {((name.coining_principles || (name.conflict_details as any)?.coining_principles) as string[]).slice(0, 2).map((cp: string, idx: number) => (
                                        <span key={idx} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm bg-orange-50 text-orange-800 border border-orange-200 truncate max-w-full">
                                          {cp}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {/* 4 mini score badges */}
                                  <div className="grid grid-cols-4 gap-1 mb-3">
                                    <div className={cn('rounded-lg border px-1 py-1.5 text-center', name.risk_score < 30 ? 'bg-green-50 text-green-700 border-green-200' : name.risk_score < 60 ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-red-50 text-red-700 border-red-200')}>
                                      <p className="text-xs font-bold leading-none">{name.risk_score.toFixed(0)}</p>
                                      <p className="text-[10px] mt-0.5 opacity-70">Risk</p>
                                    </div>
                                    <div className={cn('rounded-lg border px-1 py-1.5 text-center', name.availability_score >= 70 ? 'bg-green-50 text-green-700 border-green-200' : name.availability_score >= 40 ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-red-50 text-red-700 border-red-200')}>
                                      <p className="text-xs font-bold leading-none">{name.availability_score.toFixed(0)}</p>
                                      <p className="text-[10px] mt-0.5 opacity-70">Avail</p>
                                    </div>
                                    <div className="rounded-lg border px-1 py-1.5 text-center bg-blue-50 text-blue-700 border-blue-200">
                                      <p className="text-xs font-bold leading-none">{name.memorability_score.toFixed(0)}</p>
                                      <p className="text-[10px] mt-0.5 opacity-70">Mem.</p>
                                    </div>
                                    <div className="rounded-lg border px-1 py-1.5 text-center bg-purple-50 text-purple-700 border-purple-200">
                                      <p className="text-xs font-bold leading-none">{name.pronunciation_score.toFixed(0)}</p>
                                      <p className="text-[10px] mt-0.5 opacity-70">Pron.</p>
                                    </div>
                                  </div>

                                  {/* Risk progress bar */}
                                  <div className="space-y-1 mb-3">
                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span className="flex items-center gap-1"><Shield className="w-3 h-3" />Risk</span>
                                      <span className={cn('font-semibold',
                                        name.recommendation_status === 'recommended' ? 'text-green-600'
                                          : name.recommendation_status === 'review_required' ? 'text-orange-500'
                                            : 'text-red-600')}>
                                        {name.risk_score.toFixed(0)}
                                      </span>
                                    </div>
                                    {/* Colored by recommendation_status, not a separate score threshold —
                                        otherwise a name sitting near a boundary (e.g. 63, still
                                        "review_required" up to 65) could show red here while the
                                        section it's actually grouped under still says "Review Required". */}
                                    <Progress value={name.risk_score} className="h-1.5"
                                      indicatorClassName={
                                        name.recommendation_status === 'recommended' ? 'bg-green-500'
                                          : name.recommendation_status === 'review_required' ? 'bg-orange-400'
                                            : 'bg-red-500'
                                      } />
                                  </div>

                                  {/* Status + trademark */}
                                  <div className="pt-3 border-t border-gray-50 flex items-center justify-between gap-2 flex-wrap">
                                    <span className={cn('text-xs px-2 py-1 rounded-full border font-medium', getRecommendationColor(name.recommendation_status))}>
                                      {getRecommendationLabel(name.recommendation_status)}
                                    </span>
                                    {name.trademark_availability && (
                                      <span className="text-xs text-gray-400 flex items-center gap-1 min-w-0">
                                        <Shield className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate">{name.trademark_availability}</span>
                                      </span>
                                    )}
                                  </div>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cardGroups.length === 0 && (
                    <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
                      No names match the selected filter.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedName && (
        <NameDetailModal
          name={selectedName}
          open={!!selectedName}
          onClose={() => setSelectedName(null)}
          activeCase={resultsCase}
        />
      )}

      <CreateCaseModal
        open={showCreateCase}
        onClose={() => setShowCreateCase(false)}
        onSuccess={handleCaseCreated}
        suggestedBy={user?.full_name}
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
