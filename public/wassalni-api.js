// wassalni-api.js — الجسر بين كل صفحات HTML والـ Backend
// يُضاف كـ <script src="wassalni-api.js"> في كل صفحة

const API_BASE = window.location.origin + '/api';

// ─── Token Management ────────────────────────
const Auth = {
  getToken: () => localStorage.getItem('ws_token'),
  setToken: (t) => localStorage.setItem('ws_token', t),
  getUser:  () => { try { return JSON.parse(localStorage.getItem('ws_user')); } catch { return null; } },
  setUser:  (u) => localStorage.setItem('ws_user', JSON.stringify(u)),
  clear:    () => { localStorage.removeItem('ws_token'); localStorage.removeItem('ws_user'); },
  isLoggedIn: () => !!localStorage.getItem('ws_token'),
};

// ─── HTTP Helper ─────────────────────────────
async function apiCall(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(API_BASE + path, opts);
    const data = await res.json();
    if (res.status === 401) {
      Auth.clear();
      window.location.href = '/Index.html';
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('API Error:', err);
    return { ok: false, status: 0, data: { success: false, message: 'لا يوجد اتصال بالخادم' } };
  }
}

const API = {
  get:    (path)        => apiCall('GET',    path),
  post:   (path, body)  => apiCall('POST',   path, body),
  patch:  (path, body)  => apiCall('PATCH',  path, body),
  delete: (path)        => apiCall('DELETE', path),
};

// ─────────────────────────────────────────────
// AUTH FUNCTIONS
// ─────────────────────────────────────────────
const WsAuth = {

  // تسجيل الدخول من Index.html
  async login(phone, password) {
    const r = await API.post('/auth/login', { phone, password });
    if (r.ok && r.data.success) {
      if (r.data.status === 'pending') return { status: 'pending' };
      Auth.setToken(r.data.token);
      Auth.setUser(r.data.user);
      return { status: 'ok', redirect: r.data.redirect, user: r.data.user };
    }
    return { status: 'error', message: r.data.message };
  },

  // تسجيل حساب جديد
  async register(name, phone, password, role) {
    const r = await API.post('/auth/register', { name, phone, password, role });
    return r.data;
  },

  // تسجيل الخروج
  logout() {
    Auth.clear();
    window.location.href = '/Index.html';
  },

  // الحصول على بيانات المستخدم الحالي من الـ API
  async getMe() {
    const r = await API.get('/auth/me');
    if (r.ok) Auth.setUser(r.data.user);
    return r.data.user;
  },

  // التحقق أن المستخدم مسجل ومن الـ role الصحيح
  guard(expectedRole) {
    if (!Auth.isLoggedIn()) {
      window.location.href = '/Index.html';
      return false;
    }
    const user = Auth.getUser();
    if (expectedRole && user?.role !== expectedRole && user?.role !== 'admin') {
      window.location.href = '/Index.html';
      return false;
    }
    return user;
  },
};

// ─────────────────────────────────────────────
// PARCELS FUNCTIONS
// ─────────────────────────────────────────────
const WsParcels = {

  async create(data) {
    const r = await API.post('/parcels', data);
    return r.data;
  },

  async list(status = null) {
    const q = status ? `?status=${status}` : '';
    const r = await API.get(`/parcels${q}`);
    return r.data;
  },

  async get(id) {
    const r = await API.get(`/parcels/${id}`);
    return r.data;
  },

  async updateStatus(id, status, note = '', extras = {}) {
    const r = await API.patch(`/parcels/${id}/status`, { status, note, ...extras });
    return r.data;
  },

  async redirect(id, newData) {
    const r = await API.post(`/parcels/${id}/redirect`, newData);
    return r.data;
  },

  // للأدمين
  async adminList(status = null) {
    const q = status ? `?status=${status}` : '';
    const r = await API.get(`/parcels/admin/all${q}`);
    return r.data;
  },
};

