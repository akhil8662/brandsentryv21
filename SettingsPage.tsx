import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Settings as SettingsIcon,
  User,
  Lock,
  Sliders,
  Bell,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RiskWeights } from '@/types';

const WEIGHT_LABELS: Record<
  keyof RiskWeights,
  { label: string; desc: string; color: string }
> = {
  trademark: {
    label: 'Trademark Conflict',
    desc: 'Weight given to registered IP India trademark matches',
    color: 'bg-blue-600',
  },
  phonetic: {
    label: 'Phonetic Similarity',
    desc: 'Weight given to Double Metaphone phonetic similarity detection',
    color: 'bg-purple-600',
  },
  semantic: {
    label: 'Semantic Similarity',
    desc: 'Weight given to vector embeddings / meaning-based AI analysis',
    color: 'bg-indigo-600',
  },
  market: {
    label: 'Market Presence',
    desc: 'Weight given to existing CDSCO & e-pharmacy brands',
    color: 'bg-orange-600',
  },
};

export function SettingsPage() {
  const { user: currentUser, refreshUser, isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  // Profile Form State
  const [fullName, setFullName] = useState(currentUser?.full_name || '');
  const [department, setDepartment] = useState(currentUser?.department || '');

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Notification toggles state
  const [notifHighRisk, setNotifHighRisk] = useState(true);
  const [notifGenComplete, setNotifGenComplete] = useState(true);
  const [notifReviews, setNotifReviews] = useState(true);
  const [notifSystem, setNotifSystem] = useState(true);

  // Sync user state when user loads
  useEffect(() => {
    if (currentUser) {
      setFullName(currentUser.full_name || '');
      setDepartment(currentUser.department || '');
    }
  }, [currentUser]);

  // Risk Weights Query & State
  const { data: serverWeights } = useQuery({
    queryKey: ['risk-weights'],
    queryFn: () => apiClient.getRiskWeights(),
  });

  const [localWeights, setLocalWeights] = useState<RiskWeights>({
    trademark: 0.4,
    phonetic: 0.25,
    semantic: 0.2,
    market: 0.15,
  });

  useEffect(() => {
    if (serverWeights) {
      setLocalWeights(serverWeights);
    }
  }, [serverWeights]);

  const weightSum =
    localWeights.trademark +
    localWeights.phonetic +
    localWeights.semantic +
    localWeights.market;
  const isWeightValid = Math.abs(weightSum - 1.0) <= 0.01;

  // Profile update mutation
  const profileMutation = useMutation({
    mutationFn: (payload: { full_name: string; department: string }) =>
      apiClient.updateProfile(payload),
    onSuccess: () => {
      toast.success('Profile updated successfully');
      if (refreshUser) refreshUser();
    },
    onError: () => {
      toast.error('Failed to update profile');
    },
  });

  // Change password mutation
  const passwordMutation = useMutation({
    mutationFn: (payload: { current_password: string; new_password: string }) =>
      apiClient.changePassword(payload),
    onSuccess: () => {
      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to update password');
    },
  });

  // Risk weights update mutation
  const weightsMutation = useMutation({
    mutationFn: (weights: RiskWeights) => apiClient.updateRiskWeights(weights),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risk-weights'] });
      toast.success('Risk assessment weights saved');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to save risk weights');
    },
  });

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error('Full name is required');
      return;
    }
    profileMutation.mutate({
      full_name: fullName.trim(),
      department: department.trim(),
    });
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error('Please enter your current password');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    passwordMutation.mutate({
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  const handleWeightChange = (key: keyof RiskWeights, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setLocalWeights((prev) => ({
        ...prev,
        [key]: Math.min(1, Math.max(0, num)),
      }));
    }
  };

  const isAdmin = currentUser?.is_superuser || currentUser?.role === 'admin';
  const roleDisplay = isAdmin
    ? 'Admin'
    : currentUser?.role === 'trademark_team'
    ? 'Trademark Team'
    : 'Brand Marketing Team';

  const userInitial = (currentUser?.full_name || currentUser?.email || 'U')
    .charAt(0)
    .toUpperCase();

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center flex-shrink-0 shadow-sm">
          <SettingsIcon className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
          <p className="text-sm text-gray-500">Manage your account and platform preferences</p>
        </div>
      </div>

      {/* Card 1: Profile */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardHeader className="border-b border-gray-100 bg-gray-50/50 pb-4">
          <CardTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <User className="w-4 h-4 text-orange-600" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* User Avatar + Details */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-700 text-2xl font-bold flex-shrink-0 shadow-sm">
              {userInitial}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-lg leading-tight truncate">
                {currentUser?.full_name || 'User'}
              </h3>
              <p className="text-xs text-gray-500 truncate mt-0.5">{currentUser?.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-800">
                  {roleDisplay}
                </span>
                {currentUser?.department && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700">
                    {currentUser.department}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Profile Form */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Full Name */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  Full Name
                </label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name..."
                  className="h-10 text-xs"
                />
              </div>

              {/* Email Address (Read-only) */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  Email Address
                </label>
                <Input
                  value={currentUser?.email || ''}
                  disabled
                  className="h-10 text-xs bg-gray-50 cursor-not-allowed text-gray-500"
                />
              </div>

              {/* Department */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  Department
                </label>
                <Input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Business Development, Trademark Review"
                  className="h-10 text-xs"
                />
              </div>

              {/* Role (Read-only) */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  Role
                </label>
                <Input
                  value={roleDisplay}
                  disabled
                  className="h-10 text-xs bg-gray-50 cursor-not-allowed text-gray-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={profileMutation.isPending}
                className="bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold h-9 px-5 gap-1.5 shadow-sm"
              >
                {profileMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save Profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Card 2: Change Password */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardHeader className="border-b border-gray-100 bg-gray-50/50 pb-4">
          <CardTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-orange-600" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Current Password */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  Current Password
                </label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 text-xs"
                />
              </div>

              {/* New Password */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  New Password
                </label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="h-10 text-xs"
                />
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 block">
                  Confirm New Password
                </label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={passwordMutation.isPending}
                variant="outline"
                className="border-gray-300 text-gray-800 hover:text-orange-600 hover:border-orange-300 text-xs font-semibold h-9 px-5 gap-1.5 shadow-sm"
              >
                {passwordMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Update Password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Card 3: Risk Score Weights (for Admin & Superuser) */}
      {isAdmin && (
        <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
          <CardHeader className="border-b border-gray-100 bg-gray-50/50 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-orange-600" />
                Risk Assessment Weights
                <Badge variant="secondary" className="text-[10px] font-bold bg-orange-100 text-orange-800 ml-1">
                  ADMIN CONFIG
                </Badge>
              </CardTitle>
              <div
                className={cn(
                  'px-2.5 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 border',
                  isWeightValid
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                )}
              >
                {isWeightValid ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-red-600" />
                )}
                Sum: {weightSum.toFixed(2)} {isWeightValid ? '(Valid: 1.00)' : '(Must equal 1.00)'}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <p className="text-xs text-gray-500">
              Configure the weight contribution of each risk component to the composite brand risk score.
              Values must sum to exactly 1.00 (100%).
            </p>

            <div className="space-y-4">
              {(Object.keys(WEIGHT_LABELS) as (keyof RiskWeights)[]).map((key) => {
                const info = WEIGHT_LABELS[key];
                const pct = Math.round(localWeights[key] * 100);

                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-gray-800">{info.label}</p>
                        <p className="text-[11px] text-gray-400">{info.desc}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          value={localWeights[key]}
                          onChange={(e) => handleWeightChange(key, e.target.value)}
                          className="w-20 text-right text-xs h-8"
                        />
                        <span className="text-xs font-bold text-gray-600 w-10 text-right">
                          {pct}%
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-200', info.color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => weightsMutation.mutate(localWeights)}
                disabled={!isWeightValid || weightsMutation.isPending}
                className="bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold h-9 px-5 gap-1.5 shadow-sm"
              >
                {weightsMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save Weights
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Card 4: Notification Preferences */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardHeader className="border-b border-gray-100 bg-gray-50/50 pb-4">
          <CardTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Bell className="w-4 h-4 text-orange-600" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-4 divide-y divide-gray-100">
            {/* High Risk Alerts */}
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-xs font-bold text-gray-800">High Risk Alerts</p>
                <p className="text-[11px] text-gray-400">Receive alert when screening identifies high risk conflict</p>
              </div>
              <input
                type="checkbox"
                checked={notifHighRisk}
                onChange={(e) => setNotifHighRisk(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
              />
            </div>

            {/* Generation Complete */}
            <div className="flex items-center justify-between pt-3">
              <div>
                <p className="text-xs font-bold text-gray-800">AI Generation Completion</p>
                <p className="text-[11px] text-gray-400">Notify when candidate brand names finish generating</p>
              </div>
              <input
                type="checkbox"
                checked={notifGenComplete}
                onChange={(e) => setNotifGenComplete(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
              />
            </div>

            {/* Review Batch Updates */}
            <div className="flex items-center justify-between pt-3">
              <div>
                <p className="text-xs font-bold text-gray-800">Legal Review Batch Updates</p>
                <p className="text-[11px] text-gray-400">Notify when legal batch status changes (Approved / Revision)</p>
              </div>
              <input
                type="checkbox"
                checked={notifReviews}
                onChange={(e) => setNotifReviews(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
              />
            </div>

            {/* System Updates */}
            <div className="flex items-center justify-between pt-3">
              <div>
                <p className="text-xs font-bold text-gray-800">Platform & Regulatory Updates</p>
                <p className="text-[11px] text-gray-400">Receive system notices, scheduled maintenance and WHO INN updates</p>
              </div>
              <input
                type="checkbox"
                checked={notifSystem}
                onChange={(e) => setNotifSystem(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
