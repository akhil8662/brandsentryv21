import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Scale } from 'lucide-react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScreeningProgress } from '@/components/ScreeningProgress';
import {
  RiskAssessmentBanner, SimilarityAnalysisCard, ConflictSourcesCard,
} from '@/components/ScreeningResultBlocks';

// Trademark Review's own "Detailed Analysis" popup — reuses the exact same
// DB-first lookup and screening-result blocks as Brand Analysis/Compare/AI
// Generator, so this page stays consistent with the rest of the app instead
// of building a second, different-looking summary view. Since every name
// here has necessarily already been screened at least once (that's how it
// got submitted for review in the first place), apiClient.compareBrand
// always resolves from cache/history — this never triggers a fresh pipeline
// run or an LLM call, matching Trademark Review's own "no LLM here" rule.
//
// A case can carry several submitted names — Prev/Next lets the reviewer
// page through all of them without closing and reopening the dialog.

function NameDetail({ brandName }: { brandName: string }) {
  const query = useQuery({
    queryKey: ['screening', brandName],
    queryFn: () => apiClient.compareBrand({ brand_name: brandName }),
    staleTime: 10 * 60 * 1000,
  });
  const sr = query.data?.screening_result;

  // A name reaching this modal was already screened before it could even be
  // submitted for review, so this virtually always resolves from history in
  // well under half a second — showing the 5-stage pipeline panel for that
  // instant is just flicker. Only a genuinely slow lookup (not the normal
  // case) actually takes long enough to justify showing it.
  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (!query.isLoading) {
      setShowProgress(false);
      return;
    }
    const t = setTimeout(() => setShowProgress(true), 400);
    return () => clearTimeout(t);
  }, [query.isLoading]);

  if (query.isLoading) {
    return showProgress ? <ScreeningProgress isScreening brandName={brandName} /> : null;
  }
  if (query.isError || !sr) {
    return (
      <p className="text-center text-sm text-red-500 py-10">
        Could not load the analysis for "{brandName}".
      </p>
    );
  }
  return (
    <div className="space-y-5">
      <RiskAssessmentBanner sr={sr} brandName={brandName} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SimilarityAnalysisCard sr={sr} />
        <ConflictSourcesCard sr={sr} />
      </div>
    </div>
  );
}

export function TrademarkNameDetailModal({
  names, initialIndex, open, onClose,
}: {
  names: string[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  // Re-sync whenever the dialog is (re)opened on a possibly different
  // starting name — without this, reopening on name #3 after previously
  // closing on name #1 would still show #1's stale index.
  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const brandName = names[index];
  const hasPrev = index > 0;
  const hasNext = index < names.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span className="flex items-center gap-2 text-purple-700">
              <Scale className="w-5 h-5" /> Detailed Analysis: "{brandName}"
            </span>
            {names.length > 1 && (
              <span className="flex items-center gap-2 text-sm font-normal text-gray-400 flex-shrink-0">
                <button
                  onClick={() => setIndex(i => Math.max(0, i - 1))}
                  disabled={!hasPrev}
                  title="Previous name"
                  className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {index + 1} of {names.length}
                <button
                  onClick={() => setIndex(i => Math.min(names.length - 1, i + 1))}
                  disabled={!hasNext}
                  title="Next name"
                  className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 pr-2 -mr-2">
          <NameDetail key={brandName} brandName={brandName} />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-gray-100 flex-shrink-0">
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={!hasPrev}
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => setIndex(i => Math.min(names.length - 1, i + 1))}
            disabled={!hasNext}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