// ─────────────────────────────────────────────
// FINANCE FUNCTIONS
// ─────────────────────────────────────────────
const WsFinance = {

  async getBalance() {
    const r = await API.get('/finance/balance');
    return r.data;
  },

  async requestWithdraw(amount, method) {
    const r = await API.post('/finance/withdraw', { amount, method });
    return r.data;
  },

  async recordCOD(parcelId, amount, type) {
    const r = await API.post('/finance/cod', { parcelId, amount, type });
    return r.data;
  },

  async getCeiling(userId = 'me') {
    const r = await API.get(`/finance/ceiling/${userId}`);
    return r.data;
  },

  async setCeiling(userId, newCeiling) {
    const r = await API.patch(`/finance/ceiling/${userId}`, { newCeiling });
    return r.data;
  },

  async getWithdrawals() {
    const r = await API.get('/finance/withdrawals');
    return r.data;
  },

  async settleMerchant(merchantId, amount, code) {
    const r = await API.post('/finance/merchant-settle', { merchantId, amount, code });
    return r.data;
  },

  async generateSettlementCode(merchantId) {
    const r = await API.post('/finance/generate-settlement-code', { merchantId });
    return r.data;
  },
};

// ─────────────────────────────────────────────
// HUB FUNCTIONS
// ─────────────────────────────────────────────
const WsHub = {

  async generatePudoCode(parcelId) {
    const r = await API.post('/hubs/pudo-code', { parcelId });
    return r.data;
  },

  async verifyPudoCode(code) {
    const r = await API.post('/hubs/verify-pudo', { code });
    return r.data;
  },

  async confirmPudo(code, signature) {
    const r = await API.post('/hubs/confirm-pudo', { code, signature });
    return r.data;
  },

  async setStatus(isOpen) {
    const r = await API.patch('/hubs/status', { isOpen });
    return r.data;
  },

  async saveHours(hours) {
    const r = await API.patch('/hubs/hours', { hours });
    return r.data;
  },

  async getNearby() {
    const r = await API.get('/hubs/nearby');
    return r.data;
  },

  async receiveParcel(parcelId, qrData) {
    const r = await API.post('/hubs/receive', { parcelId, qrData });
    return r.data;
  },
};

// ─────────────────────────────────────────────
// ADMIN FUNCTIONS
// ─────────────────────────────────────────────
const WsAdmin = {

  async getDashboard() {
    const r = await API.get('/admin/dashboard');
    return r.data;
  },

  async getUsers(role = null, status = null, search = null) {
    const params = new URLSearchParams();
    if (role)   params.set('role', role);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const r = await API.get(`/admin/users?${params}`);
    return r.data;
  },

  async getRegistrations() {
    const r = await API.get('/admin/registrations');
    return r.data;
  },

  async approveUser(userId) {
    const r = await API.post(`/admin/users/${userId}/approve`);
    return r.data;
  },

  async suspendUser(userId) {
    const r = await API.post(`/admin/users/${userId}/suspend`);
    return r.data;
  },

  async getDisputes(status = 'open') {
    const r = await API.get(`/admin/disputes?status=${status}`);
    return r.data;
  },

  async resolveDispute(id, resolution) {
    const r = await API.patch(`/admin/disputes/${id}`, { resolution, status: 'resolved' });
    return r.data;
  },

  async getHubs() {
    const r = await API.get('/admin/hubs');
    return r.data;
  },

  async getReports(period = '7d') {
    const r = await API.get(`/admin/reports?period=${period}`);
    return r.data;
  },

  async sendNotification(userId, title, message, type = 'info') {
    const r = await API.post('/admin/notify', { userId, title, message, type });
    return r.data;
  },

  async getNotifications() {
    const r = await API.get('/admin/notifications');
    return r.data;
  },

  async getZones() {
    const r = await API.get('/admin/zones');
    return r.data;
  },
};

