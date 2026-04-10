// server.js — وصّلني Backend الرئيسي
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initFirebase } = require('./config/firebase');

// ─── Routes ─────────────────────────────────
const authRoutes     = require('./routes/auth');
const parcelRoutes   = require('./routes/parcels');
const financeRoutes  = require('./routes/finance');
const adminRoutes    = require('./routes/admin');
const hubRoutes      = require('./routes/hubs');
const locationRoutes = require('./routes/location');

// ─── Init ────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase
initFirebase();

// ─── Middleware ──────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // نوقفها للـ HTML files
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate Limiting — حماية من الـ spam
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 200,
  message: { success: false, message: 'طلبات كثيرة جداً — حاول بعد قليل' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'محاولات دخول كثيرة — انتظر 15 دقيقة' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// ─── Static Files — تقديم ملفات HTML ─────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ──────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/parcels', parcelRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/hubs',    hubRoutes);
app.use('/api/location', locationRoutes);

// ─── Health Check ────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'وصّلني API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    status: 'running',
  });
});

// ─── API Docs Summary ────────────────────────
app.get('/api', (req, res) => {
  res.json({
    service: 'وصّلني — Wassalni API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register':   'تسجيل مستخدم جديد',
        'POST /api/auth/login':      'تسجيل الدخول → JWT token',
        'GET  /api/auth/me':         'بيانات المستخدم الحالي',
        'POST /api/auth/approve/:id': 'تفعيل حساب (أدمين)',
        'POST /api/auth/suspend/:id': 'تعليق حساب (أدمين)',
      },
      parcels: {
        'POST /api/parcels':           'إنشاء طرد جديد (تاجر)',
        'GET  /api/parcels':           'جلب الطرود حسب الـ role',
        'GET  /api/parcels/:id':       'تتبع طرد',
        'PATCH /api/parcels/:id/status': 'تحديث حالة الطرد',
        'POST /api/parcels/:id/redirect': 'إعادة توجيه +5DT',
        'GET  /api/parcels/admin/all': 'كل الطرود (أدمين)',
      },
      finance: {
        'GET  /api/finance/balance':   'الرصيد الحالي',
        'POST /api/finance/withdraw':  'طلب سحب',
        'POST /api/finance/cod':       'تسجيل كاش COD',
        'GET  /api/finance/ceiling/:id': 'بلافون الكاش',
        'PATCH /api/finance/ceiling/:id': 'تعديل البلافون (أدمين)',
        'GET  /api/finance/withdrawals': 'طلبات السحب (أدمين)',
        'POST /api/finance/merchant-settle': 'خلاص التاجر',
      },
      hubs: {
        'POST /api/hubs/pudo-code':    'توليد كود PUDO',
        'POST /api/hubs/verify-pudo':  'التحقق من كود PUDO',
        'POST /api/hubs/confirm-pudo': 'تأكيد التسليم PUDO',
        'PATCH /api/hubs/status':      'فتح/غلق الهوب',
        'PATCH /api/hubs/hours':       'جدول الدوام',
        'GET  /api/hubs/nearby':       'هوبات مفتوحة قريبة',
        'POST /api/hubs/receive':      'استقبال طرد في الهوب',
      },
      admin: {
        'GET  /api/admin/dashboard':   'KPIs الرئيسية',
        'GET  /api/admin/users':       'قائمة المستخدمين',
        'GET  /api/admin/registrations': 'طلبات التسجيل',
        'POST /api/admin/users/:id/approve': 'تفعيل حساب',
        'POST /api/admin/users/:id/suspend': 'تعليق حساب',
        'GET  /api/admin/disputes':    'النزاعات',
        'POST /api/admin/disputes':    'فتح نزاع',
        'PATCH /api/admin/disputes/:id': 'حل نزاع',
        'GET  /api/admin/hubs':        'قائمة الهوبات',
        'GET  /api/admin/reports':     'التقارير المالية',
        'POST /api/admin/notify':      'إرسال إشعار',
        'GET  /api/admin/notifications': 'الإشعارات',
        'POST /api/admin/zones':       'إضافة منطقة',
        'GET  /api/admin/zones':       'قائمة المناطق',
      },
    },
  });
});

// ─── SPA Fallback — كل route غير /api يرجع index.html ─
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ success: false, message: 'Route غير موجود' });
  }
});

// ─── Error Handler ────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' });
});

// ─── Start Server ─────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚚 ======================================
   وصّلني Backend يعمل على المنفذ ${PORT}
   http://localhost:${PORT}
   http://localhost:${PORT}/api — API Docs
======================================`);
});

module.exports = app;
