import { useState } from 'react';
import { Pill, Factory, TrendingUp, Globe2, ScrollText, History, Loader2, Target, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { apiClient } from '@/api/client';
import { saveConfirmedCase, buildStructuredPayload, type SuggestionForm, type BrandCase } from '@/lib/caseStore';

// Shared "Create a Case" intake form, reused as a modal from both the AI
// Name Generator and Brand Analysis pages (per the mock's Create-a-Case
// popup — Sun_Pharma_Screens_V1.2.pptx, slides 3-6). Extracted from the old
// standalone Brand Suggestion Form page, which no longer exists as its own
// route — this modal is now the only way to create a case.
//
// Field requirements (required/optional/conditional, max length, allowed
// character sets) follow the mentor-provided BRD validation table verbatim.

export interface NamingCriteria {
  treatment: string;
  emotion_connected: string;
  naming_style: string;
  product_benefit: string;
  brand_coining_preferences: string;
  description: string;
}

const DEFAULT_NAMING_CRITERIA: NamingCriteria = {
  treatment: '', emotion_connected: '', naming_style: '',
  product_benefit: '', brand_coining_preferences: '', description: '',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthISO() {
  return new Date().toISOString().slice(0, 7);
}

function makeInitial(suggestedBy: string): SuggestionForm {
  return {
    generic_name: '', division: '', dosage_form: '', suggested_by: suggestedBy,
    dose: '', date: todayISO(), ailment: '', segment: '', therapy: '',
    promoting_indications: '', mfd_type: '', in_license: '',
    manufacturer_location: '', mfg_for_others_yn: '', mfg_for_others: '',
    marketer_name: '', seller_name: '', parent_brand_owner: '',
    expected_launch_month: '', expected_sale: '',
    dcgi_combination_approved: '', drug_schedule: '',
    domestic_brand_names: '', international_brand_names: '', innovator_brands: '',
    patent_validity: 'Patent Not in India',
    launch_after_expiry: '', launch_after_expiry_month: '',
    launch_during_validity: '', launch_during_validity_arrangement: '',
    inventor_name: '', patient_name: '', place_of_origin: '', other_historical_association: '',
  };
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 placeholder:text-gray-300 disabled:bg-gray-50 disabled:text-gray-400';

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[11px] text-red-500 mt-1">{message}</p>;
}

function Field({
  label, value, onChange, onBlur, placeholder, type = 'text', required, error, min, max, maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  placeholder?: string; type?: string; required?: boolean; error?: string; min?: string; max?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        className={cn(inputCls, error && 'border-red-400 ring-1 ring-red-200')}
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <FieldError message={error} />
    </div>
  );
}

function AreaField({
  label, value, onChange, onBlur, placeholder, required, error, maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  placeholder?: string; required?: boolean; error?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <textarea
        className={cn(inputCls, 'resize-y min-h-[64px]', error && 'border-red-400 ring-1 ring-red-200')}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <FieldError message={error} />
    </div>
  );
}

function SelectField({
  label, value, onChange, onBlur, options, required, error,
}: { label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; options: string[]; required?: boolean; error?: string }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        className={cn(inputCls, error && 'border-red-400 ring-1 ring-red-200')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      >
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <FieldError message={error} />
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
        <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center">
          <Icon className="w-4 h-4 text-orange-600" />
        </div>
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

// ── Character sets — only the fields the BRD table actually restricts ──────
const CHARSET_GENERIC_NAME = /^[A-Za-z0-9\s/\-.&]*$/;
const CHARSET_DOSAGE_FORM = /^[A-Za-z0-9\s/\-]*$/;
const CHARSET_DOSE = /^[A-Za-z0-9\s.\-/]*$/;
const CHARSET_DIVISION = /^[A-Za-z0-9\s/\-&]*$/;

type FieldRule = {
  key: keyof SuggestionForm;
  label: string;
  required: boolean;
  maxLength?: number;
  charset?: RegExp;
  charsetHint?: string;
  validate?: (value: string, form: SuggestionForm) => string | null;
};

const FIELD_RULES: FieldRule[] = [
  { key: 'generic_name', label: 'Generic Name', required: true, maxLength: 100, charset: CHARSET_GENERIC_NAME, charsetHint: 'letters, numbers, spaces, /, -, ., &' },
  { key: 'dosage_form', label: 'Dosage Form', required: true, maxLength: 50, charset: CHARSET_DOSAGE_FORM, charsetHint: 'letters, numbers, spaces, /, -' },
  { key: 'dose', label: 'Dose', required: false, maxLength: 20, charset: CHARSET_DOSE, charsetHint: 'letters, numbers, spaces, ., /, -' },
  { key: 'division', label: 'Division (DIV)', required: false, maxLength: 50, charset: CHARSET_DIVISION, charsetHint: 'letters, numbers, spaces, /, -, &' },
  { key: 'suggested_by', label: 'Suggested By', required: false, maxLength: 100 },
  {
    key: 'date', label: 'Date', required: false,
    validate: (v) => (v && v > todayISO() ? 'Date cannot be set in the future' : null),
  },
  { key: 'ailment', label: 'Ailment / Curative Action', required: true, maxLength: 500 },
  { key: 'segment', label: 'Segment', required: true, maxLength: 100 },
  { key: 'therapy', label: 'Therapy', required: true, maxLength: 100 },
  { key: 'promoting_indications', label: 'Promoting Indication(s)', required: true, maxLength: 500 },
  { key: 'manufacturer_location', label: 'Product Manufacturer Name & Location', required: false, maxLength: 250 },
  { key: 'mfd_type', label: 'Manufactured In-house or Outsourced?', required: false },
  { key: 'in_license', label: 'Is this an In-License product?', required: false },
  { key: 'mfg_for_others_yn', label: 'Same manufacturer making this for others?', required: false },
  {
    key: 'mfg_for_others', label: 'Marks of Others', required: false, maxLength: 500,
    validate: (v, form) => (form.mfg_for_others_yn === 'Yes' && !v ? 'Marks of others is required when the answer is Yes' : null),
  },
  { key: 'parent_brand_owner', label: 'Owner of Existing Parent Brand', required: false, maxLength: 100 },
  { key: 'marketer_name', label: 'Marketer Name of the Product', required: false, maxLength: 150 },
  { key: 'seller_name', label: "Product Seller's Name", required: false, maxLength: 150 },
  {
    key: 'expected_launch_month', label: 'Expected Launch Month', required: false,
    validate: (v) => (v && v < currentMonthISO() ? 'Launch month cannot be in the past. Choose the current month or later' : null),
  },
  { key: 'expected_sale', label: 'Expected Sale of the Products', required: false, maxLength: 100 },
  { key: 'dcgi_combination_approved', label: 'Is this DCGI Combination Approved?', required: false },
  { key: 'drug_schedule', label: 'Scheduled / Non-Scheduled Drug', required: false },
  { key: 'domestic_brand_names', label: 'Domestic Brand Names', required: false, maxLength: 500 },
  { key: 'international_brand_names', label: 'International Brand Names', required: false, maxLength: 500 },
  { key: 'innovator_brands', label: 'Innovator Brand Names', required: false, maxLength: 500 },
  { key: 'patent_validity', label: 'Patent Status: Expired / Valid Till', required: true, maxLength: 250 },
  { key: 'launch_after_expiry', label: 'Launching After Expiry of Patent?', required: true },
  {
    key: 'launch_after_expiry_month', label: 'Launch Timing (Month/Year)', required: false,
    validate: (v, form) => (form.launch_after_expiry === 'Yes' && !v ? 'Launch timing is required when the answer is Yes' : null),
  },
  { key: 'launch_during_validity', label: 'Launching During Validity of Patent?', required: false },
  {
    key: 'launch_during_validity_arrangement', label: 'Arrangement', required: false, maxLength: 500,
    validate: (v, form) => (form.launch_during_validity === 'Yes' && !v ? 'Arrangement is required when the answer is Yes' : null),
  },
  { key: 'inventor_name', label: 'Inventor Name', required: false, maxLength: 150 },
  { key: 'patient_name', label: 'Patient Name', required: false, maxLength: 150 },
  { key: 'place_of_origin', label: 'Place of Origin', required: false, maxLength: 150 },
  { key: 'other_historical_association', label: 'Other Relevant Historical Association', required: false, maxLength: 500 },
];

function validateField(rule: FieldRule, form: SuggestionForm): string | null {
  const value = String(form[rule.key] ?? '').trim();
  if (rule.required && !value) return `${rule.label} is mandatory`;
  if (value && rule.maxLength && value.length > rule.maxLength) return `${rule.label} must be ${rule.maxLength} characters or fewer`;
  if (value && rule.charset && !rule.charset.test(value)) return `${rule.label} allows only ${rule.charsetHint}`;
  if (rule.validate) return rule.validate(value, form);
  return null;
}

type NamingFieldRule = { key: keyof NamingCriteria; label: string; required: boolean; maxLength: number };

const NAMING_FIELD_RULES: NamingFieldRule[] = [
  { key: 'treatment', label: 'Treatment Approach', required: true, maxLength: 500 },
  { key: 'emotion_connected', label: 'Emotional Connection', required: true, maxLength: 500 },
  { key: 'naming_style', label: 'Naming Style', required: true, maxLength: 200 },
  { key: 'product_benefit', label: 'Product Benefit', required: true, maxLength: 500 },
  { key: 'brand_coining_preferences', label: 'Applicable Brand Coining Preferences', required: true, maxLength: 500 },
  { key: 'description', label: 'Additional Naming Instructions', required: false, maxLength: 500 },
];

function validateNamingField(rule: NamingFieldRule, naming: NamingCriteria): string | null {
  const value = String(naming[rule.key] ?? '').trim();
  if (rule.required && !value) return `${rule.label} is mandatory`;
  if (value && value.length > rule.maxLength) return `${rule.label} must be ${rule.maxLength} characters or fewer`;
  return null;
}

function validateAll(form: SuggestionForm, naming: NamingCriteria): Map<string, string> {
  const errors = new Map<string, string>();
  for (const rule of FIELD_RULES) {
    const message = validateField(rule, form);
    if (message) errors.set(rule.key, message);
  }
  for (const rule of NAMING_FIELD_RULES) {
    const message = validateNamingField(rule, naming);
    if (message) errors.set(`naming.${rule.key}`, message);
  }
  return errors;
}

export interface CreateCaseResult {
  caseRecord: BrandCase;
  namingCriteria: NamingCriteria;
}

export function CreateCaseModal({
  open, onClose, onSuccess, submitLabel = 'Generate Names', suggestedBy,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: CreateCaseResult) => void;
  submitLabel?: string;
  suggestedBy?: string;
}) {
  const [form, setForm] = useState<SuggestionForm>(() => makeInitial(suggestedBy ?? ''));
  const [naming, setNaming] = useState<NamingCriteria>(DEFAULT_NAMING_CRITERIA);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<SuggestionForm>) => setForm((f) => ({ ...f, ...patch }));
  const updateNaming = (patch: Partial<NamingCriteria>) => setNaming((n) => ({ ...n, ...patch }));

  const clearForm = () => {
    setForm(makeInitial(suggestedBy ?? ''));
    setNaming(DEFAULT_NAMING_CRITERIA);
    setErrors(new Map());
  };

  const blurValidate = (key: keyof SuggestionForm) => {
    const rule = FIELD_RULES.find((r) => r.key === key);
    if (!rule) return;
    setErrors((prev) => {
      const next = new Map(prev);
      const message = validateField(rule, form);
      if (message) next.set(key, message); else next.delete(key);
      return next;
    });
  };

  const blurValidateNaming = (key: keyof NamingCriteria) => {
    const rule = NAMING_FIELD_RULES.find((r) => r.key === key);
    if (!rule) return;
    setErrors((prev) => {
      const next = new Map(prev);
      const message = validateNamingField(rule, naming);
      if (message) next.set(`naming.${key}`, message); else next.delete(`naming.${key}`);
      return next;
    });
  };

  async function handleSubmit() {
    const fieldErrors = validateAll(form, naming);
    if (fieldErrors.size) {
      setErrors(fieldErrors);
      const firstMessages = Array.from(fieldErrors.values()).slice(0, 3);
      toast.error(
        `${fieldErrors.size} field(s) need attention: ${firstMessages.join('; ')}${fieldErrors.size > 3 ? '…' : ''}`
      );
      return;
    }
    setErrors(new Map());
    const payload = buildStructuredPayload(form);
    setSubmitting(true);
    try {
      const response = await apiClient.saveSuggestion({
        ...payload,
        count: 10,
        id: null,
      });
      const caseId = response?.id ?? response?.case_id;
      if (!caseId) {
        toast.error('Could not save this case right now. Please try again.');
        return;
      }
      const caseRecord = saveConfirmedCase(form, caseId);
      onSuccess({ caseRecord, namingCriteria: naming });
    } catch (err) {
      // A 409 here means this exact Molecule + Division + Dosage Form
      // already exists as a case (see suggestion.py's duplicate check) —
      // that message is specific and actionable, so it's shown as-is
      // instead of the generic fallback.
      const e = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = e?.response?.data?.detail;
      toast.error(e?.response?.status === 409 && detail ? detail : 'Could not save this case right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl lg:max-w-5xl xl:max-w-6xl w-[92vw] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Brand Suggestion Form</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-2">
          <Section icon={Pill} title="Product Information">
            <Field label="Generic Name" value={form.generic_name} onChange={(v) => update({ generic_name: v })} onBlur={() => blurValidate('generic_name')} placeholder="e.g. Paracetamol" required maxLength={100} error={errors.get('generic_name')} />
            <Field label="Dosage Form" value={form.dosage_form} onChange={(v) => update({ dosage_form: v })} onBlur={() => blurValidate('dosage_form')} placeholder="e.g. Tablet, Syrup, Injection" required maxLength={50} error={errors.get('dosage_form')} />
            <Field label="Dose" value={form.dose} onChange={(v) => update({ dose: v })} onBlur={() => blurValidate('dose')} placeholder="e.g. 500 mg" maxLength={20} error={errors.get('dose')} />
            <Field label="Division (DIV)" value={form.division} onChange={(v) => update({ division: v })} onBlur={() => blurValidate('division')} maxLength={50} error={errors.get('division')} />
            <Field label="Suggested By" value={form.suggested_by} onChange={(v) => update({ suggested_by: v })} onBlur={() => blurValidate('suggested_by')} maxLength={100} error={errors.get('suggested_by')} />
            <Field label="Date" type="date" value={form.date} onChange={(v) => update({ date: v })} onBlur={() => blurValidate('date')} max={todayISO()} error={errors.get('date')} />
          </Section>

          <Section icon={TrendingUp} title="Medical Information">
            <Field label="Ailment / Curative Action" value={form.ailment} onChange={(v) => update({ ailment: v })} onBlur={() => blurValidate('ailment')} required maxLength={500} error={errors.get('ailment')} />
            <Field label="Segment" value={form.segment} onChange={(v) => update({ segment: v })} onBlur={() => blurValidate('segment')} required maxLength={100} error={errors.get('segment')} />
            <Field label="Therapy" value={form.therapy} onChange={(v) => update({ therapy: v })} onBlur={() => blurValidate('therapy')} required maxLength={100} error={errors.get('therapy')} />
            <AreaField label="Promoting Indication(s)" value={form.promoting_indications} onChange={(v) => update({ promoting_indications: v })} onBlur={() => blurValidate('promoting_indications')} required maxLength={500} error={errors.get('promoting_indications')} />
          </Section>

          <Section icon={Factory} title="Manufacturing Information">
            <Field label="Product Manufacturer Name & Location" value={form.manufacturer_location} onChange={(v) => update({ manufacturer_location: v })} onBlur={() => blurValidate('manufacturer_location')} maxLength={250} error={errors.get('manufacturer_location')} />
            <SelectField label="Manufactured In-house or Outsourced?" value={form.mfd_type} onChange={(v) => update({ mfd_type: v })} onBlur={() => blurValidate('mfd_type')} options={['In-house', 'Outsourced']} error={errors.get('mfd_type')} />
            <SelectField label="Is this an In-License product?" value={form.in_license} onChange={(v) => update({ in_license: v })} onBlur={() => blurValidate('in_license')} options={['Yes', 'No']} error={errors.get('in_license')} />
            <SelectField label="Same manufacturer making this for others?" value={form.mfg_for_others_yn} onChange={(v) => update({ mfg_for_others_yn: v })} onBlur={() => blurValidate('mfg_for_others_yn')} options={['Yes', 'No']} error={errors.get('mfg_for_others_yn')} />
            <div className="md:col-span-2">
              <AreaField label="Marks of Others (required if Same Manufacturer = Yes)" value={form.mfg_for_others} onChange={(v) => update({ mfg_for_others: v })} onBlur={() => blurValidate('mfg_for_others')} required={form.mfg_for_others_yn === 'Yes'} maxLength={500} error={errors.get('mfg_for_others')} />
            </div>
            <Field label="Owner of Existing Parent Brand" value={form.parent_brand_owner} onChange={(v) => update({ parent_brand_owner: v })} onBlur={() => blurValidate('parent_brand_owner')} maxLength={100} error={errors.get('parent_brand_owner')} />
          </Section>

          <Section icon={TrendingUp} title="Commercial Information">
            <Field label="Marketer Name of the Product" value={form.marketer_name} onChange={(v) => update({ marketer_name: v })} onBlur={() => blurValidate('marketer_name')} maxLength={150} error={errors.get('marketer_name')} />
            <Field label="Product Seller's Name" value={form.seller_name} onChange={(v) => update({ seller_name: v })} onBlur={() => blurValidate('seller_name')} maxLength={150} error={errors.get('seller_name')} />
            <Field
              label="Expected Launch Month" type="month" value={form.expected_launch_month}
              onChange={(v) => update({ expected_launch_month: v })} onBlur={() => blurValidate('expected_launch_month')}
              min={currentMonthISO()} error={errors.get('expected_launch_month')}
            />
            <Field label="Expected Sale of the Products" value={form.expected_sale} onChange={(v) => update({ expected_sale: v })} onBlur={() => blurValidate('expected_sale')} placeholder="e.g. ₹ 5 Cr / year" maxLength={100} error={errors.get('expected_sale')} />
          </Section>

          <Section icon={ScrollText} title="Regulatory Information">
            <SelectField label="Is this DCGI Combination Approved?" value={form.dcgi_combination_approved} onChange={(v) => update({ dcgi_combination_approved: v })} onBlur={() => blurValidate('dcgi_combination_approved')} options={['Yes', 'No']} error={errors.get('dcgi_combination_approved')} />
            <SelectField label="Scheduled / Non-Scheduled Drug" value={form.drug_schedule} onChange={(v) => update({ drug_schedule: v })} onBlur={() => blurValidate('drug_schedule')} options={['Scheduled', 'Non-Scheduled']} error={errors.get('drug_schedule')} />
          </Section>

          <Section icon={Globe2} title="Brand Information">
            <AreaField label="Domestic Brand Names" value={form.domestic_brand_names} onChange={(v) => update({ domestic_brand_names: v })} onBlur={() => blurValidate('domestic_brand_names')} maxLength={500} error={errors.get('domestic_brand_names')} />
            <AreaField label="International Brand Names" value={form.international_brand_names} onChange={(v) => update({ international_brand_names: v })} onBlur={() => blurValidate('international_brand_names')} maxLength={500} error={errors.get('international_brand_names')} />
            <AreaField label="Innovator Brand Names" value={form.innovator_brands} onChange={(v) => update({ innovator_brands: v })} onBlur={() => blurValidate('innovator_brands')} maxLength={500} error={errors.get('innovator_brands')} />
          </Section>

          <Section icon={ScrollText} title="Patent Information">
            <Field label="Patent Status: Expired / Valid Till" value={form.patent_validity} onChange={(v) => update({ patent_validity: v })} onBlur={() => blurValidate('patent_validity')} required maxLength={250} error={errors.get('patent_validity')} />
            <SelectField label="Launching After Expiry of Patent?" value={form.launch_after_expiry} onChange={(v) => update({ launch_after_expiry: v })} onBlur={() => blurValidate('launch_after_expiry')} options={['Yes', 'No']} required error={errors.get('launch_after_expiry')} />
            <Field
              label="Launch Timing (required if Yes above)" type="month" value={form.launch_after_expiry_month}
              onChange={(v) => update({ launch_after_expiry_month: v })} onBlur={() => blurValidate('launch_after_expiry_month')}
              required={form.launch_after_expiry === 'Yes'} error={errors.get('launch_after_expiry_month')}
            />
            <SelectField label="Launching During Validity of Patent?" value={form.launch_during_validity} onChange={(v) => update({ launch_during_validity: v })} onBlur={() => blurValidate('launch_during_validity')} options={['Yes', 'No']} error={errors.get('launch_during_validity')} />
            <div className="md:col-span-2">
              <AreaField label="Arrangement (required if Launching During Validity = Yes)" value={form.launch_during_validity_arrangement} onChange={(v) => update({ launch_during_validity_arrangement: v })} onBlur={() => blurValidate('launch_during_validity_arrangement')} required={form.launch_during_validity === 'Yes'} maxLength={500} error={errors.get('launch_during_validity_arrangement')} />
            </div>
          </Section>

          {/* Molecule / Product History — all optional. Not yet backed by a
              database column on the backend (see caseStore.buildStructuredPayload) —
              captured here so nothing is lost once backend support exists. */}
          <Section icon={History} title="Molecule / Product History">
            <Field label="Inventor Name" value={form.inventor_name} onChange={(v) => update({ inventor_name: v })} onBlur={() => blurValidate('inventor_name')} maxLength={150} error={errors.get('inventor_name')} />
            <Field label="Patient Name" value={form.patient_name} onChange={(v) => update({ patient_name: v })} onBlur={() => blurValidate('patient_name')} maxLength={150} error={errors.get('patient_name')} />
            <Field label="Place of Origin" value={form.place_of_origin} onChange={(v) => update({ place_of_origin: v })} onBlur={() => blurValidate('place_of_origin')} maxLength={150} error={errors.get('place_of_origin')} />
            <div className="md:col-span-2">
              <AreaField label="Other Relevant Historical Association" value={form.other_historical_association} onChange={(v) => update({ other_historical_association: v })} onBlur={() => blurValidate('other_historical_association')} maxLength={500} error={errors.get('other_historical_association')} />
            </div>
          </Section>

          {/* Naming Criteria — feeds AI Name Generator refinement. */}
          <Section icon={Target} title="Naming Criteria">
            <Field label="Treatment Approach" value={naming.treatment} onChange={(v) => updateNaming({ treatment: v })} onBlur={() => blurValidateNaming('treatment')} placeholder="e.g. Rapid pain relief" required maxLength={500} error={errors.get('naming.treatment')} />
            <Field label="Emotional Connection" value={naming.emotion_connected} onChange={(v) => updateNaming({ emotion_connected: v })} onBlur={() => blurValidateNaming('emotion_connected')} placeholder="e.g. Relief, Comfort, Freedom of Movement" required maxLength={500} error={errors.get('naming.emotion_connected')} />
            <Field label="Naming Style" value={naming.naming_style} onChange={(v) => updateNaming({ naming_style: v })} onBlur={() => blurValidateNaming('naming_style')} placeholder="e.g. Modern, Memorable, Easy to Pronounce" required maxLength={200} error={errors.get('naming.naming_style')} />
            <Field label="Product Benefit" value={naming.product_benefit} onChange={(v) => updateNaming({ product_benefit: v })} onBlur={() => blurValidateNaming('product_benefit')} placeholder="e.g. Faster onset of action, improved compliance" required maxLength={500} error={errors.get('naming.product_benefit')} />
            <div className="md:col-span-2">
              <AreaField label="Applicable Brand Coining Preferences" value={naming.brand_coining_preferences} onChange={(v) => updateNaming({ brand_coining_preferences: v })} onBlur={() => blurValidateNaming('brand_coining_preferences')} placeholder="e.g. Avoid molecule-derived stems, prefer 2-3 syllable coined words" required maxLength={500} error={errors.get('naming.brand_coining_preferences')} />
            </div>
            <div className="md:col-span-2">
              <AreaField label="Additional Naming Instructions" value={naming.description} onChange={(v) => updateNaming({ description: v })} onBlur={() => blurValidateNaming('description')} placeholder="Optional: anything else the AI should factor in" maxLength={500} error={errors.get('naming.description')} />
            </div>
          </Section>

          {/* Buttons live at the natural end of the scrollable form content,
              not pinned to the bottom of the dialog — matching the mock
              (Sun_Pharma_Screens_V1.2, slide 6), which only shows them once
              the user has actually scrolled to the end of the form. */}
          <div className="flex items-center justify-start gap-3 pt-4 border-t border-gray-100 flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4 gap-2 text-sm font-medium border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm"
              onClick={clearForm}
            >
              <Eraser className="w-4 h-4 text-gray-500" /> Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4 text-sm font-medium border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-10 px-5 gap-2 text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white shadow-sm"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
