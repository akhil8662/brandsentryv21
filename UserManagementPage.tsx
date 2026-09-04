import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users,
  Plus,
  Pencil,
  Ban,
  CheckCircle2,
  Trash2,
  Shield,
  Search,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn, formatDate } from '@/lib/utils';
import type { User } from '@/types';

// Helper to format role names cleanly according to BRD V1.2
function getRoleDisplay(role: string, isSuperuser: boolean) {
  const r = (role || '').toLowerCase();
  if (isSuperuser || r === 'super_admin') {
    return { label: 'Super Admin', color: 'bg-purple-100 text-purple-800 border-purple-200' };
  }
  if (r === 'admin') {
    return { label: 'Admin', color: 'bg-orange-100 text-orange-800 border-orange-200' };
  }
  if (r === 'brand_marketing_admin' || r === 'brand_market_admin') {
    return { label: 'Brand Marketing Admin', color: 'bg-blue-100 text-blue-800 border-blue-200' };
  }
  if (r === 'brand_marketing_user' || r === 'brand_market_user' || r === 'business_team') {
    return { label: 'Brand Marketing User', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
  }
  if (r === 'trademark_admin') {
    return { label: 'Trademark Admin', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  }
  if (r === 'trademark_user' || r === 'trademark_team') {
    return { label: 'Trademark User', color: 'bg-teal-100 text-teal-800 border-teal-200' };
  }
  return { label: role, color: 'bg-gray-100 text-gray-800 border-gray-200' };
}


const EMPTY_FORM = {
  full_name: '',
  email: '',
  password: '',
  role: 'brand_market_user',
  department: '',
  is_superuser: false,
};

type UserFormData = typeof EMPTY_FORM;

interface UserFormModalProps {
  open: boolean;
  onClose: () => void;
  editingUser: User | null;
}

function UserFormModal({ open, onClose, editingUser }: UserFormModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<UserFormData>(() =>
    editingUser
      ? {
          full_name: editingUser.full_name,
          email: editingUser.email,
          password: '',
          role: editingUser.is_superuser ? 'super_admin' : editingUser.role,
          department: editingUser.department || '',
          is_superuser: editingUser.is_superuser || editingUser.role === 'super_admin',
        }
      : { ...EMPTY_FORM }
  );

  const [errors, setErrors] = useState<Partial<Record<keyof UserFormData, string>>>({});

  // Reset form when modal opens or editing user changes
  React.useEffect(() => {
    if (editingUser) {
      setForm({
        full_name: editingUser.full_name,
        email: editingUser.email,
        password: '',
        role: editingUser.is_superuser ? 'super_admin' : editingUser.role,
        department: editingUser.department || '',
        is_superuser: editingUser.is_superuser || editingUser.role === 'super_admin',
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
    setErrors({});
  }, [editingUser, open]);

  const createMutation = useMutation({
    mutationFn: (d: UserFormData) => {
      const isSuper = d.role === 'super_admin' || d.is_superuser;
      return apiClient.createAdminUser({
        email: d.email.trim(),
        full_name: d.full_name.trim(),
        password: d.password,
        role: d.role,
        department: d.department.trim() || undefined,
        is_superuser: isSuper,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User created successfully');
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to create user');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (d: UserFormData) => {
      const isSuper = d.role === 'super_admin' || d.is_superuser;
      return apiClient.updateAdminUser(editingUser!.id, {
        full_name: d.full_name.trim(),
        role: d.role,
        department: d.department.trim() || undefined,
        is_superuser: isSuper,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User updated successfully');
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to update user');
    },
  });

  const validate = () => {
    const errs: Partial<Record<keyof UserFormData, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Valid email is required'; // NOSONAR - fixed-width class, not backtracking-prone
    if (!editingUser) {
      if (!form.password) errs.password = 'Password is required'; // NOSONAR - form validation check, not a hardcoded credential
      else if (form.password.length < 8) errs.password = 'Password must be at least 8 characters'; // NOSONAR - form validation check, not a hardcoded credential
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (editingUser) {
      updateMutation.mutate(form);
    } else {
      createMutation.mutate(form);
    }
  };

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isBusy) onClose(); }}>
      <DialogContent className="max-w-md p-6 bg-white">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600">
              <Users className="w-4 h-4" />
            </div>
            {editingUser ? 'Edit User' : 'Add New User'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Full Name */}
          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 block">
              Full Name *
            </label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="e.g. John Deo"
              className={cn('text-xs h-9', errors.full_name && 'border-red-400 focus-visible:ring-red-400')}
            />
            {errors.full_name && <p className="text-[11px] text-red-500 mt-1">{errors.full_name}</p>}
          </div>

          {/* Email Address */}
          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 block">
              Email Address *
            </label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. analyst@pharmabi.com"
              disabled={!!editingUser}
              className={cn(
                'text-xs h-9',
                editingUser && 'bg-gray-100 cursor-not-allowed',
                errors.email && 'border-red-400 focus-visible:ring-red-400'
              )}
            />
            {errors.email && <p className="text-[11px] text-red-500 mt-1">{errors.email}</p>}
          </div>

          {/* Password (for new user) */}
          {!editingUser && (
            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 block">
                Password *
              </label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min. 8 characters"
                className={cn('text-xs h-9', errors.password && 'border-red-400 focus-visible:ring-red-400')}
              />
              {errors.password && <p className="text-[11px] text-red-500 mt-1">{errors.password}</p>}
            </div>
          )}

          {/* Role Selection matching BRD 5.2.12 */}
          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 block">
              Assigned Role *
            </label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v, is_superuser: v === 'super_admin' })}
            >
              <SelectTrigger className="text-xs h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="super_admin">Super Admin (Platform Owner)</SelectItem>
                <SelectItem value="admin">Admin (Operations Lead)</SelectItem>
                <SelectItem value="brand_market_admin">Brand Marketing Team Admin</SelectItem>
                <SelectItem value="brand_market_user">Brand Marketing Team User</SelectItem>
                <SelectItem value="trademark_admin">Trademark Team Admin</SelectItem>
                <SelectItem value="trademark_user">Trademark Team User</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Department */}
          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 block">
              Department
            </label>
            <Input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              placeholder="e.g. Business Team, Trademark Reviewer"
              className="text-xs h-9"
            />
          </div>

          <DialogFooter className="pt-3 border-t border-gray-100 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isBusy}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isBusy}
              className="text-xs h-9 bg-orange-600 hover:bg-orange-700 text-white font-semibold gap-1.5"
            >
              {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editingUser ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserManagementPage() {
  const { user: currentUser, isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  // Fetch users list
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiClient.getAdminUsers(),
  });

  // Toggle user active status
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      apiClient.updateAdminUser(id, { is_active }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(vars.is_active ? 'User activated' : 'User deactivated');
      setToggleTarget(null);
    },
    onError: () => {
      toast.error('Failed to update user status');
    },
  });

  // Delete user mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteAdminUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User permanently deleted');
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to delete user');
    },
  });

  const openCreateModal = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  // KPI Calculations
  const totalUsers = users.length;
  const adminCount = users.filter((u) => u.is_superuser || u.role === 'super_admin' || u.role === 'admin').length;
  const brandMarketingCount = users.filter(
    (u) => !u.is_superuser && (u.role === 'brand_market_admin' || u.role === 'brand_market_user' || u.role === 'business_team' || u.role === 'brand_marketing')
  ).length;
  const trademarkTeamCount = users.filter(
    (u) => !u.is_superuser && (u.role === 'trademark_admin' || u.role === 'trademark_user' || u.role === 'trademark_team')
  ).length;

  // If not super admin, display restricted banner
  if (!isSuperAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 text-center bg-white border border-gray-200 rounded-xl shadow-sm space-y-4">
        <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Super Admin Privileges Required</h2>
        <p className="text-sm text-gray-500">
          User Management and Role Assignment are restricted to Super Administrators per Section 5.2.12 of the BrandSentry BRD.
        </p>
      </div>
    );
  }

  // Filtered Users list
  const filteredUsers = users.filter((u) => {
    // Search query match
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchName = u.full_name?.toLowerCase().includes(q);
      const matchEmail = u.email?.toLowerCase().includes(q);
      const matchDept = u.department?.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchDept) return false;
    }

    // Role filter
    if (roleFilter !== 'all') {
      if (roleFilter === 'super_admin' && !(u.is_superuser || u.role === 'super_admin')) return false;
      if (roleFilter === 'admin' && (u.is_superuser || u.role !== 'admin')) return false;
      if (roleFilter === 'brand_market_admin' && u.role !== 'brand_market_admin') return false;
      if (roleFilter === 'brand_market_user' && u.role !== 'brand_market_user' && u.role !== 'business_team') return false;
      if (roleFilter === 'trademark_admin' && u.role !== 'trademark_admin') return false;
      if (roleFilter === 'trademark_user' && u.role !== 'trademark_user' && u.role !== 'trademark_team') return false;
    }

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
    }

    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      {/* Header with Title and Add User Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 border border-purple-200 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">User Management</h1>
            <p className="text-sm text-gray-500">Super Admin console for user onboarding and role-based access control</p>
          </div>
        </div>

        <Button
          onClick={openCreateModal}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs h-9 px-4 gap-1.5 shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      {/* 4 KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <Card className="border border-gray-200/80 bg-white shadow-sm">
          <CardContent className="p-5">
            <p className="text-3xl font-bold text-gray-900 tracking-tight">{isLoading ? '...' : totalUsers}</p>
            <p className="text-xs text-gray-500 font-medium mt-1">Total Platform Users</p>
          </CardContent>
        </Card>

        {/* Admins */}
        <Card className="border border-purple-100 bg-white shadow-sm">
          <CardContent className="p-5">
            <p className="text-3xl font-bold text-purple-600 tracking-tight">{isLoading ? '...' : adminCount}</p>
            <p className="text-xs text-gray-500 font-medium mt-1">Super Admins & Admins</p>
          </CardContent>
        </Card>

        {/* Brand Marketing Team */}
        <Card className="border border-blue-100 bg-white shadow-sm">
          <CardContent className="p-5">
            <p className="text-3xl font-bold text-blue-600 tracking-tight">
              {isLoading ? '...' : brandMarketingCount}
            </p>
            <p className="text-xs text-gray-500 font-medium mt-1">Brand Marketing Team</p>
          </CardContent>
        </Card>

        {/* Trademark Team */}
        <Card className="border border-emerald-100 bg-white shadow-sm">
          <CardContent className="p-5">
            <p className="text-3xl font-bold text-emerald-600 tracking-tight">
              {isLoading ? '...' : trademarkTeamCount}
            </p>
            <p className="text-xs text-gray-500 font-medium mt-1">Trademark Legal Team</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name or email..."
            className="pl-9 h-9 text-xs bg-white border-gray-200"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Role Filter */}
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-9 text-xs w-52 bg-white border-gray-200">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All 6 Roles</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="brand_market_admin">Brand Marketing Admin</SelectItem>
              <SelectItem value="brand_market_user">Brand Marketing User</SelectItem>
              <SelectItem value="trademark_admin">Trademark Admin</SelectItem>
              <SelectItem value="trademark_user">Trademark User</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-xs w-36 bg-white border-gray-200">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Users Table */}
      <Card className="border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
                  <th className="text-left py-3.5 px-5">USER</th>
                  <th className="text-left py-3.5 px-5">ROLE</th>
                  <th className="text-left py-3.5 px-5">DEPARTMENT</th>
                  <th className="text-left py-3.5 px-5">STATUS</th>
                  <th className="text-left py-3.5 px-5">CREATED</th>
                  <th className="text-center py-3.5 px-5">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-400">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-600 mb-2" />
                      Loading users...
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-400">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-30 text-gray-400" />
                      No users found matching your filters
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isSuper = u.is_superuser || u.role === 'super_admin';
                    const roleMeta = getRoleDisplay(u.role, isSuper);
                    const initial = (u.full_name || u.email).charAt(0).toUpperCase();

                    return (
                      <tr key={u.id} className={cn('hover:bg-gray-50/70 transition-colors', !u.is_active && 'opacity-60')}>
                        {/* USER */}
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0',
                                isSuper
                                  ? 'bg-purple-600'
                                  : u.role === 'admin'
                                  ? 'bg-orange-500'
                                  : u.role.startsWith('trademark')
                                  ? 'bg-emerald-600'
                                  : 'bg-blue-600'
                              )}
                            >
                              {initial}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-gray-900 truncate">
                                  {u.full_name}
                                </span>
                                {isSuper && (
                                  <Shield className="w-3.5 h-3.5 text-orange-600 flex-shrink-0 fill-orange-50" />
                                )}
                              </div>
                              <span className="text-gray-400 text-[11px] truncate block">
                                {u.email}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* ROLE */}
                        <td className="py-3.5 px-5">
                          <span
                            className={cn(
                              'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border',
                              roleMeta.color
                            )}
                          >
                            {roleMeta.label}
                          </span>
                        </td>

                        {/* DEPARTMENT */}
                        <td className="py-3.5 px-5 text-gray-600 font-medium">
                          {u.department || '—'}
                        </td>

                        {/* STATUS */}
                        <td className="py-3.5 px-5">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
                              u.is_active
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-gray-100 text-gray-500'
                            )}
                          >
                            <span
                              className={cn(
                                'w-1.5 h-1.5 rounded-full',
                                u.is_active ? 'bg-emerald-600' : 'bg-gray-400'
                              )}
                            />
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        {/* CREATED */}
                        <td className="py-3.5 px-5 text-gray-500 font-medium">
                          {formatDate(u.created_at)}
                        </td>

                        {/* ACTIONS */}
                        <td className="py-3.5 px-5">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Edit Button */}
                            <button
                              onClick={() => openEditModal(u)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                              title="Edit user"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {/* Deactivate / Reactivate Toggle */}
                            {u.id !== currentUser?.id && (
                              <button
                                onClick={() => setToggleTarget(u)}
                                className={cn(
                                  'w-7 h-7 rounded-lg flex items-center justify-center transition-colors',
                                  u.is_active
                                    ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                                    : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'
                                )}
                                title={u.is_active ? 'Deactivate user' : 'Reactivate user'}
                              >
                                {u.is_active ? (
                                  <Ban className="w-3.5 h-3.5" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                )}
                              </button>
                            )}

                            {/* Delete Button */}
                            {u.id !== currentUser?.id && !isSuper && (
                              <button
                                onClick={() => setDeleteTarget(u)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Modal */}
      <UserFormModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editingUser={editingUser}
      />

      {/* Deactivate / Activate Confirmation Dialog */}
      <Dialog open={!!toggleTarget} onOpenChange={(v) => { if (!v) setToggleTarget(null); }}>
        <DialogContent className="max-w-md p-6 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              {toggleTarget?.is_active ? (
                <>
                  <Ban className="w-5 h-5 text-amber-500" />
                  Deactivate User
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Activate User
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-xs text-gray-600 space-y-2">
            <p>
              Are you sure you want to {toggleTarget?.is_active ? 'deactivate' : 'activate'}{' '}
              <span className="font-semibold text-gray-900">{toggleTarget?.full_name}</span> ({toggleTarget?.email})?
            </p>
            <p className="text-gray-500">
              {toggleTarget?.is_active
                ? 'They will immediately lose access to the platform until reactivated.'
                : 'They will be able to log in and access permitted features again.'}
            </p>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setToggleTarget(null)}
              disabled={toggleActiveMutation.isPending}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                toggleTarget &&
                toggleActiveMutation.mutate({
                  id: toggleTarget.id,
                  is_active: !toggleTarget.is_active,
                })
              }
              disabled={toggleActiveMutation.isPending}
              className={cn(
                'text-xs h-9 font-semibold text-white gap-1.5',
                toggleTarget?.is_active
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              )}
            >
              {toggleActiveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {toggleTarget?.is_active ? 'Deactivate User' : 'Activate User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md p-6 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Delete User
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-xs text-gray-600 space-y-3">
            <p>
              Are you sure you want to permanently delete{' '}
              <span className="font-semibold text-gray-900">{deleteTarget?.full_name}</span> ({deleteTarget?.email})?
            </p>
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[11px] leading-relaxed">
              This action is irreversible. The user will be permanently removed from the system. Audit trails and past activity records are retained for compliance.
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="text-xs h-9 bg-red-600 hover:bg-red-700 text-white font-semibold gap-1.5"
            >
              {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
