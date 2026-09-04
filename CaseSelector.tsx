import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Search } from 'lucide-react';
import { apiClient } from '@/api/client';
import { listCases, getCase, cacheFromBackend, caseDisplayName, type BrandCase } from '@/lib/caseStore';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function CaseSelector({
  value,
  onSelect,
  className,
}: {
  value?: string;
  onSelect: (c: BrandCase | null) => void;
  className?: string;
}) {
  const [, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const casesQuery = useQuery({
    queryKey: ['suggestions'],
    queryFn: () => apiClient.listSuggestions(),
    staleTime: 30 * 1000,
  });

  const rawCases: BrandCase[] = casesQuery.data
    ? casesQuery.data.map((s) => cacheFromBackend(s)).sort((a, b) => b.saved_at.localeCompare(a.saved_at))
    : listCases();

  const cases = [...rawCases];
  if (value && !cases.some((c) => c.case_id === value)) {
    const local = getCase(value);
    if (local) {
      cases.unshift(local);
    } else {
      cases.unshift({
        case_id: value,
        id: value,
        generic_name: value,
        division: '',
        dosage_form: '',
        suggested_by: '',
        dose: '',
        date: '',
        ailment: '',
        segment: '',
        therapy: '',
        promoting_indications: '',
        mfd_type: '',
        in_license: '',
        manufacturer_location: '',
        mfg_for_others_yn: '',
        mfg_for_others: '',
        marketer_name: '',
        seller_name: '',
        parent_brand_owner: '',
        expected_launch_month: '',
        expected_sale: '',
        dcgi_combination_approved: '',
        drug_schedule: '',
        domestic_brand_names: '',
        international_brand_names: '',
        innovator_brands: '',
        patent_validity: '',
        launch_after_expiry: '',
        launch_after_expiry_month: '',
        launch_during_validity: '',
        launch_during_validity_arrangement: '',
        inventor_name: '',
        patient_name: '',
        place_of_origin: '',
        other_historical_association: '',
        saved_at: new Date().toISOString(),
      });
    }
  }

  const selectedCase = value ? cases.find((c) => c.case_id === value) : null;
  const selectedLabel = selectedCase ? caseDisplayName(selectedCase) : value || undefined;

  const q = search.trim().toLowerCase();
  const matchesSearch = (c: BrandCase) =>
    !q || caseDisplayName(c).toLowerCase().includes(q) || c.case_id.toLowerCase().includes(q);
  const hasMatch = cases.some(matchesSearch);

  return (
    <div className={cn('flex items-center min-w-0', className)}>
      <Select
        value={value ?? ''}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setSearch('');
          } else {
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }
        }}
        onValueChange={(v) => onSelect(v ? cases.find((c) => c.case_id === v) ?? null : null)}
      >
        {/* The file icon lives inside the trigger now — it used to sit as a
            sibling outside it, outside the bordered box entirely. */}
        <SelectTrigger className="flex-1 min-w-0 h-9 text-sm" title="Select a saved case">
          <FileText className="w-4 h-4 text-orange-500 flex-shrink-0" />
          <SelectValue placeholder={
            casesQuery.isLoading ? 'Loading cases…' : cases.length ? 'Select a Case…' : 'No saved cases yet'
          }>
            {selectedLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className="max-h-72 w-[min(90vw,24rem)] p-0"
        >
          {/* Sticky above the scrollable item list (not just prepended to
              it) so it stays put while a long case list scrolls beneath it.
              Keystrokes are kept from bubbling to Radix's own type-ahead
              handling (which would otherwise also try to jump-select an
              item as you type here) — except Escape, which still needs to
              reach Radix's dismiss-on-Escape listener to close the popup. */}
          <div className="sticky top-0 z-10 bg-white p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
                placeholder="Search cases…"
                className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-1 focus:ring-orange-300"
              />
            </div>
          </div>
          <div className="p-1">
            {casesQuery.isLoading && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading cases…
              </div>
            )}
            {casesQuery.isError && (
              <div className="px-3 py-2 text-xs text-red-500">Could not reach the server. Showing cases cached on this device.</div>
            )}
            {!casesQuery.isLoading && !hasMatch && (
              <div className="px-3 py-2 text-xs text-gray-400">No cases match "{search}"</div>
            )}
            {/* Every case stays mounted as a SelectItem regardless of the
                search text — only its visibility (`hidden`) toggles. Actually
                filtering this list (mounting/unmounting SelectItems per
                keystroke) made Radix's internal collection/position
                recalculation steal focus back from the search input after
                every character, so this was the only way to filter that kept
                the search box usable for more than one keystroke at a time. */}
            {cases.map((c) => (
              <SelectItem
                key={c.case_id}
                value={c.case_id}
                className={cn('text-sm', !matchesSearch(c) && 'hidden')}
                title={caseDisplayName(c) + ` (${c.case_id})`}
              >
                <span className="block truncate">{caseDisplayName(c)}</span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
