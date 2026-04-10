// routes/parcels.js — إدارة الطرود الكاملة
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('../config/firebase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── PRICING CONSTANTS ───────────────────────
const PARCEL_PRICE = 9.0;      // سعر الطرد الثابت
const PLATFORM_CUT = 2.0;      // حصة المنصة
const INSURANCE_CUT = 0.2;     // صندوق التأمين
const HUB_CUT = 0.5;           // حصة كل هوب
const REDIRECT_FEE = 5.0;      // معلوم إعادة التوجيه

// ─── STATUS COLORS (للـ frontend) ─────────────
const STATUS_MAP = {
  created:   { label: 'تم الإنشاء', color: '#94a3b8', emoji: '⚪' },
  pickup:    { label: 'في الاستلام', color: '#6366f1', emoji: '🟣' },
  transit:   { label: 'في الطريق',  color: '#1a56ff', emoji: '🔵' },
  hub:       { label: 'في الهوب',   color: '#f59e0b', emoji: '🟡' },
  delivery:  { label: 'للتسليم',    color: '#f97316', emoji: '🟠' },
  attempt:   { label: 'محاولة فاشلة', color: '#ef4444', emoji: '🔴' },
  delivered: { label: 'تم التسليم', color: '#00b87a', emoji: '🟢' },
  return:    { label: 'مرتجع',      color: '#ff3d6b', emoji: '🔴' },
  archived:  { label: 'مؤرشف',      color: '#475569', emoji: '⚫' },
};

// ─── HELPER: Generate Parcel ID ──────────────
const generateParcelId = () => {
  const num = Math.floor(Math.random() * 90000 + 10000);
  return `WS-${num}`;
};

// ─── HELPER: Calculate Revenue Split ─────────
const calculateSplit = (hubCount = 2) => {
  const hubsTotal = HUB_CUT * hubCount;
  const remaining = PARCEL_PRICE - PLATFORM_CUT - INSURANCE_CUT - hubsTotal;
  return {
    platform: PLATFORM_CUT,
    insurance: INSURANCE_CUT,
    hubs: hubsTotal,
    couriers: remaining > 0 ? remaining : 0,
  };
};

// ─────────────────────────────────────────────
// POST /api/parcels — إنشاء طرد جديد (تاجر)
// ─────────────────────────────────────────────
router.post('/', authMiddleware, requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const {
      recipientName,
      recipientPhone,
      recipientAddress,
      recipientCity,
      codAmount,       // المبلغ عند التسليم
      weight,
      notes,
    } = req.body;

    if (!recipientName || !recipientPhone || !recipientAddress || !recipientCity) {
      return res.status(400).json({ success: false, message: 'بيانات المستلم مطلوبة' });
    }

    const db = getFirestore();
    const parcelId = generateParcelId();
    const now = new Date().toISOString();

    const parcel = {
      id: parcelId,
      merchantId: req.user.id,
      merchantName: req.user.name,

      // بيانات المستلم
      recipientName,
      recipientPhone,
      recipientAddress,
      recipientCity,
      codAmount: parseFloat(codAmount) || 0,
      weight: parseFloat(weight) || 0,
      notes: notes || '',

      // الحالة
      status: 'created',
      statusHistory: [
        { status: 'created', timestamp: now, actor: req.user.id, note: 'تم إنشاء الطرد' }
      ],

      // المالية
      shippingFee: PARCEL_PRICE,
      split: calculateSplit(),
      isRedirected: false,
      redirectFees: 0,
      deliveryAttempts: 0,

      // العهدة
      currentCustodian: null,
      currentCustodianType: null,
      hubs: [],
      livreurId: null,
      transporteurId: null,

      createdAt: now,
      updatedAt: now,
    };

    await db.collection('parcels').doc(parcelId).set(parcel);

    res.status(201).json({
      success: true,
      message: `✅ تم إنشاء الطرد #${parcelId}`,
      parcel: { id: parcelId, status: 'created', ...parcel },
    });
  } catch (err) {
    console.error('Create parcel error:', err);
    res.status(500).json({ success: false, message: 'خطأ في إنشاء الطرد' });
  }
});

// ─────────────────────────────────────────────
// GET /api/parcels — جلب الطرود (حسب الـ role)
// ─────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getFirestore();
    const { status, limit = 50 } = req.query;
    let query = db.collection('parcels');

    // فلترة حسب الـ role
    if (req.user.role === 'merchant') {
      query = query.where('merchantId', '==', req.user.id);
    } else if (req.user.role === 'livreur') {
      query = query.where('livreurId', '==', req.user.id);
    } else if (req.user.role === 'transporteur') {
      query = query.where('transporteurId', '==', req.user.id);
    } else if (req.user.role === 'hub') {
      query = query.where('hubs', 'array-contains', req.user.id);
    }
    // admin يشوف الكل

    if (status) query = query.where('status', '==', status);

    const snap = await query.orderBy('createdAt', 'desc').limit(parseInt(limit)).get();
    const parcels = snap.docs.map(d => ({
      ...d.data(),
      statusInfo: STATUS_MAP[d.data().status] || STATUS_MAP.created,
    }));

    res.json({ success: true, count: parcels.length, parcels });
  } catch (err) {
    console.error('Get parcels error:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب الطرود' });
  }
});

