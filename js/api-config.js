// ============================================================
// Cloudflare Workers API 配置
// 将下方 DEFAULT_API_BASE 替换为您的 Cloudflare Worker 自定义域名
// ============================================================
const DEFAULT_API_BASE = 'https://signin.ogsafetyupc.dpdns.org';

// --- 内部存储 Key ---
const STORAGE_KEYS = {
  API_BASE: 'api_base_url',
  AUTH_TOKEN: 'auth_token',
  AUTH_USER: 'auth_user',
};

// --- 配置管理 ---
export const ConfigManager = {
  getApiBase: () => localStorage.getItem(STORAGE_KEYS.API_BASE) || DEFAULT_API_BASE,
  setApiBase: (url) => {
    // 去掉末尾的斜杠
    localStorage.setItem(STORAGE_KEYS.API_BASE, url.replace(/\/+$/, ''));
  },
  hasConfig: () => {
    const base = localStorage.getItem(STORAGE_KEYS.API_BASE) || DEFAULT_API_BASE;
    return base && !base.includes('你的域名');
  },
};

// --- Auth Token 管理 ---
export const getToken = () => localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
export const setToken = (token) => localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
export const clearToken = () => {
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
};

export const getUser = () => {
  try {
    const u = localStorage.getItem(STORAGE_KEYS.AUTH_USER);
    return u ? JSON.parse(u) : null;
  } catch { return null; }
};
export const setUser = (user) => localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));

// --- 统一 API 请求封装 ---
export async function apiRequest(path, options = {}) {
  const base = ConfigManager.getApiBase();
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${base}${path}`;
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (e) {
    throw new Error('网络请求失败，请检查网络连接');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return data;
}

// --- 带超时的 API 请求 ---
export async function apiRequestWithTimeout(path, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await apiRequest(path, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// API 模块
// ============================================================

// --- 鉴权 API ---
export const AuthAPI = {
  login: (email, password) => apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }),
  register: (email, password) => apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }),
  changePassword: (newPassword) => apiRequest('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  }),
};

// --- 名单 API ---
export const RosterAPI = {
  list: () => apiRequest('/api/rosters'),
  create: (name, students) => apiRequest('/api/rosters', {
    method: 'POST',
    body: JSON.stringify({ name, students }),
  }),
  delete: (id) => apiRequest(`/api/rosters/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// --- 签到场次 API ---
export const SessionAPI = {
  list: () => apiRequest('/api/sessions'),
  create: (name, duration, rosterId) => apiRequest('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name, duration, rosterId }),
  }),
  stop: (id) => apiRequest(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  refreshToken: (id) => apiRequest(`/api/sessions/${encodeURIComponent(id)}/token`, { method: 'POST' }),
  delete: (id) => apiRequest(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getCheckins: (id) => apiRequest(`/api/sessions/${encodeURIComponent(id)}/checkins`),
};

// --- 学生公开 API（无需鉴权） ---
export const PublicAPI = {
  getSession: (teacherId, sessionId, token) =>
    apiRequestWithTimeout(`/api/public/session?u=${encodeURIComponent(teacherId)}&s=${encodeURIComponent(sessionId)}&t=${encodeURIComponent(token)}`, {}, 12000),
  checkExists: (teacherId, sessionId, studentId) =>
    apiRequestWithTimeout(`/api/public/checkin/exists?u=${encodeURIComponent(teacherId)}&s=${encodeURIComponent(sessionId)}&studentId=${encodeURIComponent(studentId)}`),
  checkin: (data) => apiRequestWithTimeout('/api/public/checkin', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};
