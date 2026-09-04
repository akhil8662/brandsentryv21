import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle, Shield, Globe, ShoppingCart, BarChart2, Brain,
  ChevronRight, ChevronDown, ChevronUp, Eye, Volume2, Pen, Target,
  AlertCircle, GitCompare, XCircle, FlaskConical, ListChecks, MinusCircle, Database,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiClient } from '@/api/client';
import { cn, getRiskBgColor, getRiskLevelHexColor, getSourceBadgeStyle } from '@/lib/utils';
import type { ScreeningResult, BrandIntelligence } from '@/types';

// Every block here is shared between Brand Analysis's full-page results and
// AI Name Generator's per-name "Detailed Analysis" modal, so both surfaces
// stay pixel-identical instead of drifting — see Sun_Pharma_Screens_V1.2.pptx
// slides 8 and 10.

// ─── Risk Gauge ────────────────────────────────────────────────────────────────

export function RiskGauge({ score, level }: { score: number; level: string }) {
  const color = getRiskLevelHexColor(level);
  const size = 128;
  const cx = size / 2;
  const cy = size / 2;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score, 0), 100) / 100;
  const dash = circ * pct;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="11" />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="11"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold" style={{ color }}>{Math.round(score)}</span>
          <span className="text-[10px] text-gray-500">out of 100</span>
        </div>
      </div>
      <div className={cn('px-3 py-1 rounded-full text-xs font-bold border mt-1', getRiskBgColor(level))}>
        {level} RISK
      </div>
    </div>
  );
}

// ─── Risk Assessment Banner ─────────────────────────────────────────────────────

export function RiskAssessmentBanner({ sr, brandName }: { sr: ScreeningResult; brandName: string }) {
  const allConflicts = sr.conflicts || [];
  const allSimilarNames = (sr.similar_names || []).filter(sn => sn.similarity_type !== 'Sound-Alike');
  const uniqueSimilarNames = Array.from(
    new Map(allSimilarNames.map(sn => [sn.name.toLowerCase(), sn])).values()
  );

  return (
    <div className={cn('rounded-2xl border-2 p-4', getRiskBgColor(sr.risk_classification))}>
      <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
        <RiskGauge score={sr.overall_risk_score} level={sr.risk_classification} />
        <div className="flex-1">
          <h2 className="text-base font-bold text-gray-900 mb-0.5">
            Risk Assessment: "{brandName}"
          </h2>
          <p className="text-sm text-gray-600 mb-2.5">
            {sr.ai_recommendation === 'REJECT'
              ? 'Significant conflicts found, do not proceed without legal clearance.'
              : sr.ai_recommendation === 'LEGAL_REVIEW'
              ? 'Legal review and trademark clearance recommended before proceeding.'
              : 'Minimal conflicts detected. Standard due diligence recommended.'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Total Conflicts', value: allConflicts.length },
              { label: 'Market', value: sr.market_conflicts },
              { label: 'Similar Names', value: uniqueSimilarNames.length },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/60 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-gray-900">{value}</p>
                <p className="text-[11px] text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2',
          sr.ai_recommendation === 'PROCEED' ? 'bg-green-600 text-white border-green-600' :
          sr.ai_recommendation === 'LEGAL_REVIEW' ? 'bg-orange-500 text-white border-orange-500' :
          'bg-red-600 text-white border-red-600'
        )}>
          {sr.ai_recommendation === 'PROCEED'
            ? <><CheckCircle className="w-3.5 h-3.5" /> Clear to Proceed</>
            : sr.ai_recommendation === 'LEGAL_REVIEW'
            ? <><AlertTriangle className="w-3.5 h-3.5" /> Legal Review Required</>
            : <><AlertTriangle className="w-3.5 h-3.5" /> Reject / Conflict Found</>}
        </div>
      </div>
    </div>
  );
}

// ─── Expandable Similarity Bar ─────────────────────────────────────────────────