// ─────────────────────────────────────────────
// UI HELPERS — مشتركة بين كل الصفحات
// ─────────────────────────────────────────────
const WsUI = {

  showToast(msg, type = 'info') {
    const el = document.getElementById('toast') || (() => {
      const t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        padding:12px 24px; border-radius:50px; font-family:'Tajawal',sans-serif;
        font-size:14px; font-weight:700; z-index:9999; opacity:0;
        transition:opacity 0.3s; white-space:nowrap; max-width:90vw;
        background:${type==='success'?'#00b87a':type==='error'?'#ff3d6b':'#1a56ff'};
        color:white; box-shadow:0 4px 20px rgba(0,0,0,0.2);
      `;
      document.body.appendChild(t);
      return t;
    })();

    el.textContent = msg;
    el.style.background = type==='success'?'#00b87a':type==='error'?'#ff3d6b':'#1a56ff';
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.opacity = '0', 3000);
  },

  showLoading(show = true) {
    let el = document.getElementById('ws-loading');
    if (!el && show) {
      el = document.createElement('div');
      el.id = 'ws-loading';
      el.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.4);
        display:flex; align-items:center; justify-content:center; z-index:9998;
      `;
      el.innerHTML = '<div style="background:white;border-radius:16px;padding:24px 32px;font-family:Tajawal,sans-serif;font-size:16px;font-weight:700">⏳ جاري التحميل...</div>';
      document.body.appendChild(el);
    }
    if (el) el.style.display = show ? 'flex' : 'none';
  },

  formatDT: (n) => parseFloat(n || 0).toFixed(3) + ' DT',
  
  formatDate: (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ar-TN', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  },

  statusBadge(status) {
    const map = {
      created:   ['⚪', '#94a3b8', 'تم الإنشاء'],
      pickup:    ['🟣', '#6366f1', 'في الاستلام'],
      transit:   ['🔵', '#1a56ff', 'في الطريق'],
      hub:       ['🟡', '#f59e0b', 'في الهوب'],
      delivery:  ['🟠', '#f97316', 'للتسليم'],
      attempt:   ['🔴', '#ef4444', 'محاولة فاشلة'],
      delivered: ['🟢', '#00b87a', 'تم التسليم'],
      return:    ['↩️', '#ff3d6b', 'مرتجع'],
      archived:  ['⚫', '#475569', 'مؤرشف'],
      active:    ['🟢', '#00b87a', 'نشط'],
      pending:   ['🟡', '#f59e0b', 'قيد المراجعة'],
      suspended: ['🔴', '#ff3d6b', 'موقوف'],
    };
    const [emoji, color, label] = map[status] || ['⚪', '#94a3b8', status];
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:${color}22;color:${color};font-size:12px;font-weight:700">${emoji} ${label}</span>`;
  },
};

// ─────────────────────────────────────────────
// AUTO-INIT — تشغيل تلقائي عند تحميل الصفحة
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // تحديد الصفحة الحالية وتطبيق الـ guard المناسب
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const roleGuards = {
    'merchant-app.html':    'merchant',
    'livreur-app.html':     'livreur',
    'transporteur-app.html':'transporteur',
    'hub-app.html':         'hub',
    'admin-dashboard.html': 'admin',
  };

  if (roleGuards[page]) {
    const user = WsAuth.guard(roleGuards[page]);
    if (user) {
      // حقن اسم المستخدم في أي عنصر بـ class="ws-user-name"
      document.querySelectorAll('.ws-user-name').forEach(el => el.textContent = user.name);
      document.querySelectorAll('.ws-user-phone').forEach(el => el.textContent = user.phone);
      document.querySelectorAll('.ws-user-role').forEach(el => el.textContent = user.role);
    }
  }
});

// ─── Export للـ modules ────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { Auth, WsAuth, WsParcels, WsFinance, WsHub, WsAdmin, WsUI };
}
