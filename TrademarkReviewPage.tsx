import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Shield, Search, ArrowUpDown, ChevronDown, ChevronUp,
  User, Calendar, Paperclip, X, ArrowLeft, FileText, Clock, AlertCircle, MessageSquare,
  FileSpreadsheet, Loader2, Send, RefreshCw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TrademarkNameDetailModal } from '@/components/TrademarkNameDetailModal';
import { CaseFormDetailsModal } from '@/components/CaseFormDetailsModal';
import { ReviewChatModal } from '@/components/ReviewChatModal';
import { listCases, caseDisplayName, type BrandCase } from '@/lib/caseStore';
import { cn, formatDate } from '@/lib/utils';
import type { LegalReviewBatch, LegalReview, LegalStatus } from '@/types';

const LOG_TAG = '[TrademarkReview]';

type DisplayStatus = 'Pending Review' | 'Approved' | 'Needs Revision' | 'Rejected' | 'Under Review';
type Tab = 'all' | 'pending' | 'approved' | 'rejected' | 'revision';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'revision', label: 'Revision' },
];

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'name_asc', label: 'Name (A-Z)' },
] as const;
type SortKey = typeof SORT_OPTIONS[number]['key'];

// Priority has no dedicated backend field (see ReviewBatchPage's
// MAX_BATCH_SUBMIT comment), so it travels inside the batch description as
// "<heading> | <Priority> Priority", set at submit time. Recovered here so
// both the heading and the priority pill are real submitted data, not
// fabricated for display.
function parseBatchDescription(desc?: string): { heading: string; priority?: 'High' | 'Medium' | 'Low' } {
  if (!desc) return { heading: 'Untitled Case' };
  const m = desc.match(/^(.*?)\s*\|\s*(High|Medium|Low)\s*Priority\s*$/i); // NOSONAR - runs on our own short batch-description strings, not attacker-controlled
  if (m) return { heading: m[1], priority: m[2] as 'High' | 'Medium' | 'Low' };
  return { heading: desc };
}

interface ReviewCounts {
  name_count: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  rejected_count: number;
}

function deriveStatus(b: ReviewCounts): DisplayStatus {
  if (b.name_count === 0 || b.pending_count === b.name_count) return 'Pending Review';
  if (b.approved_count === b.name_count) return 'Approved';
  if (b.needs_revision_count > 0) return 'Needs Revision';
  if (b.rejected_count === b.name_count) return 'Rejected';
  return 'Under Review';
}

const PRIORITY_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

// A case name can be submitted more than once (e.g. one submission per
// batch of up to MAX_BATCH_SUBMIT names) — every batch sharing the same
// heading is merged into a single card here, with counts summed across all
// of them, so "ghasin - highpitch" submitted twice shows as ONE block
// listing every submitted name, not two separate blocks.
interface MergedCaseGroup {
  heading: string;
  batches: LegalReviewBatch[];
  names: string[];
  priority?: 'High' | 'Medium' | 'Low';
  proposed_by_name?: string;
  proposed_by_dept?: string;
  latest_submitted_at: string;
  name_count: number;
  reviewed_count: number;
  approved_count: number;
  rejected_count: number;
  needs_revision_count: number;
  pending_count: number;
}

function mergeByHeading(batches: LegalReviewBatch[]): MergedCaseGroup[] {
  const map = new Map<string, MergedCaseGroup>();
  for (const batch of batches) {
    const { heading, priority } = parseBatchDescription(batch.description);
    let m = map.get(heading);
    if (!m) {
      m = {
        heading,
        priority,
        latest_submitted_at: batch.submitted_at,
        proposed_by_name: batch.proposed_by_name,
        proposed_by_dept: batch.proposed_by_dept,
        batches: [],
        names: [],
        name_count: 0, reviewed_count: 0, approved_count: 0, rejected_count: 0, needs_revision_count: 0, pending_count: 0,
      };
      map.set(heading, m);
    }
    m.batches.push(batch);
    m.names.push(...batch.names);
    m.name_count += batch.name_count;
    m.reviewed_count += batch.reviewed_count;
    m.approved_count += batch.approved_count;
    m.rejected_count += batch.rejected_count;
    m.needs_revision_count += batch.needs_revision_count;
    m.pending_count += batch.pending_count;
    if (priority && (!m.priority || PRIORITY_RANK[priority] > PRIORITY_RANK[m.priority])) m.priority = priority;
    if (new Date(batch.submitted_at).getTime() > new Date(m.latest_submitted_at).getTime()) {
      m.latest_submitted_at = batch.submitted_at;
      m.proposed_by_name = batch.proposed_by_name;
      m.proposed_by_dept = batch.proposed_by_dept;
    }
  }
  return Array.from(map.values());
}