function SimilarityBar({ label, score, icon: Icon, color, matches }: {
  label: string; score: number; icon: React.ElementType; color: string;
  matches: Array<{ name: string; source: string; similarity_score: number; similarity_type: string; manufacturer?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(score * 100);
  const count = matches.length;

  return (
    <div className="border border-transparent rounded-lg hover:border-gray-100 transition-all">
      <button className="w-full flex items-center gap-2 py-1.5 px-1 text-left"
        disabled={count === 0}
        onClick={() => count > 0 && setOpen(o => !o)}>
        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', `bg-${color}-100`)}>
          <Icon className={cn('w-3.5 h-3.5', `text-${color}-600`)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center mb-0.5">
            <span className="text-xs font-medium text-gray-700">{label}</span>
            <div className="flex items-center gap-2">
              <span className={cn('text-sm font-bold', pct >= 70 ? 'text-red-600' : pct >= 40 ? 'text-orange-500' : 'text-green-600')}>
                {pct}%
              </span>
              {count > 0 && (
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{count}</span>
              )}
              {count > 0 && (
                open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              )}
            </div>
          </div>
          <Progress value={pct} className="h-1.5"
            indicatorClassName={pct >= 70 ? 'bg-red-500' : pct >= 40 ? 'bg-orange-400' : 'bg-green-500'} />
        </div>
      </button>
      {open && count > 0 && (
        <div className="mx-1 mb-2 rounded-lg border border-gray-100 overflow-hidden">
          <div className="bg-gray-50 px-3 py-1.5 text-xs text-gray-500 font-medium border-b border-gray-100">
            Matched brands
          </div>
          <div className="divide-y divide-gray-50">
            {matches.map((m, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-white hover:bg-gray-50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-sm text-gray-900">{m.name}</span>
                  {m.manufacturer && <span className="text-xs text-gray-400 truncate">· {m.manufacturer}</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', getSourceBadgeStyle(m.source))}>{m.source}</span>
                  <span className={cn(
                    'text-xs font-bold px-1.5 py-0.5 rounded',
                    m.similarity_score >= 0.7 ? 'text-red-700 bg-red-100' :
                    m.similarity_score >= 0.4 ? 'text-orange-700 bg-orange-100' : 'text-green-700 bg-green-100'
                  )}>
                    {Math.round(m.similarity_score * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Similarity Analysis Card ───────────────────────────────────────────────────

export function SimilarityAnalysisCard({ sr }: { sr: ScreeningResult }) {
  const similarNames = sr.similar_names || [];
  const exactMatches = sr.conflicts
    .filter(c => ['EXACT_MATCH', 'EXACT_MARKET_MATCH'].includes(c.conflict_type))
    .map(c => ({ name: c.conflicting_name, source: c.source, similarity_score: 1, similarity_type: 'Exact Match', manufacturer: c.owner }));

  const phoneticMatches = [
    ...exactMatches,
    ...similarNames.filter(n => n.similarity_type === 'Phonetic'),
  ];
  const spellingMatches = similarNames.filter(n => n.similarity_type === 'Spelling');
  const visualMatches = similarNames.filter(n => n.similarity_type === 'Visual' || n.similarity_type === 'Look-Alike');
  const conceptualMatches = similarNames.filter(n => n.similarity_type === 'Conceptual' || n.similarity_type === 'Semantic');

  const exactScore = exactMatches.length > 0 ? 1 : (sr.exact_match_score || 0);
  const phoneticScore = phoneticMatches.length > 0 ? Math.max(...phoneticMatches.map(m => m.similarity_score)) : (sr.phonetic_similarity_score || 0);
  const spellingScore = spellingMatches.length > 0 ? Math.max(...spellingMatches.map(m => m.similarity_score)) : (sr.spelling_similarity_score || 0);
  const visualScore = visualMatches.length > 0 ? Math.max(...visualMatches.map(m => m.similarity_score)) : (sr.lookalike_score || 0);
  const conceptualScore = conceptualMatches.length > 0 ? Math.max(...conceptualMatches.map(m => m.similarity_score)) : (sr.semantic_similarity_score || 0);

  return (
    <Card>
      <CardHeader className="pb-1.5 pt-4 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart2 className="w-4 h-4 text-orange-600" /> Similarity Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-0">
          <SimilarityBar label="Exact Match" score={exactScore} icon={Target} color="red"
            matches={exactMatches} />
          <SimilarityBar label="Phonetic Similarity" score={phoneticScore} icon={Volume2} color="blue"
            matches={phoneticMatches} />
          <SimilarityBar label="Spelling Similarity" score={spellingScore} icon={Pen} color="purple"
            matches={spellingMatches} />
          <SimilarityBar label="Visual Similarity" score={visualScore} icon={Eye} color="orange"
            matches={visualMatches} />
          <SimilarityBar label="Conceptual Similarity" score={conceptualScore} icon={Brain} color="indigo"
            matches={conceptualMatches} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Conflict Sources Card ──────────────────────────────────────────────────────

type ConflictTileItem = { name: string; source: string; detail?: string };

export function ConflictSourcesCard({ sr }: { sr: ScreeningResult }) {
  const allConflicts = sr.conflicts || [];
  const allSimilarNames = (sr.similar_names || []).filter(sn => sn.similarity_type !== 'Sound-Alike');
  const uniqueSimilarNames = Array.from(
    new Map(allSimilarNames.map(sn => [sn.name.toLowerCase(), sn])).values()
  );

  const [openTile, setOpenTile] = useState<string | null>(null);

  const tiles: Array<{
    key: string; icon: React.ElementType; label: string; count: number; color: string; bg: string; items: ConflictTileItem[];
  }> = [
    {
      key: 'total', icon: Shield, label: 'Total Conflicts', count: allConflicts.length, color: 'purple', bg: 'bg-purple-50 border-purple-100',
      items: allConflicts.map(c => ({ name: c.conflicting_name, source: c.source, detail: c.details })),
    },
    {
      key: 'similar', icon: BarChart2, label: 'Similar Names', count: uniqueSimilarNames.length, color: 'orange', bg: 'bg-orange-50 border-orange-100',
      items: uniqueSimilarNames.map(sn => ({ name: sn.name, source: sn.source, detail: `${Math.round(sn.similarity_score * 100)}% ${sn.similarity_type}` })),
    },
  ];

  const activeTile = tiles.find(t => t.key === openTile) || null;

  return (
    <Card>
      <CardHeader className="pb-1.5 pt-4 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Shield className="w-4 h-4 text-orange-600" /> Conflict Sources
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(({ key, icon: Icon, label, count, color, bg, items }) => (
            <button
              key={key}
              type="button"
              disabled={count === 0}
              onClick={() => setOpenTile(key)}
              className={cn(
                'flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all',
                bg,
                count > 0 ? 'hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-300 cursor-pointer' : 'cursor-default opacity-70',
              )}
            >
              <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', `bg-${color}-100`)}>
                <Icon className={cn('w-4 h-4', `text-${color}-600`)} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold text-gray-900">{count}</p>
                <p className="text-[11px] text-gray-500">{label}</p>
              </div>
              {count > 0 && <Eye className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
            </button>
          ))}
        </div>
        <div className="mt-2.5 p-2.5 bg-gray-50 rounded-lg">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-600">Market Presence Score</span>
            <span className="font-semibold">{Math.round(sr.market_presence_score * 100)}%</span>
          </div>
          <Progress value={sr.market_presence_score * 100} className="h-2"
            indicatorClassName={sr.market_presence_score > 0.6 ? 'bg-red-500' : sr.market_presence_score > 0.3 ? 'bg-orange-400' : 'bg-green-500'} />
        </div>
      </CardContent>

      <Dialog open={openTile !== null} onOpenChange={(o) => !o && setOpenTile(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {activeTile && <activeTile.icon className="w-4 h-4 text-orange-600" />}
              {activeTile?.label} ({activeTile?.count})
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {activeTile?.items.map((it, i) => (
              <div key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{it.name}</p>
                  <p className="text-xs text-gray-400 truncate">{it.source}</p>
                </div>
                {it.detail && <span className="text-xs text-gray-500 flex-shrink-0 max-w-[45%] text-right">{it.detail}</span>}
              </div>
            ))}
            {activeTile && activeTile.items.length === 0 && (
              <p className="text-xs text-gray-400 py-2">No matched items.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Screening Workflow Panel ─────────────────────────────────────────────────

function sourceMatchesStep(stepId: string, source: string): boolean {
  const s = (source || '').trim().toLowerCase();
  switch (stepId) {
    case 'inn':
      return s.includes('who inn') || s.includes('chembl');
    case 'iqvia':
      return s.includes('iqvia');
    case 'trademark':
      return s.includes('trademark') || s.includes('registry');
    case 'epharmacy':
      return (
        s.includes('1mg') ||
        s.includes('pharmeasy') ||
        s.includes('apollo') ||
        s.includes('netmeds') ||
        s.includes('pharmacy') ||
        s.includes('e-pharmacy') ||
        s.endsWith('(india)')
      );
    case 'web':
      return s.includes('google') || s.includes('web search');
    default:
      return false;
  }
}

function humanizeConflictType(t: string): string {
  return (t || '')
    .split('_')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

const SEVERITY_STYLE: Record<string, string> = {
  HIGH:   'bg-red-100 text-red-700 border-red-200',
  MEDIUM: 'bg-orange-100 text-orange-700 border-orange-200',
  LOW:    'bg-yellow-100 text-yellow-700 border-yellow-200',
};
const RISK_STYLE: Record<string, string> = {
  HIGH:   'bg-red-100 text-red-700',
  MEDIUM: 'bg-orange-100 text-orange-700',
  LOW:    'bg-green-100 text-green-700',
};

interface WorkflowStep {
  id: string;
  step: number;
  label: string;
  note: string;
  isKnockout: boolean;
  status: 'fail' | 'warn' | 'pass' | 'info' | 'not_run';
  detail: string;
  icon: React.ElementType;
}

function WorkflowStepDialog({
  step, sr, open, onClose,
}: { step: WorkflowStep | null; sr: ScreeningResult; open: boolean; onClose: () => void }) {
  if (!step) return null;

  const conflicts = sr.conflicts.filter(c => sourceMatchesStep(step.id, c.source));
  const similar = sr.similar_names.filter(sn => sourceMatchesStep(step.id, sn.source));
  const StepIcon = step.icon;
  const hasData = conflicts.length > 0 || similar.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
              <StepIcon className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400">STEP {step.step}</span>
                {step.isKnockout && (
                  <span className="text-[9px] font-bold uppercase bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Knockout Source</span>
                )}
              </div>
              <p className="text-base font-bold text-gray-900 leading-tight">{step.label}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className={cn(
          'rounded-lg border px-4 py-3 flex items-start gap-2',
          step.status === 'fail' ? 'bg-red-50 border-red-200'
            : step.status === 'warn' ? 'bg-orange-50 border-orange-200'
            : step.status === 'info' || step.status === 'not_run' ? 'bg-gray-50 border-gray-200'
            : 'bg-green-50 border-green-200',
        )}>
          {step.status === 'fail' ? <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            : step.status === 'warn' ? <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
            : step.status === 'not_run' ? <MinusCircle className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            : <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />}
          <div>
            <p className="text-sm font-semibold text-gray-800">{step.detail}</p>
            <p className="text-xs text-gray-500 mt-0.5">{step.note}</p>
          </div>
        </div>

        {step.status === 'not_run' ? (
          <div className="py-8 text-center">
            <MinusCircle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-700">This check was not run</p>
            <p className="text-xs text-gray-400 mt-1">
              The pipeline stopped at an earlier stage before reaching this source, so no data was
              gathered here — this is not the same as a clean result.
            </p>
          </div>
        ) : (
        <>
        {conflicts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              Conflicts ({conflicts.length})
            </p>
            {conflicts.map((c, i) => (
              <div key={c.id || i} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900">{c.conflicting_name}</p>
                    <span className="text-[11px] text-gray-500">{humanizeConflictType(c.conflict_type)}</span>
                  </div>
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0',
                    SEVERITY_STYLE[c.severity] || SEVERITY_STYLE.MEDIUM)}>
                    {c.severity}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {c.owner && (
                    <div>
                      <p className="text-[10px] uppercase text-gray-400 font-semibold">Owner / Manufacturer</p>
                      <p className="text-gray-700 font-medium">{c.owner}</p>
                    </div>
                  )}
                  {c.registration_number && (
                    <div>
                      <p className="text-[10px] uppercase text-gray-400 font-semibold">Registration No.</p>
                      <p className="text-gray-700 font-medium font-mono">{c.registration_number}</p>
                    </div>
                  )}
                  {c.status && (
                    <div>
                      <p className="text-[10px] uppercase text-gray-400 font-semibold">Status</p>
                      <p className="text-gray-700 font-medium">{c.status}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase text-gray-400 font-semibold">Source</p>
                    <p className="text-gray-700 font-medium">{c.source}</p>
                  </div>
                </div>
                {c.details && (
                  <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
                    {c.details}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {similar.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <GitCompare className="w-3.5 h-3.5 text-indigo-500" />
              {step.id === 'epharmacy' ? 'Listings' : step.id === 'web' ? 'Web References' : 'Similar / Related Names'} ({similar.length})
            </p>
            {similar.map((sn, i) => (
              <div key={sn.id || i} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-gray-900">{sn.name}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', getSourceBadgeStyle(sn.source))}>
                      {sn.source}
                    </span>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                      RISK_STYLE[sn.risk_level] || RISK_STYLE.LOW)}>
                      {sn.risk_level} RISK
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full',
                        sn.similarity_score >= 0.85 ? 'bg-red-500'
                          : sn.similarity_score >= 0.6 ? 'bg-orange-400' : 'bg-green-500')}
                      style={{ width: `${Math.round(sn.similarity_score * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-10 text-right">
                    {Math.round(sn.similarity_score * 100)}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span><span className="text-gray-400">Type:</span> {sn.similarity_type}</span>
                  {sn.manufacturer && <span><span className="text-gray-400">Mfr:</span> {sn.manufacturer}</span>}
                  {sn.therapeutic_area && <span><span className="text-gray-400">Area:</span> {sn.therapeutic_area}</span>}
                  {sn.country && <span><span className="text-gray-400">Country:</span> {sn.country}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasData && (
          <div className="py-8 text-center">
            <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-700">No conflicts or matches from this source</p>
            <p className="text-xs text-gray-400 mt-1">
              {step.id === 'web'
                ? `Market presence index: ${Math.round(sr.market_presence_score * 100)}%, based on aggregate web signals.`
                : 'This data source returned a clean result for the screened name.'}
            </p>
          </div>
        )}
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ScreeningWorkflowPanel({ sr, stagesCompleted }: { sr: ScreeningResult; stagesCompleted?: number }) {
  const innKnockout = sr.conflicts.some(c => c.conflict_type === 'INN_KNOCKOUT');
  const innStemMatch = sr.similar_names.some(sn => sn.source === 'WHO INN (ChEMBL)');

  const [openStepId, setOpenStepId] = useState<string | null>(null);

  // The "Google Search" step's percentage only ever reflects genuine
  // Google-sourced hits (see compare.py/brand_screening.py's
  // market_presence_score) — but when GOOGLE_API_KEY/GOOGLE_CSE_ID aren't
  // configured at all, there's nothing being checked, so that's called out
  // explicitly instead of silently showing "0%, Clear" (which would read
  // as "checked, confirmed clean" rather than "never checked").
  const dataSourcesQuery = useQuery({
    queryKey: ['data-sources-status'],
    queryFn: () => apiClient.getDataSources(),
    staleTime: 5 * 60 * 1000,
  });
  const googleSource = dataSourcesQuery.data?.sources.find(s => s.id === 'google_search');
  const googleReady = googleSource?.connected === true;
  // IQVIA shares WHO INN's own backend stage (STAGE_NAMES[1] = "WHO INN &
  // IQVIA Registry Check" — see brand_screening.py) rather than having its
  // own separate pipeline stage, so this card uses step: 1 too instead of
  // its own number — that keeps the stagesCompleted "Not Run" gating below
  // accurate for it (a pipeline that completed Stage 1 checked both).
  const iqviaSource = dataSourcesQuery.data?.sources.find(s => s.id === 'iqvia');
  const iqviaReady = iqviaSource?.connected === true;
  const epharmacySource = dataSourcesQuery.data?.sources.find(s => s.id === 'epharmacy');
  const epharmacyReady = epharmacySource?.connected === true;

  const steps: WorkflowStep[] = [
    {
      id: 'inn',
      step: 1,
      label: 'WHO INN Check',
      note: 'International Non-Proprietary Names, knockout source',
      isKnockout: true,
      status: innKnockout ? 'fail' : innStemMatch ? 'warn' : 'pass',
      detail: innKnockout
        ? 'KNOCKOUT: Name is a registered WHO INN'
        : innStemMatch
        ? 'High similarity to a known INN stem detected'
        : 'No WHO INN conflicts detected',
      icon: FlaskConical,
    },
    {
      id: 'iqvia',
      step: 2,
      label: 'IQVIA Database',
      note: 'Licensed pharma market-intelligence extract',
      isKnockout: false,
      status: !iqviaReady ? 'info' : 'pass',
      detail: !iqviaReady
        ? `Not integrated yet — ${iqviaSource?.detail ?? 'IQVIA extract is not configured.'}`
        : 'IQVIA extract is licensed and verified.',
      icon: Database,
    },
    {
      id: 'epharmacy',
      step: 3,
      label: 'E-Pharmacy Platforms',
      note: '1mg, PharmEasy, Apollo Pharmacy & Netmeds',
      isKnockout: false,
      status: !epharmacyReady
        ? 'info'
        : sr.conflicts.some(c => sourceMatchesStep('epharmacy', c.source))
        ? 'fail'
        : sr.similar_names.some(sn => sourceMatchesStep('epharmacy', sn.source)) || sr.epharmacy_conflicts > 0
        ? 'warn'
        : 'pass',
      detail: !epharmacyReady
        ? `Not integrated yet — ${epharmacySource?.detail ?? 'E-pharmacy platform discovery is not connected.'}`
        : sr.conflicts.some(c => sourceMatchesStep('epharmacy', c.source))
        ? `${sr.conflicts.filter(c => sourceMatchesStep('epharmacy', c.source)).length} conflict(s) detected across 1mg, PharmEasy, Netmeds, Apollo`
        : sr.similar_names.some(sn => sourceMatchesStep('epharmacy', sn.source)) || sr.epharmacy_conflicts > 0
        ? `${sr.similar_names.filter(sn => sourceMatchesStep('epharmacy', sn.source)).length || sr.epharmacy_conflicts} online pharmacy listing(s) found`
        : 'No e-pharmacy conflicts',
      icon: ShoppingCart,
    },
    {
      id: 'web',
      step: 4,
      label: 'Google Search',
      note: 'Google & broader market references',
      isKnockout: false,
      status: !googleReady ? 'info' : sr.market_presence_score > 0.5 ? 'warn' : sr.market_presence_score > 0.2 ? 'info' : 'pass',
      detail: !googleReady
        ? `Not integrated yet — ${googleSource?.detail ?? 'Google Search API is not configured.'}`
        : `Market presence index: ${Math.round(sr.market_presence_score * 100)}%, based on live Google Custom Search results compared against this name.`,
      icon: Globe,
    },
  ];

  const statusConfig = {
    fail: { bg: 'bg-red-50 border-red-200 hover:border-red-300', dot: 'bg-red-500', text: 'text-red-700', label: 'Conflict', icon: XCircle, iconColor: 'text-red-500' },
    warn: { bg: 'bg-orange-50 border-orange-200 hover:border-orange-300', dot: 'bg-orange-400', text: 'text-orange-700', label: 'Review', icon: AlertTriangle, iconColor: 'text-orange-500' },
    pass: { bg: 'bg-green-50 border-green-200 hover:border-green-300', dot: 'bg-green-500', text: 'text-green-700', label: 'Clear', icon: CheckCircle, iconColor: 'text-green-500' },
    info: { bg: 'bg-gray-50 border-gray-200 hover:border-gray-300', dot: 'bg-gray-400', text: 'text-gray-600', label: 'Low', icon: CheckCircle, iconColor: 'text-gray-400' },
    not_run: { bg: 'bg-gray-50 border-gray-200 border-dashed hover:border-gray-300', dot: 'bg-gray-300', text: 'text-gray-400', label: 'Not Run', icon: MinusCircle, iconColor: 'text-gray-300' },
  };

  // A pipeline that stopped early (see brand_screening.py's sequential
  // fail-fast redesign) never actually ran the later stages. The pipeline
  // itself still skips them (no wasted API calls/scrapes), but the card is
  // always shown — just relabeled "Not Run" — instead of disappearing,
  // so it's never confused with a step that ran and came back clean.
  // Undefined stagesCompleted (e.g. the AI Generator's detail modal, which
  // has no stage-tracking data) keeps the original always-show-3 behavior.
  const visibleSteps = stagesCompleted != null
    ? steps.map(s => s.step > stagesCompleted
        ? { ...s, status: 'not_run' as const, detail: 'Pipeline stopped at an earlier stage — this check was not run.' }
        : s)
    : steps;

  const openStep = visibleSteps.find(s => s.id === openStepId) || null;
  const matchCount = (id: string) =>
    sr.conflicts.filter(c => sourceMatchesStep(id, c.source)).length +
    sr.similar_names.filter(sn => sourceMatchesStep(id, sn.source)).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListChecks className="w-4 h-4 text-orange-600" />
          Screening Workflow: Data Source Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2">
          {visibleSteps.map((s, idx) => {
            const cfg = statusConfig[s.status];
            const StatusIcon = cfg.icon;
            const StepIcon = s.icon;
            const count = matchCount(s.id);
            return (
              <div key={s.id} className="flex-1 flex flex-col sm:flex-row items-stretch gap-0">
                <button
                  type="button"
                  onClick={() => setOpenStepId(s.id)}
                  className={cn(
                    'flex-1 text-left rounded-lg border p-3 transition-all cursor-pointer',
                    'hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-300 relative group',
                    cfg.bg,
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-gray-600">{s.step}</span>
                    </div>
                    <StepIcon className={cn('w-3.5 h-3.5', cfg.text)} />
                    {count > 0 && (
                      <span className="ml-auto text-[9px] font-bold bg-white border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                        {count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-gray-800 leading-tight">{s.label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 mb-2 leading-tight">{s.note}</p>
                  <div className="flex items-center gap-1">
                    <StatusIcon className={cn('w-3 h-3', cfg.iconColor)} />
                    <span className={cn('text-[10px] font-bold', cfg.text)}>{cfg.label}</span>
                  </div>
                  <p className={cn('text-[10px] mt-0.5 leading-snug', cfg.text)}>{s.detail}</p>
                  <span className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-gray-400 group-hover:text-orange-500 transition-colors">
                    <Eye className="w-3 h-3" /> View details
                  </span>
                </button>
                {idx < visibleSteps.length - 1 && (
                  <div className="hidden sm:flex items-center px-1">
                    <ChevronRight className="w-3 h-3 text-gray-300" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          Steps 5–8 (Mike Legal, Trademark Registry, Legal validation, Risk assessment) are performed by the Trademark Team and are out of scope for this AI tool.
        </p>
      </CardContent>

      <WorkflowStepDialog
        step={openStep}
        sr={sr}
        open={openStepId !== null}
        onClose={() => setOpenStepId(null)}
      />
    </Card>
  );
}

// ─── Knockout Validation Panel ────────────────────────────────────────────────

export function KnockoutValidationPanel({ sr, brandName }: { sr: ScreeningResult; brandName: string }) {
  const hasExactMatch = sr.conflicts.some(c =>
    ['EXACT_MATCH', 'EXACT_MARKET_MATCH'].includes(c.conflict_type)
  );

  // WHO INN is deliberately not one of this panel's checks — the Screening
  // Workflow panel above already has its own "WHO INN Check" card, so
  // repeating it here would just be redundant.
  const checks = [
    {
      id: 'exact',
      label: 'Exact Name Match',
      rule: 'Exact same name found in any data source',
      status: hasExactMatch ? 'fail' : 'pass',
      isKnockout: true,
    },
    {
      id: 'phonetic',
      label: 'Phonetic Similarity',
      rule: 'Name sounds phonetically similar to existing brands',
      status: sr.phonetic_similarity_score > 0.80 ? 'fail' : sr.phonetic_similarity_score > 0.50 ? 'warn' : 'pass',
      isKnockout: true,
    },
    {
      id: 'spelling',
      label: 'Visual Similarity',
      rule: 'Spelling or visual structure closely matches existing names',
      status: sr.lookalike_score > 0.80 ? 'fail' : sr.lookalike_score > 0.50 ? 'warn' : 'pass',
      isKnockout: false,
    },
    {
      id: 'semantic',
      label: 'Semantic / Conceptual Overlap',
      rule: 'Similar meaning, context, or conceptual association',
      status: sr.semantic_similarity_score > 0.80 ? 'fail' : sr.semantic_similarity_score > 0.50 ? 'warn' : 'pass',
      isKnockout: false,
    },
    {
      id: 'prefix_suffix',
      label: 'Prefix / Suffix Match',
      rule: 'Same name with minor prefix or suffix differences',
      status: sr.spelling_similarity_score > 0.80 ? 'warn' : 'pass',
      isKnockout: false,
    },
    {
      id: 'market',
      label: 'Market / Competitor Conflict',
      rule: 'Similar name actively marketed by competitor',
      status: sr.market_conflicts >= 2 ? 'fail' : sr.market_conflicts > 0 ? 'warn' : 'pass',
      isKnockout: false,
    },
  ];

  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const knockoutFailed = checks.filter(c => c.isKnockout && c.status === 'fail').length;

  return (
    <Card className={cn(knockoutFailed > 0 ? 'border-red-200' : failCount > 0 ? 'border-orange-200' : 'border-green-200')}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Shield className="w-4 h-4 text-orange-600" /> Knockout & Validation Checks
          </CardTitle>
          <div className="flex items-center gap-2">
            {knockoutFailed > 0 && (
              <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{knockoutFailed} Knockout Fail</span>
            )}
            {failCount > 0 && (
              <span className="text-xs font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{failCount} Fail</span>
            )}
            {warnCount > 0 && (
              <span className="text-xs font-semibold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{warnCount} Review</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {checks.map(c => {
            const isFail = c.status === 'fail';
            const isWarn = c.status === 'warn';
            return (
              <div key={c.id} className={cn(
                'flex items-start gap-2.5 p-3 rounded-lg border',
                isFail ? 'bg-red-50 border-red-100' : isWarn ? 'bg-orange-50 border-orange-100' : 'bg-green-50 border-green-100'
              )}>
                <div className="flex-shrink-0 mt-0.5">
                  {isFail
                    ? <XCircle className="w-4 h-4 text-red-500" />
                    : isWarn
                    ? <AlertTriangle className="w-4 h-4 text-orange-500" />
                    : <CheckCircle className="w-4 h-4 text-green-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-xs font-semibold', isFail ? 'text-red-800' : isWarn ? 'text-orange-800' : 'text-green-800')}>
                    {c.label}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{c.rule}</p>
                </div>
              </div>
            );
          })}
        </div>
        {knockoutFailed > 0 && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">
              <strong>"{brandName}" has failed {knockoutFailed} knockout criterion.</strong> Names failing knockout conditions
              are typically excluded from further evaluation. Review the conflicts above and consider an alternative name.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Brand Uniqueness + Similarity Breakdown ───────────────────────────────────

export function UniquenessAndBreakdown({ intel, sr }: { intel: BrandIntelligence; sr?: ScreeningResult }) {
  const uniqueness = Math.round(intel.brand_uniqueness_score ?? (intel as any).uniqueness_score ?? 0);

  const breakdownData = (() => {
    if (sr?.similar_names) {
      const allSimilar = sr.similar_names || [];
      const exactCount = (sr.conflicts || []).filter(c => ['EXACT_MATCH', 'EXACT_MARKET_MATCH'].includes(c.conflict_type)).length;
      const phonCount = exactCount + allSimilar.filter(n => n.similarity_type === 'Phonetic').length;
      const spellCount = allSimilar.filter(n => n.similarity_type === 'Spelling').length;
      const visCount = allSimilar.filter(n => n.similarity_type === 'Visual' || n.similarity_type === 'Look-Alike').length;
      const concCount = allSimilar.filter(n => n.similarity_type === 'Conceptual' || n.similarity_type === 'Semantic').length;

      const items = [
        { type: 'Phonetic', count: phonCount, color: '#3b82f6' },
        { type: 'Spelling', count: spellCount, color: '#a855f7' },
        { type: 'Visual', count: visCount, color: '#f97316' },
        { type: 'Conceptual', count: concCount, color: '#6366f1' },
      ];
      return items.filter(it => it.count > 0);
    }
    return intel.similarity_breakdown || [];
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Brand Uniqueness Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 flex-shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle cx="50" cy="50" r="40" fill="none"
                  stroke={uniqueness > 60 ? '#22c55e' : uniqueness > 30 ? '#f97316' : '#ef4444'}
                  strokeWidth="10"
                  strokeDasharray={`${(uniqueness / 100) * 251.2} 251.2`}
                  strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-gray-900">
                {uniqueness}
              </span>
            </div>
            <div>
              <p className="text-sm text-gray-600">
                {intel.brand_uniqueness_score > 60 ? 'High uniqueness, strong differentiation'
                  : intel.brand_uniqueness_score > 30 ? 'Moderate uniqueness, some differentiation possible'
                  : 'Low uniqueness, crowded naming space'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Similarity Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="w-[140px] h-[120px] flex-shrink-0">
              <PieChart width={140} height={120}>
                {breakdownData.reduce((acc, it) => acc + it.count, 0) > 0 ? (
                  <Pie
                    data={breakdownData.filter(it => it.count > 0)}
                    cx={70}
                    cy={60}
                    innerRadius={35}
                    outerRadius={55}
                    dataKey="count"
                  >
                    {breakdownData.filter(it => it.count > 0).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                ) : (
                  <Pie
                    data={[{ name: 'Clear', count: 1 }]}
                    cx={70}
                    cy={60}
                    innerRadius={35}
                    outerRadius={55}
                    dataKey="count"
                  >
                    <Cell fill="#10b981" />
                  </Pie>
                )}
                <Tooltip formatter={(v: number) => [`${v} names`, '']} />
              </PieChart>
            </div>
            <div className="space-y-1.5 min-w-0">
              {breakdownData.map(item => (
                <div key={item.type} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className="text-xs text-gray-600 truncate">{item.type}: <strong>{item.count}</strong></span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
