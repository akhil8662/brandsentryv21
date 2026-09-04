import axios, { type AxiosInstance } from 'axios';
import type {
  BrandSearchResponse, ScreeningRequest, GenerateNamesRequest,
  GeneratedName, IntelligenceData, AuditLogListResponse, User,
  LegalReview, SubmitReviewRequest,
  LegalReviewBatch, LegalReviewBatchDetail, SubmitBatchRequest,
  DataSourceStatus, CompareRequest, CompareResult, CartItem,
  DashboardMetrics,
} from '@/types';

export function getApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (
    envUrl &&
    !envUrl.includes('hosturl') &&
    !envUrl.includes('websiteip') &&
    !envUrl.includes('<') &&
    !envUrl.includes('placeholder')
  ) {
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname;
    return hostname ? `${protocol}//${hostname}:8000` : '';
  }
  return '';
}

const BASE_URL = getApiBaseUrl();

let _inMemoryToken: string | null = null;

class ApiClient {
  private client: AxiosInstance;

  setToken(token: string | null) {
    _inMemoryToken = token;
  }

  getToken(): string | null {
    return _inMemoryToken;
  }


  constructor() {
    this.client = axios.create({
      baseURL: getApiBaseUrl(),
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      withCredentials: true,
    });

    this.client.interceptors.request.use((config) => {
      if (!config.baseURL) {
        config.baseURL = getApiBaseUrl();
      }
      if (_inMemoryToken) {
        config.headers.Authorization = `Bearer ${_inMemoryToken}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const url = error.config?.url || '';
        const isLoginOrAuthCheck = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/me');
        if (error.response?.status === 401 && !isLoginOrAuthCheck) {
          _inMemoryToken = null;
                    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth & Profile
  async login(email: string, password: string) {
    const { data } = await this.client.post('/auth/login', { email, password });
    return data as { access_token: string; token_type: string; user: User };
  }

  async logout() {
    _inMemoryToken = null;
    await this.client.post('/auth/logout');
  }

  async refreshToken() {
    const { data } = await this.client.post('/auth/refresh');
    if (data?.access_token) {
      this.setToken(data.access_token);
    }
    return data as { access_token: string; token_type: string; user: User };
  }

  async getMe() {
    const { data } = await this.client.get('/auth/me');
    return data as User;
  }

  ssoLoginUrl() {
    return `${BASE_URL}/auth/sso/login`;
  }

  async ssoStatus() {
    const { data } = await this.client.get('/auth/sso/status');
    return data as { enabled: boolean };
  }

  async updateProfile(payload: { full_name?: string; department?: string }) {
    const { data } = await this.client.patch('/auth/profile', payload);
    return data as User;
  }

  async changePassword(payload: { current_password: string; new_password: string }) {
    const { data } = await this.client.post('/auth/change-password', payload);
    return data as { message: string };
  }

  // Dashboard Analytics
  async getDashboardMetrics(params: {
    date_from?: string;
    date_to?: string;
    user_id?: string;
    case_name?: string;
  } = {}) {
    const { data } = await this.client.get('/dashboard/metrics', { params });
    return data as DashboardMetrics;
  }

  // Brand Screening
  async screenBrand(request: ScreeningRequest) {
    const { data } = await this.client.post('/brands/screen', request, { timeout: 1260000 });
    return data as BrandSearchResponse;
  }

  async getBrandSearch(id: string) {
    const { data } = await this.client.get(`/brands/search/${id}`);
    return data as BrandSearchResponse;
  }

  async compareBrand(request: CompareRequest) {
    const { data } = await this.client.post('/brands/compare', request);
    return data as CompareResult;
  }

  // Brand Intelligence
  async getBrandIntelligence(brandName: string) {
    const { data } = await this.client.get(`/brands/intelligence/${encodeURIComponent(brandName)}`);
    return data as IntelligenceData;
  }

  async saveSuggestion(request: Record<string, unknown>) {
    const { data } = await this.client.post('/suggestions', request);
    return data as { id?: string; case_id?: string } & Record<string, unknown>;
  }

  async listSuggestions() {
    const { data } = await this.client.get('/suggestions');
    return data as Record<string, unknown>[];
  }

  async getSuggestion(caseId: string) {
    const { data } = await this.client.get(`/suggestions/${encodeURIComponent(caseId)}`);
    return data as Record<string, unknown>;
  }

  // Brand Name Generation (Non-Streaming)
  async generateBrandNames(request: GenerateNamesRequest) {
    const { data } = await this.client.post('/brands/generate', request, { timeout: 1260000 });
    return data as GeneratedName[];
  }

  // Brand Name Generation (Streaming SSE for Real-Time Stage Synchronization)
  async generateBrandNamesStream(
    request: GenerateNamesRequest,
    onProgress: (event: {
      stage: number;
      step_index: number;
      percent: number;
      status: string;
      title: string;
      subtitle?: string;
      error?: string;
      data?: GeneratedName[];
    }) => void,
    signal?: AbortSignal,
  ): Promise<GeneratedName[]> {
    const response = await fetch(`${BASE_URL}/brands/generate/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      let errDetail = 'Name generation request failed';
      try {
        const errJson = await response.json();
        errDetail = errJson.detail || errDetail;
      } catch {
        errDetail = `Request failed with status ${response.status}`;
      }
      throw new Error(errDetail);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResults: GeneratedName[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          try {
            const payload = JSON.parse(trimmed.slice(5).trim());
            onProgress(payload);
            if (payload.status === 'failed' && payload.error) {
              throw new Error(payload.error);
            }
            if (payload.data) {
              finalResults = payload.data as GeneratedName[];
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected token') {
              throw e;
            }
          }
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      try {
        const payload = JSON.parse(buffer.trim().slice(5).trim());
        onProgress(payload);
        if (payload.data) {
          finalResults = payload.data as GeneratedName[];
        }
      } catch { /* ignore */ }
    }

    return finalResults;
  }

  async getGeneratedNames(limit = 50) {
    const { data } = await this.client.get(`/brands/generated?limit=${limit}`);
    return data as GeneratedName[];
  }

  async getCaseNames(caseId: string) {
    const { data } = await this.client.get(`/brands/case-names?case_id=${encodeURIComponent(caseId)}`);
    return data as {
      names: string[];
      sources: {
        name: string;
        source: 'generator_history' | 'screening_history';
        risk_score?: number;
        risk_level?: string;
        recommendation?: string;
      }[];
    };
  }

  async parseCompareNames(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await axios.post(`${BASE_URL}/brands/parse-names`, fd, {
      withCredentials: true,
      timeout: 60000,
    });
    return data as { names: string[]; count: number };
  }

  // Reference Data
  async getReferenceDataStatus() {
    const { data } = await this.client.get('/reference-data/status');
    return data as {
      who_inn_row_count: number;
      iqvia_row_count: number;
      registered_not_in_use_row_count: number;
      international_market_row_count: number;
    };
  }

  async getDataSources() {
    const { data } = await this.client.get('/reference-data/data-sources');
    return data as { sources: DataSourceStatus[] };
  }

  async setDataSourceEnabled(sourceId: string, enabled: boolean) {
    const { data } = await this.client.put(`/reference-data/data-sources/${sourceId}`, { enabled });
    return data as DataSourceStatus;
  }

  private async _uploadReferenceDataFile(path: string, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await axios.post(`${BASE_URL}${path}`, fd, {
      withCredentials: true,
      timeout: 180000,
    });
    return data as { rows_imported: number; message: string };
  }

  async uploadWhoInnPdf(file: File) {
    return this._uploadReferenceDataFile('/reference-data/who-inn/upload', file);
  }

  async uploadRegisteredNotInUse(file: File) {
    return this._uploadReferenceDataFile('/reference-data/registered-not-in-use/upload', file);
  }

  async uploadInternationalMarket(file: File) {
    return this._uploadReferenceDataFile('/reference-data/international-market/upload', file);
  }

  // Master Data — WHO INN
  async getWhoInnRecords(q?: string) {
    const { data } = await this.client.get('/reference-data/who-inn/records', { params: { q } });
    return data as Array<{
      id: string;
      inn_name: string;
      normalized_name: string;
      who_publication_reference?: string;
      chembl_id?: string;
      molecule_type?: string;
      created_at?: string;
    }>;
  }

  async createWhoInnRecord(payload: { inn_name: string; who_publication_reference?: string; chembl_id?: string; molecule_type?: string }) {
    const { data } = await this.client.post('/reference-data/who-inn/records', payload);
    return data;
  }

  async updateWhoInnRecord(id: string, payload: { inn_name?: string; who_publication_reference?: string; chembl_id?: string; molecule_type?: string }) {
    const { data } = await this.client.put(`/reference-data/who-inn/records/${id}`, payload);
    return data;
  }

  async deleteWhoInnRecord(id: string) {
    const { data } = await this.client.delete(`/reference-data/who-inn/records/${id}`);
    return data;
  }

  async downloadWhoInnTemplate() {
    const response = await this.client.get('/reference-data/who-inn/template', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'WHO_INN_Template.xlsx');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async exportWhoInnMasterData() {
    const response = await this.client.get('/reference-data/who-inn/export', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `WHO_INN_Registry_${new Date().toISOString().slice(0, 10)}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Master Data — International Markets
  async getInternationalMarketRecords(q?: string) {
    const { data } = await this.client.get('/reference-data/international-market/records', { params: { q } });
    return data as Array<{
      id: string;
      brand_name: string;
      normalized_name: string;
      active_ingredient?: string;
      country?: string;
      as_of_date?: string;
      created_at?: string;
    }>;
  }

  async createInternationalMarketRecord(payload: { brand_name: string; active_ingredient?: string; country?: string; as_of_date?: string }) {
    const { data } = await this.client.post('/reference-data/international-market/records', payload);
    return data;
  }

  async updateInternationalMarketRecord(id: string, payload: { brand_name?: string; active_ingredient?: string; country?: string; as_of_date?: string }) {
    const { data } = await this.client.put(`/reference-data/international-market/records/${id}`, payload);
    return data;
  }

  async deleteInternationalMarketRecord(id: string) {
    const { data } = await this.client.delete(`/reference-data/international-market/records/${id}`);
    return data;
  }

  async downloadInternationalMarketTemplate() {
    const response = await this.client.get('/reference-data/international-market/template', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'International_Markets_Template.xlsx');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async exportInternationalMarketMasterData() {
    const response = await this.client.get('/reference-data/international-market/export', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `International_Market_Brands_${new Date().toISOString().slice(0, 10)}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Master Data — Registered but Not in Use
  async getRegisteredNotInUseRecords(q?: string) {
    const { data } = await this.client.get('/reference-data/registered-not-in-use/records', { params: { q } });
    return data as Array<{
      id: string;
      brand_name: string;
      normalized_name: string;
      trademark_class?: number;
      application_number?: string;
      application_date?: string;
      status?: string;
      valid_till?: string;
      remarks?: string;
      as_of_date?: string;
      created_at?: string;
    }>;
  }

  async createRegisteredNotInUseRecord(payload: {
    brand_name: string;
    trademark_class?: number;
    application_number?: string;
    application_date?: string;
    status?: string;
    valid_till?: string;
    remarks?: string;
    as_of_date?: string;
  }) {
    const { data } = await this.client.post('/reference-data/registered-not-in-use/records', payload);
    return data;
  }

  async updateRegisteredNotInUseRecord(id: string, payload: {
    brand_name?: string;
    trademark_class?: number;
    application_number?: string;
    application_date?: string;
    status?: string;
    valid_till?: string;
    remarks?: string;
    as_of_date?: string;
  }) {
    const { data } = await this.client.put(`/reference-data/registered-not-in-use/records/${id}`, payload);
    return data;
  }

  async deleteRegisteredNotInUseRecord(id: string) {
    const { data } = await this.client.delete(`/reference-data/registered-not-in-use/records/${id}`);
    return data;
  }

  async downloadRegisteredNotInUseTemplate() {
    const response = await this.client.get('/reference-data/registered-not-in-use/template', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Registered_Not_In_Use_Template.xlsx');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async exportRegisteredNotInUseMasterData() {
    const response = await this.client.get('/reference-data/registered-not-in-use/export', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Registered_Not_In_Use_${new Date().toISOString().slice(0, 10)}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Audit
  async getAuditLogs(params: {
    page?: number;
    page_size?: number;
    action?: string;
    resource_type?: string;
    user_id?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
  } = {}) {
    const { data } = await this.client.get('/audit/logs', { params });
    return data as AuditLogListResponse;
  }

  async getAuditStats() {
    const { data } = await this.client.get('/audit/stats');
    return data as { total: number; logins: number; exports: number; screenings: number; generations: number };
  }

  async logExport(brandName: string, format = 'pdf', caseId?: string) {
    await this.client.post('/audit/log-export', {
      brand_name: brandName,
      export_format: format,
      case_id: caseId,
    }).catch(() => {});
  }

  // Admin — FDA
  async syncFdaData() {
    const { data } = await this.client.post('/admin/sync/fda');
    return data as { message: string; terms: number };
  }

  // Admin — User Management
  async getAdminUsers() {
    const { data } = await this.client.get('/admin/users');
    return data as User[];
  }

  async createAdminUser(payload: {
    email: string; full_name: string; password: string;
    role: string; department?: string; is_superuser: boolean;
  }) {
    const { data } = await this.client.post('/admin/users', payload);
    return data as User;
  }

  async updateAdminUser(id: string, payload: {
    full_name?: string; role?: string; department?: string;
    is_active?: boolean; is_superuser?: boolean;
  }) {
    const { data } = await this.client.patch(`/admin/users/${id}`, payload);
    return data as User;
  }

  async deactivateAdminUser(id: string) {
    await this.client.delete(`/admin/users/${id}`);
  }

  async deleteAdminUser(id: string) {
    await this.client.delete(`/admin/users/${id}/permanent`);
  }

  // Legal Review
  async submitForLegalReview(request: SubmitReviewRequest) {
    const { data } = await this.client.post('/legal/submit', request);
    return data as LegalReview;
  }

  async getLegalReviews(status?: string, mine?: boolean) {
    const params: Record<string, string | boolean> = {};
    if (status) params.status = status;
    if (mine) params.mine = true;
    const { data } = await this.client.get('/legal/reviews', { params });
    return data as LegalReview[];
  }

  async getSubmittedReviewNames() {
    const { data } = await this.client.get('/legal/reviews/submitted-names');
    return data as string[];
  }

  async approveLegalReview(id: string, comments?: string, legal_ref?: string) {
    const { data } = await this.client.put(`/legal/reviews/${id}/approve`, { comments, legal_ref });
    return data as LegalReview;
  }

  async rejectLegalReview(id: string, comments?: string) {
    const { data } = await this.client.put(`/legal/reviews/${id}/reject`, { comments });
    return data as LegalReview;
  }

  async requestRevision(id: string, comments?: string) {
    const { data } = await this.client.put(`/legal/reviews/${id}/request-revision`, { comments });
    return data as LegalReview;
  }

  async resubmitLegalReview(id: string, comments?: string, rationale?: string) {
    const { data } = await this.client.put(`/legal/reviews/${id}/resubmit`, { comments, rationale });
    return data as LegalReview;
  }

  async retractLegalReview(id: string) {
    await this.client.delete(`/legal/reviews/${id}`);
  }

  async getReviewMessages(reviewId: string) {
    const { data } = await this.client.get(`/legal/reviews/${reviewId}/messages`);
    return data as import('@/types').ReviewMessage[];
  }

  async postReviewMessage(reviewId: string, message: string) {
    const { data } = await this.client.post(`/legal/reviews/${reviewId}/messages`, { message });
    return data as import('@/types').ReviewMessage;
  }

  // Review Batch cart
  async getCartItems() {
    const { data } = await this.client.get('/legal/cart');
    return data as CartItem[];
  }

  async addCartItem(item: Omit<CartItem, 'id'>) {
    const { data } = await this.client.post('/legal/cart', item);
    return data as { item: CartItem; added: boolean };
  }

  async removeCartItem(id: string) {
    await this.client.delete(`/legal/cart/${id}`);
  }

  async clearCart() {
    await this.client.delete('/legal/cart');
  }

  // Legal Review — batches
  async submitLegalBatch(request: SubmitBatchRequest) {
    const { data } = await this.client.post('/legal/batches', request);
    return data as LegalReviewBatch;
  }

  async getLegalBatches(mine?: boolean) {
    const params: Record<string, boolean> = {};
    if (mine) params.mine = true;
    const { data } = await this.client.get('/legal/batches', { params });
    return data as LegalReviewBatch[];
  }

  async getLegalBatch(id: string) {
    const { data } = await this.client.get(`/legal/batches/${id}`);
    return data as LegalReviewBatchDetail;
  }

  // Reports & MIS Data
  async getReportData(reportKey: string) {
    const { data } = await this.client.get(`/reports/${reportKey}`);
    return data as Array<Record<string, any>>;
  }

  // Data Import
  async getImportStats() {
    const { data } = await this.client.get('/admin/import/stats');
    return data as { trademark: number; market: number; epharmacy: number };
  }

  async importData(type: 'trademark' | 'market' | 'epharmacy', file: File, clearExisting = false) {
    const form = new FormData();
    form.append('file', file);
    const { data } = await this.client.post(
      `/admin/import/${type}?clear_existing=${clearExisting}`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data as { type: string; inserted: number; skipped: number; errors: string[]; total_rows: number };
  }

  async downloadImportTemplate(type: 'trademark' | 'market' | 'epharmacy') {
    const response = await this.client.get(`/admin/import/template/${type}`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type === 'trademark' ? 'ip_india_trademark' : type === 'market' ? 'cdsco_market' : 'epharmacy'}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async clearImportData(type: 'trademark' | 'market' | 'epharmacy') {
    const { data } = await this.client.delete(`/admin/import/${type}`);
    return data as { deleted: number; type: string };
  }

  // Notifications
  async getNotifications() {
    const { data } = await this.client.get('/notifications');
    return data as import('@/types').Notification[];
  }

  async getUnreadCount() {
    const { data } = await this.client.get('/notifications/unread-count');
    return data as { count: number };
  }

  async markNotificationRead(id: string) {
    await this.client.put(`/notifications/${id}/read`);
  }

  async markAllNotificationsRead() {
    await this.client.put('/notifications/read-all');
  }

  // Platform Settings
  async getRiskWeights() {
    const { data } = await this.client.get('/settings/risk-weights');
    return data as import('@/types').RiskWeights;
  }

  async updateRiskWeights(payload: import('@/types').RiskWeights) {
    const { data } = await this.client.put('/settings/risk-weights', payload);
    return data as import('@/types').RiskWeights;
  }

}

export const apiClient = new ApiClient();
