// Use relative path for production (Vercel), absolute for development
// Import from centralized config utility
import { getApiBaseUrl } from '../utils/apiConfig';
const API_BASE_URL = getApiBaseUrl();

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // Get auth token from localStorage
  getAuthToken() {
    return localStorage.getItem('lmsToken');
  }

  // Set auth token in localStorage
  setAuthToken(token) {
    localStorage.setItem('lmsToken', token);
  }

  // Remove auth token from localStorage
  removeAuthToken() {
    localStorage.removeItem('lmsToken');
  }

  // Get CSRF token from cookie or localStorage
  getCSRFToken() {
    // Try to get from cookie first (set by server)
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'XSRF-TOKEN') {
        return value;
      }
    }
    // Fallback to localStorage
    return localStorage.getItem('csrfToken');
  }

  // Set CSRF token
  setCSRFToken(token) {
    localStorage.setItem('csrfToken', token);
  }

  // Get headers for API requests
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    const token = this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add CSRF token for state-changing requests
    const csrfToken = this.getCSRFToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    return headers;
  }

  // Retry utility with exponential backoff
  async retryRequest(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Don't retry on authentication errors or validation errors
        if (error.message?.includes('Authentication') ||
          error.message?.includes('Unauthorized') ||
          error.message?.includes('not found') ||
          error.message?.includes('expired') ||
          error.message?.includes('exceeded') ||
          error.message?.includes('permission')) {
          throw error;
        }

        // Don't retry on timeout/abort errors
        if (error.name === 'AbortError' ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          error.message?.toLowerCase().includes('timeout') ||
          error.message?.toLowerCase().includes('aborted') ||
          error.message?.toLowerCase().includes('cancelled')) {
          throw error;
        }

        // Don't retry on 4xx errors (except network issues)
        if (error.message && !error.message.includes('network') && !error.message.includes('fetch')) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  }

  // Make HTTP request with retry logic and timeout
  async request(endpoint, options = {}, retryOptions = {}) {
    const { maxRetries = 3, retryDelay = 1000, timeout = 30000 } = retryOptions;
    const url = `${this.baseURL}${endpoint}`;

    // CRITICAL FIX: Request timeout (30 seconds default)
    const controller = new AbortController();
    let timeoutId = null;

    // Helper to safely clear timeout
    const clearTimeoutSafely = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    // Set up timeout with proper error message
    timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort('Request timeout - server took too long to respond');
      }
    }, timeout);

    return this.retryRequest(async () => {
      // Check if already aborted before making request
      if (controller.signal.aborted) {
        throw new Error('Request was cancelled');
      }

      const config = {
        headers: this.getHeaders(),
        ...options,
        signal: controller.signal, // MEDIUM FIX: Add abort signal for timeout
      };

      try {
        const response = await fetch(url, config);
        clearTimeoutSafely(); // Clear timeout on success

        // Check if request was aborted before parsing response
        if (controller.signal.aborted) {
          throw new DOMException('Request was cancelled', 'AbortError');
        }

        const data = await response.json();

        if (!response.ok) {
          // Handle authentication errors
          if (response.status === 401) {
            this.removeAuthToken();
            localStorage.removeItem('lmsUser');
            window.location.href = '/login';
            throw new Error('Authentication failed');
          }

          // Handle CSRF token errors - fetch new token and retry once
          if (response.status === 403 &&
            (data.message?.includes('CSRF token') || data.message?.includes('csrf'))) {
            // Fetch new CSRF token
            try {
              await this.fetchCSRFToken();
              // Retry the request with new CSRF token
              const retryConfig = {
                ...config,
                headers: this.getHeaders()
              };
              const retryResponse = await fetch(url, retryConfig);
              const retryData = await retryResponse.json();

              if (!retryResponse.ok) {
                throw new Error(retryData.message || 'Request failed');
              }

              return retryData;
            } catch (csrfError) {
              console.error('Failed to refresh CSRF token:', csrfError);
              throw new Error(data.message || 'CSRF token error');
            }
          }

          // Handle email verification requirements - return special response instead of throwing error
          if (response.status === 403 && data.requiresEmailVerification) {
            // Return a special response object instead of throwing an error
            // This prevents it from being logged as an error since it's expected behavior
            return {
              success: false,
              requiresEmailVerification: true,
              message: data.message || 'Email verification required'
            };
          }

          // Handle rate limiting (429) - return special response instead of throwing error
          if (response.status === 429) {
            // Extract retry-after header if available
            const retryAfter = response.headers.get('Retry-After') || response.headers.get('retry-after');
            return {
              success: false,
              rateLimited: true,
              message: data.message || 'Too many requests, please try again later',
              retryAfter: retryAfter ? parseInt(retryAfter) : null
            };
          }

          throw new Error(data.message || 'Request failed');
        }

        return data;
      } catch (error) {
        clearTimeoutSafely(); // Always clear timeout on error

        // Handle abort errors more comprehensively
        // Check for AbortError by name, message, or signal state
        const isAbortError = error.name === 'AbortError' ||
          error instanceof DOMException && error.name === 'AbortError' ||
          error.message?.toLowerCase().includes('aborted') ||
          error.message?.toLowerCase().includes('signal') ||
          error.message?.toLowerCase().includes('cancelled') ||
          controller.signal.aborted;

        if (isAbortError) {
          // Provide user-friendly error message
          throw new Error('Request timeout - the server took too long to respond. Please try again.');
        }

        throw error;
      }
    }, maxRetries, retryDelay);
  }

  // GET request
  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  }

  // POST request
  async post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // PUT request
  async put(endpoint, data) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // DELETE request
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  // PATCH request
  async patch(endpoint, data) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // User Management endpoints (new)
  async getUsers(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/users?${queryString}` : '/users';
    return this.get(endpoint);
  }

  async getUserById(userId) {
    return this.get(`/users/${userId}`);
  }

  async createUser(userData) {
    return this.post('/users', userData);
  }

  async updateUser(userId, userData) {
    return this.put(`/users/${userId}`, userData);
  }

  async deleteUser(userId) {
    return this.delete(`/users/${userId}`);
  }

  async toggleUserStatus(userId) {
    return this.patch(`/users/${userId}/toggle-status`);
  }

  async downloadUserTemplate(type) {
    const url = `${this.baseURL}/users/template/${type}`;
    const headers = this.getHeaders();
    delete headers['Content-Type'];
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Failed to download template');
    return await response.blob();
  }

  async bulkUploadUsers(file) {
    const url = `${this.baseURL}/users/bulk-upload`;
    const headers = this.getHeaders();
    delete headers['Content-Type'];
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Upload failed');
    return data;
  }

  // Auth endpoints
  async login(credentials) {
    const response = await this.post('/auth/login', credentials);
    if (response.success) {
      this.setAuthToken(response.data.token);
      localStorage.setItem('lmsUser', JSON.stringify(response.data.user));
      // Fetch CSRF token after successful login
      await this.fetchCSRFToken();
    }
    return response;
  }

  // Fetch CSRF token from server
  async fetchCSRFToken() {
    try {
      // PERFORMANCE FIX: Use shorter timeout and no retries for faster page load
      const response = await this.request('/csrf-token',
        { method: 'GET' },
        { timeout: 10000, maxRetries: 1 }
      );
      if (response.success && response.csrfToken) {
        this.setCSRFToken(response.csrfToken);
      }
    } catch (error) {
      console.warn('Failed to fetch CSRF token:', error);
      // Don't throw - CSRF token fetch is not critical for login
    }
  }

  async register(userData) {
    const response = await this.post('/auth/register', userData);
    if (response.success) {
      this.setAuthToken(response.data.token);
      localStorage.setItem('lmsUser', JSON.stringify(response.data.user));
      // Fetch CSRF token after successful registration
      await this.fetchCSRFToken();
    }
    return response;
  }

  async logout() {
    try {
      await this.post('/auth/logout');
    } catch (error) {
      // Logout error
    } finally {
      this.removeAuthToken();
      localStorage.removeItem('lmsUser');
    }
  }

  async getProfile() {
    // PERFORMANCE FIX: Use shorter timeout and no retries for faster page load
    return this.request('/auth/profile',
      { method: 'GET' },
      { timeout: 10000, maxRetries: 1 }
    );
  }

  async updateProfile(profileData) {
    return this.put('/auth/profile', profileData);
  }

  async changePassword(passwordData) {
    return this.put('/auth/change-password', passwordData);
  }

  async resendVerificationEmail(email) {
    return this.post('/auth/resend-verification', { email });
  }

  async verifyEmail(token) {
    return this.post('/auth/verify-email', { token });
  }





  // Super Admin endpoints
  async getSuperAdminDashboardStats() {
    return this.get('/super-admin/dashboard/stats');
  }

  async getSuperAdminAnalytics() {
    return this.get('/super-admin/analytics');
  }

  // Analytics endpoints
  async getAnalyticsData(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/data?${queryString}` : '/analytics/data';
    return this.get(endpoint);
  }

  // Course analytics
  async getCourseAnalyticsData(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/course-data?${queryString}` : '/analytics/course-data';
    return this.get(endpoint);
  }

  async getCollegesForAnalytics() {
    return this.get('/analytics/colleges');
  }

  async getDepartmentsForAnalytics(collegeId) {
    const params = { collegeId };
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/departments?${queryString}` : '/analytics/departments';
    return this.get(endpoint);
  }

  async getStudentsForAnalytics(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/students?${queryString}` : '/analytics/students';
    return this.get(endpoint);
  }

  async getStudents(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/users/students?${queryString}` : '/users/students';
    return this.get(endpoint);
  }

  async getFacultyForAnalytics(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/faculty?${queryString}` : '/analytics/faculty';
    return this.get(endpoint);
  }

  async getAssessmentTypes() {
    return this.get('/analytics/assessment-types');
  }

  async getCourseCategories() {
    return this.get('/analytics/course-categories');
  }

  async exportAnalyticsData(params = {}, format = 'excel') {
    return this.post('/analytics/export', { ...params, format });
  }

  // Save view functionality
  async saveAnalyticsView(viewData) {
    return this.post('/analytics/views', viewData);
  }

  async getSavedAnalyticsViews() {
    return this.get('/analytics/views');
  }

  async getSavedAnalyticsView(viewId) {
    return this.get(`/analytics/views/${viewId}`);
  }

  // Chart annotations
  async addChartAnnotation(annotationData) {
    return this.post('/analytics/annotations', annotationData);
  }

  async getChartAnnotations(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/annotations?${queryString}` : '/analytics/annotations';
    return this.get(endpoint);
  }

  async getAssessmentDetails(assessmentId, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/assessment/${assessmentId}?${queryString}` : `/analytics/assessment/${assessmentId}`;
    return this.get(endpoint);
  }

  async getAssessmentSubmissions(assessmentId, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/assessment/${assessmentId}/submissions?${queryString}` : `/analytics/assessment/${assessmentId}/submissions`;
    return this.get(endpoint);
  }

  async getCollegeAssessments(collegeId, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/college/${collegeId}/assessments?${queryString}` : `/analytics/college/${collegeId}/assessments`;
    return this.get(endpoint);
  }

  async getAssessmentCollegeAnalysis(assessmentId, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/analytics/assessment/${assessmentId}/college-analysis?${queryString}` : `/analytics/assessment/${assessmentId}/college-analysis`;
    return this.get(endpoint);
  }

  async getSuperAdminColleges(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/super-admin/colleges?${queryString}` : '/super-admin/colleges';
    return this.get(endpoint);
  }

  async getSuperAdminCollegeLocations() {
    return this.get('/super-admin/colleges/locations');
  }

  async getSuperAdminCollegeById(collegeId) {
    return this.get(`/super-admin/colleges/${collegeId}`);
  }

  async createSuperAdminCollege(collegeData) {
    return this.post('/super-admin/colleges', collegeData);
  }

  async updateSuperAdminCollege(collegeId, collegeData) {
    return this.put(`/super-admin/colleges/${collegeId}`, collegeData);
  }

  async deleteSuperAdminCollege(collegeId, options = {}) {
    const queryString = new URLSearchParams(options).toString();
    const endpoint = queryString ? `/super-admin/colleges/${collegeId}?${queryString}` : `/super-admin/colleges/${collegeId}`;
    return this.delete(endpoint);
  }

  async getSuperAdminCollegeStats(collegeId) {
    return this.get(`/super-admin/colleges/${collegeId}/stats`);
  }

  async getSuperAdminCollegeDetails(collegeId) {
    return this.get(`/super-admin/colleges/${collegeId}/details`);
  }

  // Department endpoints
  async getCollegeDepartments(collegeId) {
    return this.get(`/super-admin/colleges/${collegeId}/departments`);
  }

  async getCollegeBatches(collegeId) {
    return this.get(`/super-admin/colleges/${collegeId}/batches`);
  }

  async getDepartmentsForColleges(collegeIds) {
    return this.post('/super-admin/colleges/departments/batch', { collegeIds });
  }

  async getBatchesForColleges(collegeIds) {
    return this.post('/super-admin/colleges/batches/batch', { collegeIds });
  }

  async getCommonDepartments() {
    return this.get('/super-admin/colleges/departments/common');
  }

  // Batch endpoints
  async getBatches(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/batches?${queryString}` : '/batches';
    return this.get(endpoint);
  }

  async createBatch(batchData) {
    return this.post('/batches', batchData);
  }

  async updateBatch(batchId, batchData) {
    return this.put(`/batches/${batchId}`, batchData);
  }

  async deleteBatch(batchId) {
    return this.delete(`/batches/${batchId}`);
  }

  async getSuperAdminUsers(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/super-admin/users?${queryString}` : '/super-admin/users';
    return this.get(endpoint);
  }

  // Super Admin User CRUD
  async getSuperAdminUserById(userId) {
    return this.get(`/super-admin/users/${userId}`);
  }

  async createSuperAdminUser(userData) {
    return this.post('/super-admin/users', userData);
  }

  async updateSuperAdminUser(userId, userData) {
    return this.put(`/super-admin/users/${userId}`, userData);
  }

  async deleteSuperAdminUser(userId) {
    return this.delete(`/super-admin/users/${userId}`);
  }

  async toggleSuperAdminUserStatus(userId) {
    return this.request(`/super-admin/users/${userId}/toggle-status`, { method: 'PATCH' });
  }

  // Download student Excel template
  async downloadStudentTemplate() {
    const url = `${this.baseURL}/super-admin/users/template/student`;
    const headers = this.getHeaders();
    // Remove content-type for blob download
    delete headers['Content-Type'];
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Failed to download template');
    return await response.blob();
  }

  // Bulk upload students via Excel
  async uploadStudentsExcel(file) {
    const url = `${this.baseURL}/super-admin/users/bulk-upload`;
    const headers = this.getHeaders();
    // Remove content-type for multipart
    delete headers['Content-Type'];
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Upload failed');
    return data;
  }

  // Assessment Management endpoints
  async getAssessmentTemplates(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/assessments/templates?${queryString}` : '/assessments/templates';
    return this.get(endpoint);
  }

  async getAssessmentTemplateById(id) {
    return this.get(`/assessments/templates/${id}`);
  }

  async createAssessmentTemplate(templateData) {
    return this.post('/assessments/templates', templateData);
  }

  async updateAssessmentTemplate(id, templateData) {
    return this.put(`/assessments/templates/${id}`, templateData);
  }

  async deleteAssessmentTemplate(id) {
    return this.delete(`/assessments/templates/${id}`);
  }

  // Assessment Sections
  async createAssessmentSection(assessmentId, sectionData) {
    return this.post(`/assessments/templates/${assessmentId}/sections`, sectionData);
  }

  async updateAssessmentSection(assessmentId, sectionId, sectionData) {
    return this.put(`/assessments/templates/${assessmentId}/sections/${sectionId}`, sectionData);
  }

  async deleteAssessmentSection(assessmentId, sectionId) {
    return this.delete(`/assessments/templates/${assessmentId}/sections/${sectionId}`);
  }

  // Assessment Questions
  async addQuestionToAssessment(assessmentId, questionData) {
    return this.post(`/assessments/templates/${assessmentId}/questions`, questionData);
  }

  async removeQuestionFromAssessment(assessmentId, questionId) {
    return this.delete(`/assessments/templates/${assessmentId}/questions/${questionId}`);
  }

  async reorderAssessmentQuestions(assessmentId, questionOrders) {
    return this.put(`/assessments/templates/${assessmentId}/questions/reorder`, { question_orders: questionOrders });
  }

  // Assessment Assignments
  async createAssessmentAssignment(assessmentId, assignmentData) {
    return this.post(`/assessments/templates/${assessmentId}/assignments`, assignmentData);
  }

  async getAssessmentAssignments(assessmentId) {
    return this.get(`/assessments/templates/${assessmentId}/assignments`);
  }

  async deleteAssessmentAssignment(assessmentId, assignmentId) {
    return this.delete(`/assessments/templates/${assessmentId}/assignments/${assignmentId}`);
  }

  // Email Notifications
  async sendAssessmentNotifications(notificationData) {
    return this.post('/assessments/notifications/send', notificationData);
  }

  async sendAssessmentReminder(assessmentId) {
    return this.post(`/assessments/notifications/reminder/${assessmentId}`);
  }

  async sendAssessmentNotification(assessmentId, studentId, notificationData) {
    return this.post(`/assessments/notifications/send`, {
      assessment_id: assessmentId,
      student_id: studentId,
      ...notificationData
    });
  }

  // Question Selection Helpers
  async getQuestionsForSelection(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/assessments/questions/selection?${queryString}` : '/assessments/questions/selection';
    return this.get(endpoint);
  }

  async calculateAssessmentPoints(assessmentId) {
    return this.get(`/assessments/templates/${assessmentId}/points`);
  }

  async getAssessmentInstances(params = {}) {
    // Add cache-busting parameter to ensure fresh data
    const cacheBuster = Date.now();
    const paramsWithCache = { ...params, _t: cacheBuster };
    const queryString = new URLSearchParams(paramsWithCache).toString();
    const endpoint = queryString ? `/assessments/instances?${queryString}` : '/assessments/instances';
    return this.get(endpoint);
  }

  async createAssessmentInstance(instanceData) {
    return this.post('/assessments/instances', instanceData);
  }

  // Student assessment attempts
  async getAssessmentAttemptInfo(assessmentId) {
    return this.get(`/assessments/${assessmentId}/attempt-info`);
  }

  async getAssessmentAttemptsHistory(assessmentId) {
    return this.get(`/assessments/${assessmentId}/attempts-history`);
  }

  async startAssessmentAttempt(attemptData) {
    return this.post('/assessments/attempts/start', attemptData);
  }

  async submitAssessmentAttempt(attemptData) {
    return this.post('/assessments/attempts/submit', attemptData);
  }

  async getAssessmentAttemptResults(attemptId) {
    return this.get(`/assessments/attempts/${attemptId}/results`);
  }

  // Assessment analytics
  async getAssessmentAnalytics(assessmentId) {
    return this.get(`/assessments/templates/${assessmentId}/analytics`);
  }

  // Question Bank endpoints
  async getQuestionCategories(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/question-bank/categories?${queryString}` : '/question-bank/categories';
    return this.get(endpoint);
  }

  async createQuestionCategory(categoryData) {
    return this.post('/question-bank/categories', categoryData);
  }

  async updateQuestionCategory(id, categoryData) {
    return this.put(`/question-bank/categories/${id}`, categoryData);
  }

  async deleteQuestionCategory(id) {
    return this.delete(`/question-bank/categories/${id}`);
  }

  async getQuestionTags() {
    return this.get('/question-bank/tags');
  }

  async createQuestionTag(tagData) {
    return this.post('/question-bank/tags', tagData);
  }

  async getQuestions(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/question-bank/questions?${queryString}` : '/question-bank/questions';
    return this.get(endpoint);
  }

  async getQuestionById(id) {
    return this.get(`/question-bank/questions/${id}`);
  }

  async createQuestion(questionData) {
    return this.post('/question-bank/questions', questionData);
  }

  async updateQuestion(id, questionData) {
    return this.put(`/question-bank/questions/${id}`, questionData);
  }

  async deleteQuestion(id) {
    return this.delete(`/question-bank/questions/${id}`);
  }

  async downloadQuestionTemplate(type) {
    const url = `${this.baseURL}/question-bank/questions/template/${type}`;
    const headers = this.getHeaders();
    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to download template');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `question_template_${type}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

    return { success: true };
  }

  async previewBulkUploadQuestions(file, questionType) {
    const url = `${this.baseURL}/question-bank/questions/bulk-upload/preview`;
    const headers = this.getHeaders();
    delete headers['Content-Type'];

    const formData = new FormData();
    formData.append('file', file);
    formData.append('question_type', questionType);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to preview bulk upload');
    return data;
  }

  async bulkUploadQuestions(file, questionType) {
    const url = `${this.baseURL}/question-bank/questions/bulk-upload`;
    const headers = this.getHeaders();
    delete headers['Content-Type'];

    const formData = new FormData();
    formData.append('file', file);
    formData.append('question_type', questionType);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Bulk upload failed');
    return data;
  }

  async uploadQuestionAttachment(questionId, file) {
    const url = `${this.baseURL}/question-bank/questions/${questionId}/attachments`;
    const headers = this.getHeaders();
    delete headers['Content-Type'];
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Upload failed');
    return data;
  }

  async deleteQuestionAttachment(attachmentId) {
    return this.delete(`/question-bank/attachments/${attachmentId}`);
  }

  async getQuestionAnalytics(questionId) {
    return this.get(`/question-bank/questions/${questionId}/analytics`);
  }

  // Coding endpoints
  async executeCode(codeData) {
    return this.post('/coding/execute', codeData);
  }

  async runTestCases(testData) {
    return this.post('/coding/test-cases', testData);
  }

  async submitCode(codeData) {
    return this.post('/coding/submit', codeData);
  }

  async getSupportedLanguages() {
    return this.get('/coding/languages');
  }

  async getLanguageTemplates() {
    return this.get('/coding/templates');
  }

  async verifyCodingQuestion(verificationData) {
    return this.post('/coding/verify', verificationData);
  }

  async getCodingHealthCheck() {
    return this.get('/coding/health');
  }

  async getSubmissionStatus(submissionId) {
    return this.get(`/coding/submission/${submissionId}`);
  }

  // Student Assessment Methods
  async getAssessmentQuestionsForAdmin(assessmentId) {
    return this.get(`/assessments/${assessmentId}/questions/admin`);
  }

  async addQuestionToAssessment(assessmentId, questionId, sectionId, questionOrder, points, timeLimitSeconds, isRequired) {
    return this.post(`/assessments/templates/${assessmentId}/questions`, {
      question_id: questionId,
      section_id: sectionId,
      question_order: questionOrder,
      points: points,
      time_limit_seconds: timeLimitSeconds,
      is_required: isRequired
    });
  }

  async assignAssessmentToStudents(assessmentId, studentIds) {
    return this.post(`/assessments/${assessmentId}/assign`, { student_ids: studentIds });
  }

  async sendAssessmentReminders(reminderData) {
    return this.post('/assessments/reminders', reminderData);
  }

  async getAssessmentSubmission(assessmentId, studentId) {
    return this.get(`/assessments/${assessmentId}/submissions/${studentId}`);
  }

  async saveAssessmentProgress(assessmentId, progressData) {
    return this.post(`/assessments/${assessmentId}/save-progress`, progressData);
  }

  async submitAssessment(assessmentId, submissionData) {
    return this.post(`/assessments/${assessmentId}/submit`, submissionData);
  }

  async getAssessmentResults(assessmentId, studentId) {
    return this.get(`/assessments/${assessmentId}/results/${studentId}`);
  }

  async getStudentAssessments(studentId, params = {}) {
    const queryParams = new URLSearchParams(params).toString();
    return this.get(`/student/${studentId}/assessments?${queryParams}`);
  }

  // Debug endpoint to check assessment data
  async debugAssessmentData(assessmentId) {
    return this.get(`/assessments/debug/${assessmentId}`);
  }

  // Debug endpoint to manually update assignment dates
  async debugUpdateAssignmentDates(assessmentId, dates) {
    return this.post(`/assessments/debug/${assessmentId}/update-dates`, dates);
  }


  // College and Department methods
  async getColleges() {
    return this.get('/colleges');
  }

  async getDepartments() {
    // Get common departments from colleges endpoint
    return this.get('/colleges/departments/common');
  }

  async getDepartmentsByCollege(collegeId) {
    return this.get(`/colleges/${collegeId}/departments`);
  }

  // Coding Profiles endpoints
  async getCodingPlatforms() {
    // Increased timeout for coding profiles as scraping can take longer
    return this.request('/coding-profiles/platforms',
      { method: 'GET' },
      { timeout: 60000, maxRetries: 2 } // 60 seconds timeout, fewer retries
    );
  }

  async getAllStudentsCodingProfiles(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    // Increased timeout for coding profiles as scraping can take longer
    return this.request(`/coding-profiles/students${queryString ? `?${queryString}` : ''}`,
      { method: 'GET' },
      { timeout: 60000, maxRetries: 2 } // 60 seconds timeout, fewer retries
    );
  }

  async getStudentCodingProfiles() {
    return this.get('/coding-profiles/my-profiles');
  }

  async addCodingProfile(studentId, profileData) {
    return this.post('/coding-profiles/profiles', { student_id: studentId, ...profileData });
  }

  async updateCodingProfile(profileId, profileData) {
    return this.put(`/coding-profiles/profiles/${profileId}`, profileData);
  }

  async updateStudentCodingProfile(studentId, profileId, profileData) {
    return this.put(`/coding-profiles/student/${studentId}/profiles/${profileId}`, profileData);
  }

  async syncCodingProfile(profileId) {
    return this.post(`/coding-profiles/profiles/${profileId}/sync`);
  }

  async syncAllProfiles() {
    return this.post('/coding-profiles/sync-all');
  }

  async deleteCodingProfile(profileId) {
    return this.delete(`/coding-profiles/profiles/${profileId}`);
  }

  async deleteAllStudentProfiles(studentId) {
    return this.delete(`/coding-profiles/student/${studentId}`);
  }

  async fetchPlatformStatistics(studentId) {
    return this.get(`/coding-profiles/student/${studentId}/statistics`);
  }

  async getStudentPlatformStatistics() {
    return this.get('/coding-profiles/my-statistics');
  }

  async getStudentCachedPlatformStatistics() {
    return this.get('/coding-profiles/my-statistics/cached');
  }

  async getCachedPlatformStatistics(studentId) {
    return this.get(`/coding-profiles/student/${studentId}/statistics/cached`);
  }

  async fetchBatchPlatformStatistics(studentIds, forceRefresh = false) {
    // Increased timeout for batch statistics as scraping multiple students can take longer
    return this.request('/coding-profiles/students/batch-statistics',
      {
        method: 'POST',
        body: JSON.stringify({ studentIds, forceRefresh })
      },
      { timeout: 180000, maxRetries: 2 } // 3 minutes timeout, fewer retries
    );
  }

  async getCachedBatchPlatformStatistics(batchId) {
    return this.get(`/coding-profiles/students/batch-statistics/${batchId}/cached`);
  }

  async getCodingProfileAnalytics() {
    return this.get('/coding-profiles/analytics');
  }

  // Bulk Upload endpoints
  async downloadBulkUploadTemplate() {
    const url = `${this.baseURL}/bulk-upload/template`;
    const headers = this.getHeaders();
    // Remove content-type for blob download
    delete headers['Content-Type'];
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Failed to download template');
    return await response.blob();
  }

  async bulkUploadProfiles(file) {
    const url = `${this.baseURL}/bulk-upload/upload`;
    const headers = this.getHeaders();
    // Remove content-type for multipart
    delete headers['Content-Type'];
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Upload failed');
    return data;
  }

  async getBulkUploadStats() {
    return this.get('/bulk-upload/stats');
  }

  async syncBulkProfiles() {
    return this.post('/bulk-upload/sync', { autoSync: true });
  }

  // Notifications
  async getNotifications(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/notifications?${queryString}` : '/notifications';
    return this.get(endpoint);
  }

  async markNotificationAsRead(notificationId) {
    return this.patch(`/notifications/${notificationId}/read`);
  }

  async markAllNotificationsAsRead() {
    return this.patch('/notifications/read-all');
  }


  // Assessment Retake
  async retakeAssessment(assessmentId) {
    return this.post(`/student-assessments/${assessmentId}/retake`);
  }

  // Assessment Taking Methods
  async startAssessment(assessmentId, deviceInfo = {}) {
    return this.post(`/student-assessments/${assessmentId}/start`, deviceInfo);
  }

  async getStudentAssessment(assessmentId) {
    return this.get(`/student-assessments/${assessmentId}`);
  }

  async getAssessmentQuestions(assessmentId) {
    return this.get(`/student-assessments/${assessmentId}/questions`);
  }

  async saveAnswer(submissionId, answerData) {
    return this.post(`/student-assessments/${submissionId}/answers`, answerData);
  }

  async submitAssessment(submissionId, submissionData = {}) {
    return this.post(`/student-assessments/${submissionId}/submit`, submissionData);
  }

  async getAssessmentResults(submissionId) {
    return this.get(`/student-assessments/${submissionId}/results`);
  }

  async runCodingTests(testData) {
    return this.post('/coding/test-cases', testData);
  }

  async logProctoringViolation(submissionId, violationData) {
    return this.post('/proctoring/violations', {
      submissionId,
      ...violationData
    });
  }

  async verifyAssessmentAccess(assessmentId, accessData) {
    return this.post('/student-assessments/verify-access', {
      assessmentId,
      ...accessData
    });
  }

  async validateAssessmentAttempt(assessmentId) {
    return this.post('/student-assessments/validate-attempt', { assessmentId });
  }

  // Gemini AI assistant
  async getAiConnectors() {
    return this.get('/ai/connectors');
  }

  async fetchAiContext(connectorKey, params = {}) {
    return this.post('/ai/context', { connectorKey, params });
  }

  async sendAiMessage(payload) {
    return this.post('/ai/chat', payload);
  }
}

export default new ApiService(); 