// ─────────────────────────────────────────────
// GET /api/parcels/:id — تتبع طرد بالـ ID
// ─────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection('parcels').doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'الطرد غير موجود' });
    }

    const parcel = doc.data();
    res.json({
      success: true,
      parcel: {
        ...parcel,
        statusInfo: STATUS_MAP[parcel.status] || STATUS_MAP.created,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الطرد' });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/parcels/:id/status — تحديث حالة الطرد
// ─────────────────────────────────────────────
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, note, qrData, signature } = req.body;
    const db = getFirestore();
    const docRef = db.collection('parcels').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'الطرد غير موجود' });
    }

    const parcel = doc.data();
    const now = new Date().toISOString();

    // Validate status transition
    const validTransitions = {
      created:   ['pickup', 'cancelled'],
      pickup:    ['transit', 'hub'],
      transit:   ['hub'],
      hub:       ['transit', 'delivery'],
      delivery:  ['delivered', 'attempt'],
      attempt:   ['delivery', 'return'],
      delivered: [],
      return:    ['hub', 'archived'],
    };

    if (status && !validTransitions[parcel.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن الانتقال من "${parcel.status}" إلى "${status}"`,
      });
    }

    const updateData = {
      status: status || parcel.status,
      updatedAt: now,
      statusHistory: [
        ...parcel.statusHistory,
        {
          status: status || parcel.status,
          timestamp: now,
          actor: req.user.id,
          actorRole: req.user.role,
          note: note || '',
          qrData: qrData || null,
          signature: signature || null,
        },
      ],
    };

    // تحديث محاولات التسليم
    if (status === 'attempt') {
      updateData.deliveryAttempts = (parcel.deliveryAttempts || 0) + 1;
    }

    // تحديث الحارس الحالي
    if (req.user.role === 'livreur') {
      updateData.livreurId = req.user.id;
      updateData.currentCustodian = req.user.id;
      updateData.currentCustodianType = 'livreur';
    } else if (req.user.role === 'transporteur') {
      updateData.transporteurId = req.user.id;
      updateData.currentCustodian = req.user.id;
      updateData.currentCustodianType = 'transporteur';
    } else if (req.user.role === 'hub') {
      updateData.hubs = [...(parcel.hubs || []), req.user.id];
      updateData.currentCustodian = req.user.id;
      updateData.currentCustodianType = 'hub';
    }

    await docRef.update(updateData);

    res.json({
      success: true,
      message: `✅ تم تحديث حالة الطرد إلى: ${STATUS_MAP[status]?.label || status}`,
      parcel: { id: req.params.id, ...updateData },
    });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ success: false, message: 'خطأ في التحديث' });
  }
});

// ─────────────────────────────────────────────
// POST /api/parcels/:id/redirect — إعادة توجيه (تاجر) +5DT
// ─────────────────────────────────────────────
router.post('/:id/redirect', authMiddleware, requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const { newAddress, newCity, newRecipientName, newRecipientPhone } = req.body;
    const db = getFirestore();
    const docRef = db.collection('parcels').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) return res.status(404).json({ success: false, message: 'الطرد غير موجود' });

    const parcel = doc.data();
    if (parcel.merchantId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    }

    const now = new Date().toISOString();
    await docRef.update({
      isRedirected: true,
      redirectFees: (parcel.redirectFees || 0) + REDIRECT_FEE,
      recipientAddress: newAddress || parcel.recipientAddress,
      recipientCity: newCity || parcel.recipientCity,
      recipientName: newRecipientName || parcel.recipientName,
      recipientPhone: newRecipientPhone || parcel.recipientPhone,
      updatedAt: now,
      statusHistory: [
        ...parcel.statusHistory,
        { status: 'redirected', timestamp: now, actor: req.user.id, note: `إعادة توجيه +${REDIRECT_FEE} DT` }
      ],
    });

    res.json({
      success: true,
      message: `✅ تم إعادة التوجيه — سيُضاف ${REDIRECT_FEE} DT معلوم إضافي`,
      redirectFee: REDIRECT_FEE,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إعادة التوجيه' });
  }
});

// ─────────────────────────────────────────────
// GET /api/parcels/admin/all — أدمين يجلب كل الطرود
// ─────────────────────────────────────────────
router.get('/admin/all', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const { status, city, limit = 100, page = 0 } = req.query;
    let query = db.collection('parcels').orderBy('createdAt', 'desc');
    if (status) query = query.where('status', '==', status);

    const snap = await query.limit(parseInt(limit)).get();
    const parcels = snap.docs.map(d => ({
      ...d.data(),
      statusInfo: STATUS_MAP[d.data().status],
    }));

    // Statistics
    const stats = {
      total: parcels.length,
      delivered: parcels.filter(p => p.status === 'delivered').length,
      inTransit: parcels.filter(p => ['transit', 'hub', 'delivery'].includes(p.status)).length,
      returns: parcels.filter(p => p.status === 'return').length,
      revenue: parcels.filter(p => p.status === 'delivered').length * PARCEL_PRICE,
    };

    res.json({ success: true, stats, parcels });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
});

module.exports = router;
