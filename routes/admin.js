// routes/admin.js — لوحة الأدمين الكاملة
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('../config/firebase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────
// GET /api/admin/dashboard — KPIs الرئيسية
// ─────────────────────────────────────────────
router.get('/dashboard', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();

    // جلب كل البيانات بالتوازي
    const [usersSnap, parcelsSnap, requestsSnap, disputesSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('parcels').orderBy('createdAt', 'desc').limit(200).get(),
      db.collection('registration_requests').where('status', '==', 'pending').get(),
      db.collection('disputes').where('status', '==', 'open').get(),
    ]);

    const users = usersSnap.docs.map(d => d.data());
    const parcels = parcelsSnap.docs.map(d => d.data());

    // حساب الإحصائيات
    const stats = {
      users: {
        total: users.length,
        active: users.filter(u => u.status === 'active').length,
        pending: users.filter(u => u.status === 'pending').length,
        byRole: {
          merchants: users.filter(u => u.role === 'merchant').length,
          livreurs: users.filter(u => u.role === 'livreur').length,
          transporteurs: users.filter(u => u.role === 'transporteur').length,
          hubs: users.filter(u => u.role === 'hub').length,
        },
      },
      parcels: {
        total: parcels.length,
        delivered: parcels.filter(p => p.status === 'delivered').length,
        inTransit: parcels.filter(p => ['transit', 'hub', 'delivery', 'pickup'].includes(p.status)).length,
        returns: parcels.filter(p => p.status === 'return').length,
        attempts: parcels.filter(p => p.status === 'attempt').length,
        deliveryRate: parcels.length > 0
          ? Math.round((parcels.filter(p => p.status === 'delivered').length / parcels.length) * 100)
          : 0,
      },
      finance: {
        revenue: parcels.filter(p => p.status === 'delivered').length * 9,
        platformCut: parcels.filter(p => p.status === 'delivered').length * 2,
        insurance: parcels.filter(p => p.status === 'delivered').length * 0.2,
        pendingWithdrawals: 0,
      },
      alerts: {
        pendingRegistrations: requestsSnap.size,
        openDisputes: disputesSnap.size,
      },
    };

    // أحدث 10 طرود
    const recentParcels = parcels.slice(0, 10).map(p => ({
      id: p.id,
      merchantName: p.merchantName,
      recipientCity: p.recipientCity,
      status: p.status,
      codAmount: p.codAmount,
      createdAt: p.createdAt,
    }));

    res.json({ success: true, stats, recentParcels });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/users — قائمة المستخدمين
// ─────────────────────────────────────────────
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const { role, status, search } = req.query;
    let query = db.collection('users');

    if (role) query = query.where('role', '==', role);
    if (status) query = query.where('status', '==', status);

    const snap = await query.orderBy('createdAt', 'desc').limit(200).get();
    let users = snap.docs.map(d => {
      const u = d.data();
      delete u.password;
      return u;
    });

    // بحث نصي
    if (search) {
      const s = search.toLowerCase();
      users = users.filter(u =>
        u.name?.toLowerCase().includes(s) ||
        u.phone?.includes(s)
      );
    }

    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/registrations — طلبات التسجيل المعلقة
// ─────────────────────────────────────────────
router.get('/registrations', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('registration_requests')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();
    const requests = snap.docs.map(d => d.data());
    res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الطلبات' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/users/:id/approve — تفعيل حساب
// ─────────────────────────────────────────────
router.post('/users/:id/approve', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const now = new Date().toISOString();
    await db.collection('users').doc(req.params.id).update({ status: 'active', updatedAt: now });
    await db.collection('registration_requests').doc(req.params.id).update({ status: 'approved', updatedAt: now }).catch(() => {});
    res.json({ success: true, message: '✅ تم تفعيل الحساب' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التفعيل' });
  }
});

// POST /api/admin/users/:id/suspend — تعليق
router.post('/users/:id/suspend', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    await db.collection('users').doc(req.params.id).update({
      status: 'suspended', updatedAt: new Date().toISOString()
    });
    res.json({ success: true, message: 'تم تعليق الحساب' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التعليق' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/disputes — النزاعات
// ─────────────────────────────────────────────
router.get('/disputes', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const { status = 'open' } = req.query;
    const snap = await db.collection('disputes')
      .where('status', '==', status)
      .orderBy('createdAt', 'desc').limit(100).get();
    res.json({ success: true, disputes: snap.docs.map(d => d.data()) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب النزاعات' });
  }
});

// POST /api/admin/disputes — فتح نزاع جديد
router.post('/disputes', authMiddleware, async (req, res) => {
  try {
    const { parcelId, description, type } = req.body;
    const db = getFirestore();
    const id = uuidv4();
    await db.collection('disputes').doc(id).set({
      id, parcelId, description, type,
      openedBy: req.user.id,
      openedByRole: req.user.role,
      status: 'open',
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ success: true, message: 'تم فتح النزاع', id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في فتح النزاع' });
  }
});

// PATCH /api/admin/disputes/:id — حل نزاع
router.patch('/disputes/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { resolution, status } = req.body;
    const db = getFirestore();
    await db.collection('disputes').doc(req.params.id).update({
      status: status || 'resolved',
      resolution,
      resolvedBy: req.user.id,
      resolvedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: '✅ تم حل النزاع' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حل النزاع' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/hubs — قائمة الهوبات
// ─────────────────────────────────────────────
router.get('/hubs', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('users').where('role', '==', 'hub').get();
    const hubs = snap.docs.map(d => {
      const h = d.data();
      delete h.password;
      return h;
    });
    res.json({ success: true, hubs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الهوبات' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/reports — التقارير المالية
// ─────────────────────────────────────────────
router.get('/reports', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const { period = '7d' } = req.query;

    const daysBack = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const snap = await db.collection('parcels')
      .where('createdAt', '>=', since)
      .get();

    const parcels = snap.docs.map(d => d.data());
    const delivered = parcels.filter(p => p.status === 'delivered');

    const report = {
      period,
      totalParcels: parcels.length,
      delivered: delivered.length,
      deliveryRate: parcels.length > 0 ? Math.round((delivered.length / parcels.length) * 100) : 0,
      revenue: delivered.length * 9,
      platformRevenue: delivered.length * 2,
      insuranceFund: delivered.length * 0.2,
      averagePerDay: Math.round(parcels.length / daysBack),
      byCity: parcels.reduce((acc, p) => {
        acc[p.recipientCity] = (acc[p.recipientCity] || 0) + 1;
        return acc;
      }, {}),
      byStatus: parcels.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التقارير' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/notify — إرسال إشعار لمستخدم
// ─────────────────────────────────────────────
router.post('/notify', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId, title, message, type = 'info' } = req.body;
    const db = getFirestore();
    const id = uuidv4();

    await db.collection('notifications').doc(id).set({
      id,
      userId: userId || 'all',
      title,
      message,
      type, // info | warning | success | error
      read: false,
      createdAt: new Date().toISOString(),
      sentBy: req.user.id,
    });

    res.json({ success: true, message: '✅ تم إرسال الإشعار', id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الإشعار' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/notifications — إشعارات المستخدم
// ─────────────────────────────────────────────
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('notifications')
      .where('userId', 'in', [req.user.id, 'all'])
      .orderBy('createdAt', 'desc')
      .limit(20).get();
    res.json({ success: true, notifications: snap.docs.map(d => d.data()) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإشعارات' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/zones — إضافة/تعديل منطقة تسليم
// ─────────────────────────────────────────────
router.post('/zones', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, governorate, baseFee, active } = req.body;
    const db = getFirestore();
    const id = uuidv4();
    await db.collection('zones').doc(id).set({
      id, name, governorate,
      baseFee: parseFloat(baseFee) || 9,
      active: active !== false,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ success: true, message: 'تمت إضافة المنطقة', id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة المنطقة' });
  }
});

router.get('/zones', authMiddleware, async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('zones').where('active', '==', true).get();
    res.json({ success: true, zones: snap.docs.map(d => d.data()) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المناطق' });
  }
});

module.exports = router;