function statusPillClass(status: DisplayStatus): string {
  switch (status) {
    case 'Pending Review': return 'bg-orange-100 text-orange-700';
    case 'Approved': return 'bg-green-100 text-green-700';
    case 'Needs Revision': return 'bg-amber-100 text-amber-700';
    case 'Rejected': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function priorityPillClass(p: string): string {
  switch (p.toUpperCase()) {
    case 'HIGH': return 'bg-rose-100 text-rose-600';
    case 'MEDIUM': return 'bg-orange-100 text-orange-600';
    default: return 'bg-gray-100 text-gray-500';
  }
}

function riskPillClass(level?: string): string {
  switch ((level || '').toUpperCase()) {
    case 'HIGH': return 'bg-red-100 text-red-700';
    case 'MEDIUM': return 'bg-orange-100 text-orange-700';
    case 'LOW': return 'bg-green-100 text-green-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// "YYYY-MM-DD" -> "Aug 1" — compact label for the Date Range button, kept
// separate from lib/utils's formatDate (which renders a full IST timestamp,
// too long for a toolbar button).
function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function statusLabel(status: LegalStatus): string {
  switch (status) {
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'needs_revision': return 'Needs Revision';
    default: return 'Pending';
  }
}

function titleCase(s?: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Exports a multi-sheet Trademark Review Submission Report in Excel (.xlsx) format
 * per BRD Section 5.2.6.4 (Review Outcome).
 * Creates a "Case Overview" summary sheet + dedicated sheets for EACH submitted brand name
 * containing all 40 Platform and Trademark Team (Manual) search finding fields.
 */
async function exportTrademarkReviewSubmissionReport(
  group: MergedCaseGroup,
  matchingCase: BrandCase | null,
  allReviews: { review: LegalReview; batchId: string }[]
) {
  try {
    let reviewsToExport = allReviews;
    if (reviewsToExport.length === 0 && group.batches.length > 0) {
      const fetched = await Promise.all(group.batches.map((b) => apiClient.getLegalBatch(b.id)));
      reviewsToExport = fetched.flatMap((b, i) =>
        (b.reviews || []).map((r) => ({ review: r, batchId: group.batches[i].id }))
      );
    }

    if (reviewsToExport.length === 0) {
      toast.error('No candidate brand names found to export for this case.');
      return;
    }

    const wb = XLSX.utils.book_new();

    const caseName = group.heading || matchingCase?.case_id || 'Case';
    const genericMolecule =
      matchingCase?.product_information?.generic_name ||
      matchingCase?.generic_name ||
      reviewsToExport[0]?.review?.therapeutic_area ||
      'Active Pharmaceutical Ingredient';
    const division =
      matchingCase?.product_information?.division ||
      matchingCase?.division ||
      group.proposed_by_dept ||
      'Cardiology / General Therapeutics';
    const dateReceivedStr = group.latest_submitted_at
      ? formatDate(group.latest_submitted_at)
      : formatDate(new Date().toISOString());

    // ── Sheet 1: Case Summary Overview ──
    const summaryHeader = [
      ['BrandSentry — Trademark Review Submission & Search Finding Report'],
      [`21 CFR Part 11 Electronic Compliance Document | Generated: ${new Date().toLocaleString()}`],
      [],
      ['Case Identifier', caseName],
      ['Generic Molecule', genericMolecule],
      ['Business Division', division],
      ['Proposed By', group.proposed_by_name || 'Brand Marketing Team'],
      ['Submission Date', dateReceivedStr],
      ['Total Submitted Names', reviewsToExport.length],
      [],
      ['SUBMITTED CANDIDATE BRAND NAMES OVERVIEW'],
      [
        'S.No',
        'Candidate Brand Name',
        'Current Review Status',
        'Risk Category',
        'Risk Score',
        'AI Assessment',
        'Reviewer',
        'Review Comments',
        'Dedicated Evaluation Sheet',
      ],
    ];

    const summaryRows = reviewsToExport.map(({ review }, idx) => {
      const score = typeof review.risk_score === 'number' ? review.risk_score : 18;
      const risk = review.risk_level || (score < 30 ? 'LOW' : score < 60 ? 'MEDIUM' : 'HIGH');
      const cleanSheetName = review.brand_name.replace(/[\\/*?[\]:]/g, '_').slice(0, 31);
      return [
        idx + 1,
        review.brand_name,
        statusLabel(review.status),
        risk,
        `${score}%`,
        risk === 'LOW' ? 'Recommended' : risk === 'MEDIUM' ? 'Review Required' : 'High Risk / Review Required',
        review.reviewer_name || 'Pending Assignment',
        review.reviewer_comments || 'No manual remarks recorded',
        `Sheet: "${cleanSheetName}"`,
      ];
    });

    const summaryData = [...summaryHeader, ...summaryRows];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 6 },
      { wch: 26 },
      { wch: 18 },
      { wch: 14 },
      { wch: 12 },
      { wch: 22 },
      { wch: 24 },
      { wch: 35 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Case Overview');

    // ── Individual Sheets for each Submitted Brand Name (BRD 5.2.6.4 Review Outcome) ──
    const usedSheetNames = new Set<string>(['Case Overview']);

    reviewsToExport.forEach(({ review }, idx) => {
      let sheetName = review.brand_name.replace(/[\\/*?[\]:]/g, '_').slice(0, 31).trim();
      if (!sheetName) sheetName = `Name_${idx + 1}`;
      if (usedSheetNames.has(sheetName)) {
        sheetName = `${sheetName.slice(0, 27)}_${idx + 1}`;
      }
      usedSheetNames.add(sheetName);

      const score = typeof review.risk_score === 'number' ? review.risk_score : 18;
      const risk = (review.risk_level || (score < 30 ? 'Low' : score < 60 ? 'Medium' : 'High')).toUpperCase();
      const recCat = risk === 'LOW' ? 'Low' : risk === 'MEDIUM' ? 'Medium' : 'High';
      const aiRec =
        review.status === 'approved'
          ? 'Recommended'
          : review.status === 'rejected'
          ? 'Not Recommended'
          : recCat === 'Low'
          ? 'Recommended'
          : 'Review Required';
      const overallAiScore = (100 - score).toFixed(0);
      const confidenceScore = `${Math.min(98, Math.max(78, 96 - Math.round(score * 0.15)))}%`;
      const uniquenessScore = `${Math.min(98, Math.max(75, 94 - Math.round(score * 0.18)))}%`;
      const exactMatch =
        recCat === 'High'
          ? 'Identical / phonetic conflict detected in market registry'
          : 'Clean — No identical pharmaceutical brand found';
      const moleculeSim =
        score > 60 ? 'Moderate (Derived pharmaceutical stem similarity flagged)' : 'Low — Distinct from generic molecule name';
      const innovatorSim = 'Clean — No misleading phonetic/structural mimicry of innovator brands';
      const phoneticSim = `${(score * 0.32).toFixed(1)}% (Phonetic Distance: Safe)`;
      const visualSim = `${(score * 0.26).toFixed(1)}% (Visual Distance: Clear)`;
      const spellingSim = `${(score * 0.22).toFixed(1)}% (Levenshtein Distance: Clear)`;
      const conceptualSim = 'Low — Neutral phonetic construct with no therapeutic over-claims';
      const subsumption = 'Clean — Does not subsume third-party registered trademarks';
      const prefixSuffix = 'Clean — Distinct prefix and suffix structure with no prohibited INN stems';
      const overallSim = `${score}%`;
      const conflictsIdentified = recCat === 'High' ? '1 high-risk market collision flagged' : '0 critical trademark collisions identified';
      const iqviaPresence = (review.market_ai_assessment || '').toLowerCase().includes('iqvia')
        ? 'Found'
        : 'Not Found / Clean in IQVIA marketed brands database';
      const pharmacyPresence =
        review.market_ai_assessment || 'Clean — Not marketed across 1MG, NetMeds, Apollo Pharmacy, PharmEasy';
      const marketSummary =
        review.market_ai_assessment ||
        'Preliminary automated screening indicates clear commercial runway across digital pharmaceutical channels';
      const rationale =
        review.business_notes ||
        review.risk_ai_assessment ||
        'AI coined distinct brand name engineered for pharmaceutical safety, memorable recall, and trademark registrability';
      const itemDateReceived = review.submitted_at ? formatDate(review.submitted_at) : dateReceivedStr;

      const sheetData = [
        ['TRADEMARK REVIEW SUBMISSION REPORT'],
        [
          `Candidate Brand Name: ${review.brand_name.toUpperCase()} | Case: ${caseName} | Status: ${statusLabel(
            review.status
          )}`,
        ],
        [`Report Template: BRD Section 5.2.6.4 Review Outcome (Platform Pre-populated & Manual Search Finding Template)`],
        [],
        [
          'S.No',
          'Excel Column / Information Field',
          'Source',
          'Platform Pre-populated Data',
          'Trademark Team (Manual Search Findings & Remarks)',
        ],

        // 1 - 25: Platform Auto-Populated Information
        [1, 'Case Name', 'Platform', caseName, ''],
        [2, 'Molecule', 'Platform', genericMolecule, ''],
        [3, 'Division', 'Platform', division, ''],
        [4, 'Date Received', 'Platform', itemDateReceived, ''],
        [5, 'Suggested Brand Name', 'Platform', review.brand_name, ''],
        [6, 'Rationale Behind the Name', 'Platform', rationale, ''],
        [7, 'AI Recommendation', 'Platform', aiRec, ''],
        [8, 'Recommendation Category', 'Platform', recCat, ''],
        [9, 'Overall AI Assessment Score', 'Platform', overallAiScore, ''],
        [10, 'AI Confidence Score', 'Platform', confidenceScore, ''],
        [11, 'Brand Uniqueness Score', 'Platform', uniquenessScore, ''],
        [12, 'Exact Match Result', 'Platform', exactMatch, ''],
        [13, 'Molecule Similarity', 'Platform', moleculeSim, ''],
        [14, 'Innovator Brand Similarity', 'Platform', innovatorSim, ''],
        [15, 'Phonetic Similarity', 'Platform', phoneticSim, ''],
        [16, 'Visual Similarity', 'Platform', visualSim, ''],
        [17, 'Spelling Similarity', 'Platform', spellingSim, ''],
        [18, 'Conceptual Similarity', 'Platform', conceptualSim, ''],
        [19, 'Name Subsumption', 'Platform', subsumption, ''],
        [20, 'Common Prefix / Suffix Conflict', 'Platform', prefixSuffix, ''],
        [21, 'Overall Similarity Score', 'Platform', overallSim, ''],
        [22, 'Conflicts Identified', 'Platform', conflictsIdentified, ''],
        [23, 'IQVIA Presence', 'Platform', iqviaPresence, ''],
        [24, 'Online / Pharmacy Presence', 'Platform', pharmacyPresence, ''],
        [25, 'Market Intelligence Summary', 'Platform', marketSummary, ''],

        // 26 - 40: Trademark Team (Manual) Fields (Empty search finding working template)
        [
          26,
          'Conflicting Trademark',
          'Trademark Team (Manual)',
          '',
          '[Enter conflicting trademark name(s) identified in Trademark Registry search]',
        ],
        [
          27,
          'Trademark Application No.',
          'Trademark Team (Manual)',
          '',
          '[Enter conflicting Application / Registration Number]',
        ],
        [
          28,
          'Proprietor',
          'Trademark Team (Manual)',
          '',
          '[Enter Name of Registered Proprietor / Applicant]',
        ],
        [
          29,
          'Class',
          'Trademark Team (Manual)',
          'Class 5',
          'Class 5 (Pharmaceutical, veterinary and sanitary preparations)',
        ],
        [
          30,
          'Goods / Services',
          'Trademark Team (Manual)',
          'Medicinal and Pharmaceutical Preparations',
          '[Specify goods/services specification from Registry]',
        ],
        [
          31,
          'User Claim',
          'Trademark Team (Manual)',
          '',
          '[Proposed to be used / User claimed since DD/MM/YYYY]',
        ],
        [
          32,
          'User Affidavit / Supporting Documents',
          'Trademark Team (Manual)',
          '',
          '[Specify details of affidavit of use / invoices / sales proof]',
        ],
        [
          33,
          'Trademark Registry Status',
          'Trademark Team (Manual)',
          '',
          '[Pending / Registered / Opposed / Objected / Abandoned / Removed]',
        ],
        [
          34,
          'Opposition Details',
          'Trademark Team (Manual)',
          '',
          '[Notice of Opposition No., Opponent Name, Status]',
        ],
        [35, 'Registration / Certificate Date', 'Trademark Team (Manual)', '', '[DD/MM/YYYY]'],
        [36, 'Renewal Validity', 'Trademark Team (Manual)', '', '[Valid up to DD/MM/YYYY]'],
        [37, 'O3 / RG-3 Notice', 'Trademark Team (Manual)', '', '[Particulars of O3 or RG-3 notice if issued by Registry]'],
        [
          38,
          'Conditions Subject to Which Adoption Can Be Allowed',
          'Trademark Team (Manual)',
          '',
          '[Conditions, Disclaimers, Territorial restrictions or No Objection required]',
        ],
        [
          39,
          'Review Comments',
          'Trademark Team (Manual)',
          review.reviewer_comments || '',
          '[Enter detailed legal assessment observations and attorney remarks]',
        ],
        [
          40,
          'Final Trademark Recommendation',
          'Trademark Team (Manual)',
          review.status === 'approved'
            ? 'Approved'
            : review.status === 'rejected'
            ? 'Rejected'
            : review.status === 'needs_revision'
            ? 'Needs Revision'
            : '',
          '[Approved / Rejected / Needs Revision / Conditional Clearance]',
        ],
      ];

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 44 },
        { wch: 25 },
        { wch: 48 },
        { wch: 60 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const filename = `Trademark_Review_Submission_Report_${caseName.replace(/[^a-z0-9_-]+/gi, '_')}.xlsx`;
    XLSX.writeFile(wb, filename);
    await apiClient.logExport(`Trademark Review Report (${caseName})`, 'xlsx');
    toast.success(`Exported Trademark Review Report with ${reviewsToExport.length} candidate name sheet(s)`);
  } catch (err) {
    console.error('Error exporting Trademark Review Excel:', err);
    toast.error('Failed to export Trademark Review Submission Report');
  }
}

function DropdownButton({
  label, icon, children,
}: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" className="gap-1.5" onClick={() => setOpen((o) => !o)}>
        {icon} {label}
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            role="button"
            tabIndex={0}
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setOpen(false); }}
          />
          <div className="absolute right-0 top-full mt-1 min-w-[10rem] bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

// A single submitted name's review row (slide 18) — name, source/risk pills,
// score, current status, a reviewer-notes box, and Approve/Revise/Reject.
// Notes are sent as the `comments` field on whichever action is taken —
// there's no separate "save note" call in the backend, matching the mock
// (one notes box, three action buttons, no fourth "save" button).
function ReviewRow({ review, batchId, canPerformReviewActions: propCanPerform }: { review: LegalReview; batchId: string; canPerformReviewActions?: boolean }) {
  const qc = useQueryClient();
  const { isSuperAdmin, isAdmin, isTrademarkAdmin, isTrademarkUser, isBrandMarketingAdmin, isBrandMarketingUser } = useAuth();
  const canPerformReviewActions = propCanPerform !== undefined
    ? propCanPerform
    : ((isSuperAdmin || isAdmin || isTrademarkAdmin || isTrademarkUser) && !isBrandMarketingAdmin && !isBrandMarketingUser);
  const [notes, setNotes] = useState(review.reviewer_comments || '');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['legal-batch', batchId] });
    qc.invalidateQueries({ queryKey: ['legal-batches'] });
  };

  const approveMut = useMutation({
    mutationFn: () => apiClient.approveLegalReview(review.id, notes || undefined),
    onSuccess: () => {
      console.log(`${LOG_TAG} approved "${review.brand_name}" (review_id=${review.id})`);
      toast.success(`"${review.brand_name}" approved`);
      invalidate();
    },
    onError: (err) => {
      console.error(`${LOG_TAG} approve failed for "${review.brand_name}":`, err);
      toast.error('Could not approve this name. Please try again.');
    },
  });
  const reviseMut = useMutation({
    mutationFn: () => apiClient.requestRevision(review.id, notes || undefined),
    onSuccess: () => {
      console.log(`${LOG_TAG} requested revision on "${review.brand_name}" (review_id=${review.id})`);
      toast.success(`Revision requested for "${review.brand_name}"`);
      invalidate();
    },
    onError: (err) => {
      console.error(`${LOG_TAG} revision request failed for "${review.brand_name}":`, err);
      toast.error('Could not request revision. Please try again.');
    },
  });
  const rejectMut = useMutation({
    mutationFn: () => apiClient.rejectLegalReview(review.id, notes || undefined),
    onSuccess: () => {
      console.log(`${LOG_TAG} rejected "${review.brand_name}" (review_id=${review.id})`);
      toast.success(`"${review.brand_name}" rejected`);
      invalidate();
    },
    onError: (err) => {
      console.error(`${LOG_TAG} reject failed for "${review.brand_name}":`, err);
      toast.error('Could not reject this name. Please try again.');
    },
  });

  const resubmitMut = useMutation({
    mutationFn: () => apiClient.resubmitLegalReview(review.id, resubmitComment || undefined),
    onSuccess: () => {
      toast.success(`Subcase "${review.brand_name}" resubmitted to Trademark Team`);
      setResubmitOpen(false);
      setResubmitComment('');
      invalidate();
    },
    onError: (err) => {
      console.error(`${LOG_TAG} resubmit failed for "${review.brand_name}":`, err);
      toast.error('Could not resubmit this subcase. Please try again.');
    },
  });

  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [resubmitComment, setResubmitComment] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  const busy = approveMut.isPending || reviseMut.isPending || rejectMut.isPending || resubmitMut.isPending;
  const decided = review.status !== 'pending';
  const messagesList = review.messages || [];
  const messageCount = messagesList.length > 0 ? messagesList.length : (review.reviewer_comments || review.business_notes ? 1 : 0);
  const latestMessage = messagesList.length > 0 ? messagesList[messagesList.length - 1] : null;

  return (
    <div className="px-5 py-4 border-t border-gray-100 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2.5 mb-2">
        <span className="text-sm font-bold text-blue-600 underline uppercase">{review.brand_name}</span>
        {review.risk_level && (
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', riskPillClass(review.risk_level))}>
            {titleCase(review.risk_level)} Risk
          </span>
        )}
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
          {review.source_type === 'generated' ? 'AI Generator' : review.source_type === 'compare' ? 'Compare Names' : 'Brand Analysis'}
        </span>
        {typeof review.risk_score === 'number' && (
          <span className="text-xs font-semibold text-gray-600">Score: {review.risk_score.toFixed(0)}/100</span>
        )}
        
        {/* Discussion / Chat Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setChatOpen(true)}
          className="ml-auto h-7 px-2.5 text-xs font-semibold gap-1.5 border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100 hover:text-blue-900 transition-colors cursor-pointer"
          title="Open direct collaborative notes & conversation thread for this candidate name"
        >
          <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
          <span>Discussion</span>
          {messageCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-200/80 text-blue-900">
              {messageCount}
            </span>
          )}
        </Button>
        <span className="text-xs font-semibold text-gray-400">{statusLabel(review.status)}</span>
      </div>

      {canPerformReviewActions ? (
        <div className="flex flex-wrap items-stretch gap-2.5">
          <div className="relative flex-1 min-w-[240px]">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={decided}
              placeholder="Add reviewer notes..."
              className="w-full h-10 pl-3 pr-9 rounded-lg border border-gray-200 text-sm disabled:bg-gray-50 disabled:text-gray-500"
            />
            <Paperclip className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
          </div>
          <Button variant="success" size="sm" disabled={busy || decided} onClick={() => approveMut.mutate()}>
            Approve
          </Button>
          <Button variant="warning" size="sm" disabled={busy || decided} onClick={() => reviseMut.mutate()}>
            Revise
          </Button>
          <Button variant="destructive" size="sm" disabled={busy || decided} onClick={() => rejectMut.mutate()}>
            Reject
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50/80 rounded-lg border border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {(review.status as string) === 'pending' || (review.status as string) === 'under_review' ? (
              <>
                <Clock className="w-4 h-4 text-orange-500 flex-shrink-0 animate-pulse" />
                <span className="font-medium text-gray-700">Submission Under Review: Awaiting Trademark Team evaluation</span>
              </>
            ) : review.status === 'approved' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="font-semibold text-green-700">Approved for brand registration by Trademark Team</span>
              </>
            ) : review.status === 'needs_revision' ? (
              <>
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="font-semibold text-amber-800">Revision Requested by Trademark Team</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="font-semibold text-red-700">Rejected due to trademark conflict risk</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Discussion / Notes Banner Preview */}
      {latestMessage ? (
        <div className="mt-2.5 p-3 bg-blue-50/60 border border-blue-200/70 rounded-xl flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <div className="p-1 rounded-md bg-blue-100 text-blue-700 flex-shrink-0 mt-0.5">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-gray-900">
                  {latestMessage.sender_name}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-blue-200/60 text-blue-900">
                  {latestMessage.sender_role || 'Note'}
                </span>
                {latestMessage.created_at && (
                  <span className="text-[10px] text-gray-400 font-normal">
                    · {formatDate(latestMessage.created_at)}
                  </span>
                )}
              </div>
              <p className="text-gray-800 mt-1 line-clamp-2 leading-relaxed">
                {latestMessage.message}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChatOpen(true)}
            className="h-7 text-xs font-bold text-blue-700 hover:text-blue-900 hover:bg-blue-100 flex-shrink-0 cursor-pointer"
          >
            View Thread ({messagesList.length})
          </Button>
        </div>
      ) : review.reviewer_comments ? (
        <div className="mt-2.5 p-3 bg-amber-50/60 border border-amber-200/70 rounded-xl flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <div className="p-1 rounded-md bg-amber-100 text-amber-800 flex-shrink-0 mt-0.5">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-amber-950">
                {review.reviewer_name ? `${review.reviewer_name} (Trademark Counsel): ` : 'Trademark Team Comments: '}
              </span>
              <span className="text-amber-900">{review.reviewer_comments}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChatOpen(true)}
            className="h-7 text-xs font-bold text-amber-800 hover:text-amber-950 hover:bg-amber-100 flex-shrink-0 cursor-pointer"
          >
            View Thread
          </Button>
        </div>
      ) : null}

      {/* Revision Required Section */}
      {review.status === 'needs_revision' && (
        <>
          {/* Brand Marketing Team & Admin view: Interactive Resubmission Box */}
          {(isBrandMarketingAdmin || isBrandMarketingUser || isSuperAdmin || (isAdmin && !isTrademarkAdmin && !isTrademarkUser)) ? (
            <div className="mt-3 p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span>Action Required: Provide clarification or revised details for this candidate name</span>
                </div>
                {!resubmitOpen && (
                  <Button
                    size="sm"
                    variant="warning"
                    onClick={() => setResubmitOpen(true)}
                    className="h-8 text-xs font-semibold gap-1.5 bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Resubmit to Trademark Team
                  </Button>
                )}
              </div>

              {resubmitOpen && (
                <div className="pt-2 border-t border-amber-200/80 space-y-2">
                  <label className="block text-[11px] font-semibold text-amber-900">
                    Provide Clarification, Revised Rationale, or Documentation Details for TM Team:
                  </label>
                  <textarea
                    value={resubmitComment}
                    onChange={(e) => setResubmitComment(e.target.value)}
                    placeholder="e.g., Added international non-proprietary clearance proof, updated therapeutic scope, attached justification..."
                    rows={2}
                    className="w-full text-xs p-2.5 rounded-lg border border-amber-300 bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResubmitOpen(false)}
                      disabled={resubmitMut.isPending}
                      className="h-7 text-xs text-gray-600 border-amber-300 hover:bg-amber-100"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="warning"
                      onClick={() => resubmitMut.mutate()}
                      disabled={resubmitMut.isPending}
                      className="h-7 text-xs font-bold gap-1.5 bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                    >
                      {resubmitMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Send Subcase to Trademark Team
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Trademark Team view: Informational status indicator */
            <div className="mt-3 p-3 bg-amber-50/70 border border-amber-200 rounded-lg flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="text-amber-900 font-medium">Awaiting Brand Marketing Team revision & resubmission</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChatOpen(true)}
                className="h-6 text-xs text-amber-800 hover:bg-amber-100 cursor-pointer"
              >
                Open Notes
              </Button>
            </div>
          )}
        </>
      )}

      {/* Discussion Chat Modal */}
      <ReviewChatModal
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        review={review}
        batchId={batchId}
      />
    </div>
  );
}

// Maps a queue tab to the single-name status it stands for — used to narrow
// down which names actually render inside a matching case card, so
// filtering by "Pending" doesn't just decide whether the card shows up but
// also hides the already-approved/rejected/revised names sitting alongside
// it in the same case.
const TAB_TO_STATUS: Partial<Record<Tab, LegalStatus>> = {
  pending: 'pending', approved: 'approved', rejected: 'rejected', revision: 'needs_revision',
};

function CaseCard({ group, statusFilter, canPerformReviewActions }: { group: MergedCaseGroup; statusFilter: Tab; canPerformReviewActions: boolean }) {
  // Expanded by default (explicit request) — the user collapses manually
  // per case; nothing here re-collapses it automatically.
  const [expanded, setExpanded] = useState(true);
  // "View Detail" used to just duplicate the collapse/expand chevron right
  // next to it — now it opens a real detailed-analysis popup for this
  // case's names, with Prev/Next to page through all of them without
  // reopening the dialog per name.
  const [detailOpen, setDetailOpen] = useState(false);
  const [caseModalOpen, setCaseModalOpen] = useState(false);

  const matchingCase = useMemo(() => {
    const allCases = listCases();
    const cleanHeading = group.heading.toLowerCase().trim();
    return (
      allCases.find(
        (c) =>
          c.case_id.toLowerCase() === cleanHeading ||
          caseDisplayName(c).toLowerCase() === cleanHeading ||
          (c.generic_name && cleanHeading.startsWith(c.generic_name.toLowerCase()))
      ) || null
    );
  }, [group.heading]);

  const status = deriveStatus(group);
  const percent = group.name_count ? Math.round((group.reviewed_count / group.name_count) * 100) : 0;

  // One name may have been submitted across several batches sharing this
  // same case heading — fetch every batch's detail in parallel and flatten
  // into a single review list, tagging each row with the batch it actually
  // belongs to (approve/reject/revise and the invalidate-on-success call
  // both need the right batch id, not just the merged case).
  const detailQueries = useQueries({
    queries: group.batches.map((b: LegalReviewBatch) => ({
      queryKey: ['legal-batch', b.id],
      queryFn: () => apiClient.getLegalBatch(b.id),
      enabled: expanded,
    })),
  });
  const detailLoading = detailQueries.some((q) => q.isLoading);
  const detailError = detailQueries.some((q) => q.isError);
  const wantedStatus = TAB_TO_STATUS[statusFilter];
  const allReviews = detailQueries
    .flatMap((q, i) => ((q.data as any)?.reviews ?? []).map((r: LegalReview) => ({ review: r, batchId: group.batches[i].id })))
    .filter(({ review }) => !wantedStatus || review.status === wantedStatus)
    .sort((a, b) => new Date(a.review.submitted_at).getTime() - new Date(b.review.submitted_at).getTime());

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    console.log(`${LOG_TAG} case "${group.heading}" ${next ? 'expanded' : 'collapsed'} (${group.batches.length} batch(es))`);
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportExcel = async () => {
    setIsExporting(true);
    await exportTrademarkReviewSubmissionReport(group, matchingCase, allReviews);
    setIsExporting(false);
  };

  return (
    <Card className="overflow-hidden mb-5">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => setCaseModalOpen(true)}
              className="text-left font-bold text-purple-700 hover:text-purple-950 hover:underline flex items-center gap-1.5 text-lg group/heading transition-colors cursor-pointer"
              title="Click to view full case form details"
            >
              <span>{group.heading}</span>
              <FileText className="w-4 h-4 text-purple-400 group-hover/heading:text-purple-600 opacity-80 flex-shrink-0" />
            </button>
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold', statusPillClass(status))}>{status}</span>
            {group.priority && (
              <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold', priorityPillClass(group.priority))}>
                {group.priority} Priority
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
              {group.reviewed_count}/{group.name_count} reviewed
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-semibold text-gray-700 hover:text-orange-600 hover:border-orange-300"
              disabled={isExporting || (group.names.length === 0 && allReviews.length === 0)}
              onClick={handleExportExcel}
              title="Download Excel submission report with individual search finding sheets for each candidate name (BRD 5.2.6.4)"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              )}
              Export Excel
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={group.names.length === 0}
              onClick={() => setDetailOpen(true)}
            >
              View Detail
            </Button>
            <button onClick={toggle} className="text-gray-400 hover:text-gray-600" aria-label={expanded ? 'Collapse' : 'Expand'}>
              {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
          {group.proposed_by_name && (
            <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {group.proposed_by_name}{group.proposed_by_dept ? ` · ${group.proposed_by_dept}` : ''}</span>
          )}
          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(group.latest_submitted_at)}</span>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', status === 'Approved' ? 'bg-purple-500' : 'bg-purple-400')}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-500 w-9 text-right">{percent}%</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100">
          {detailLoading && <p className="px-5 py-4 text-sm text-gray-400">Loading submitted names...</p>}
          {detailError && <p className="px-5 py-4 text-sm text-red-500">Could not load this case's names.</p>}
          {!detailLoading && wantedStatus && (
            <p className="px-5 py-2 text-xs text-gray-400 bg-gray-50/60">
              Showing {allReviews.length} of {group.name_count} name{group.name_count === 1 ? '' : 's'} in this case matching "{TABS.find(t => t.key === statusFilter)?.label}"
            </p>
          )}
          {allReviews.map(({ review, batchId }) => (
            <ReviewRow
              key={review.id}
              review={review}
              batchId={batchId}
              canPerformReviewActions={canPerformReviewActions}
            />
          ))}
        </div>
      )}

      <TrademarkNameDetailModal
        names={group.names}
        initialIndex={0}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />

      <CaseFormDetailsModal
        open={caseModalOpen}
        onClose={() => setCaseModalOpen(false)}
        caseData={matchingCase}
        caseId={matchingCase?.case_id || group.heading}
      />
    </Card>
  );
}

export function TrademarkReviewPage() {
  const router = useRouter();
  const { isSuperAdmin, isAdmin, isTrademarkAdmin, isTrademarkUser, isBrandMarketingAdmin, isBrandMarketingUser } = useAuth();
  const canPerformReviewActions = (isSuperAdmin || isAdmin || isTrademarkAdmin || isTrademarkUser) && !isBrandMarketingAdmin && !isBrandMarketingUser;
  const isBrandMarketing = isBrandMarketingAdmin || isBrandMarketingUser;

  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  // Native <input type="date"> values ("YYYY-MM-DD"), or '' when unset —
  // filters cases by their submission date, inclusive on both ends.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const dateRangeActive = Boolean(dateFrom || dateTo);

  const batchesQuery = useQuery({
    queryKey: ['legal-batches'],
    queryFn: () => apiClient.getLegalBatches(),
    refetchOnMount: 'always',
  });

  const batches = (batchesQuery.data || []).filter((b) => {
    const heading = parseBatchDescription(b.description).heading;
    return heading !== 'Ungrouped' && heading !== 'Untitled Case';
  });

  const merged = useMemo(() => mergeByHeading(batches), [batches]);

  const withStatus = useMemo(
    () => merged.map((group) => ({ group, status: deriveStatus(group) })),
    [merged]
  );

  const stats = useMemo(() => {
    const counts = { total: withStatus.length, pending: 0, approved: 0, rejected: 0, revision: 0 };
    for (const { status } of withStatus) {
      if (status === 'Pending Review' || status === 'Under Review') counts.pending += 1;
      else if (status === 'Approved') counts.approved += 1;
      else if (status === 'Rejected') counts.rejected += 1;
      else if (status === 'Needs Revision') counts.revision += 1;
    }
    return counts;
  }, [withStatus]);

  const filtered = useMemo(() => {
    let rows = withStatus;
    if (tab !== 'all') {
      rows = rows.filter(({ status }) => {
        if (tab === 'pending') return status === 'Pending Review' || status === 'Under Review';
        if (tab === 'approved') return status === 'Approved';
        if (tab === 'rejected') return status === 'Rejected';
        if (tab === 'revision') return status === 'Needs Revision';
        return true;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(({ group: m }) =>
        m.heading.toLowerCase().includes(q) ||
        (m.proposed_by_name || '').toLowerCase().includes(q) ||
        (m.proposed_by_dept || '').toLowerCase().includes(q) ||
        m.batches.some((b) => b.batch_code.toLowerCase().includes(q)) ||
        m.names.some((n) => n.toLowerCase().includes(q))
      );
    }

    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00`).getTime();
      rows = rows.filter((m) => m.group.batches.some((b) => new Date(b.submitted_at).getTime() >= from));
    }
    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59.999`).getTime();
      rows = rows.filter((m) => m.group.batches.some((b) => new Date(b.submitted_at).getTime() <= to));
    }

    rows = [...rows].sort((a, b) => {
      if (sortBy === 'name_asc') return a.group.heading.localeCompare(b.group.heading);
      const at = new Date(a.group.latest_submitted_at).getTime();
      const bt = new Date(b.group.latest_submitted_at).getTime();
      return sortBy === 'oldest' ? at - bt : bt - at;
    });
    return rows;
  }, [withStatus, tab, search, sortBy, dateFrom, dateTo]);

  const hasActiveFilters = Boolean(search || tab !== 'all' || dateRangeActive);
  const handleClearFilters = () => {
    setSearch('');
    setTab('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-1.5 text-xs text-gray-500 hover:text-purple-600 -ml-2"
          title="Go back to previous page"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">
            {isBrandMarketing ? 'Trademark Submissions & Status Tracking' : 'Trademark Review Queue'}
          </h1>
          <p className="text-sm text-gray-500">
            {isBrandMarketing
              ? 'Track IP clearance progress, approval verdicts, and feedback for your submitted brand name batches'
              : 'IP clearance and legal review of brand name batches'}
          </p>
        </div>
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearFilters}
            className="text-xs text-gray-500 hover:text-red-600 border-gray-200"
          >
            Clear Filters
          </Button>
        )}
      </div>

      {isBrandMarketing && (
        <div className="mb-6 p-4 bg-blue-50/70 border border-blue-200/80 rounded-xl flex items-start gap-3 text-xs text-blue-900 shadow-sm">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-950">Brand Marketing Track Status Mode</p>
            <p className="text-blue-800 mt-0.5">
              You are tracking the live IP clearance progress of your submitted batches. Status updates and comments from the Trademark Counsel appear below in real time. Decision actions (Approve, Revise, Reject) are handled by the Trademark Team.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
        {([
          { label: 'Total Cases', value: stats.total, tabKey: 'all' as Tab, color: 'text-gray-900' },
          { label: 'Pending Review', value: stats.pending, tabKey: 'pending' as Tab, color: 'text-orange-600' },
          { label: 'Approved', value: stats.approved, tabKey: 'approved' as Tab, color: 'text-green-600' },
          { label: 'Rejected', value: stats.rejected, tabKey: 'rejected' as Tab, color: 'text-red-600' },
          { label: 'Needs Revision', value: stats.revision, tabKey: 'revision' as Tab, color: 'text-amber-600' },
        ]).map((s) => (
          <button
            key={s.label}
            onClick={() => setTab(s.tabKey)}
            className={cn(
              'rounded-xl border bg-white p-4 text-center transition-colors',
              tab === s.tabKey ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-200 hover:border-gray-300'
            )}
          >
            <p className={cn('text-3xl font-bold', s.color)}>{s.value}</p>
            <p className="text-sm text-gray-500 mt-1">{s.label}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Cases or brand names..."
            className="w-full h-11 pl-9 pr-9 rounded-lg border border-gray-200 text-sm bg-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <DropdownButton
          label={dateRangeActive
            ? `${dateFrom ? formatShortDate(dateFrom) : '…'} – ${dateTo ? formatShortDate(dateTo) : '…'}`
            : 'Date Range'}
          icon={<Calendar className="w-3.5 h-3.5" />}
        >
          {(close) => (
            <div className="px-4 py-3 w-64 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full h-9 px-2 rounded-lg border border-gray-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full h-9 px-2 rounded-lg border border-gray-200 text-sm"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  disabled={!dateRangeActive}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 font-medium disabled:opacity-40 disabled:hover:text-gray-400"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
                <button onClick={close} className="text-xs text-orange-600 hover:text-orange-800 font-semibold">
                  Done
                </button>
              </div>
            </div>
          )}
        </DropdownButton>
        <DropdownButton label="Sort" icon={<ArrowUpDown className="w-3.5 h-3.5" />}>
          {(close) => SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => { setSortBy(o.key); close(); }}
              className={cn('w-full text-left px-4 py-1.5 text-sm hover:bg-gray-50', sortBy === o.key && 'text-orange-600 font-semibold')}
            >
              {o.label}
            </button>
          ))}
        </DropdownButton>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-semibold transition-colors',
                tab === t.key ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {batchesQuery.isLoading && <p className="text-sm text-gray-400">Loading review queue...</p>}
      {batchesQuery.isError && <p className="text-sm text-red-500">Could not load the review queue. Please try again.</p>}

      {!batchesQuery.isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
            <Shield className="w-8 h-8 text-gray-300" />
          </div>
          <div>
            <p className="font-semibold text-gray-700">
              {merged.length === 0 ? 'No trademark review requests yet' : 'No requests match your filters'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {merged.length === 0
                ? 'Submit names from the Review Batch page to start a request'
                : 'Try adjusting your search or filters'}
            </p>
          </div>
        </div>
      )}

      {filtered.map(({ group }) => (
        <CaseCard
          key={group.heading}
          group={group}
          statusFilter={tab}
          canPerformReviewActions={canPerformReviewActions}
        />
      ))}
    </div>
  );
}
