// routes/hubs.js — إدارة الهوبات: PUDO codes، استقبال/تسليم طرود، جدول الدوام
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { authMiddleware, requireRole, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────
// POST /api/hubs/pudo-code — توليد كود PUDO للزبون (24h)
// ─────────────────────────────────────────────
router.post('/pudo-code', authMiddleware, requireRole('hub', 'admin'), async (req, res) => {
  try {
    const { parcelId } = req.body;
    if (!parcelId) return res.status(400).json({ success: false, message: 'parcelId مطلوب' });

    const db = getFirestore();

    // تحقق إن الطرد موجود في الهوب
    const parcelDoc = await db.collection('parcels').doc(parcelId).get();
    if (!parcelDoc.exists) return res.status(404).json({ success: false, message: 'الطرد غير موجود' });

    const parcel = parcelDoc.data();
    if (parcel.currentCustodian !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'هذا الطرد ليس في هوبك' });
    }

    // كود عشوائي 6 أرقام — يستعمل مرة واحدة فقط — صالح 24 ساعة
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.collection('pudo_codes').doc(code).set({
      code,
      parcelId,
      hubId: req.user.id,
      used: false,
      expiresAt,
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      code,
      expiresAt,
      message: `كود PUDO: ${code} — صالح لمدة 24 ساعة`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في توليد الكود' });
  }
});

// ─────────────────────────────────────────────
// POST /api/hubs/verify-pudo — التحقق من كود PUDO عند التسليم
// ─────────────────────────────────────────────
router.post('/verify-pudo', authMiddleware, requireRole('hub'), async (req, res) => {
  try {
    const { code, signature } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'الكود مطلوب' });

    const db = getFirestore();
    const codeDoc = await db.collection('pudo_codes').doc(code).get();

    if (!codeDoc.exists) {
      return res.status(404).json({ success: false, message: '❌ الكود غير صحيح' });
    }

    const pudoData = codeDoc.data();

    if (pudoData.used) {
      return res.status(400).json({ success: false, message: '❌ هذا الكود استُعمل مسبقاً' });
    }

    if (new Date(pudoData.expiresAt) < new Date()) {
      return res.status(400).json({ success: false, message: '❌ انتهت صلاحية الكود' });
    }

    if (pudoData.hubId !== req.user.id) {
      return res.status(403).json({ success: false, message: '❌ هذا الكود ليس لهوبك' });
    }

    // جلب بيانات الطرد
    const parcelDoc = await db.collection('parcels').doc(pudoData.parcelId).get();
    const parcel = parcelDoc.data();

    res.json({
      success: true,
      valid: true,
      parcel: {
        id: parcel.id,
        recipientName: parcel.recipientName,
        codAmount: parcel.codAmount,
        status: parcel.status,
      },
      message: `✅ الكود صحيح — الطرد #${parcel.id} — المبلغ: ${parcel.codAmount} DT`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التحقق' });
  }
});

// ─────────────────────────────────────────────
// POST /api/hubs/confirm-pudo — تأكيد التسليم عبر PUDO
// ─────────────────────────────────────────────
router.post('/confirm-pudo', authMiddleware, requireRole('hub'), async (req, res) => {
  try {
    const { code, signature } = req.body;
    if (!signature) return res.status(400).json({ success: false, message: 'التوقيع الإلكتروني مطلوب' });

    const db = getFirestore();
    const codeDoc = await db.collection('pudo_codes').doc(code).get();
    if (!codeDoc.exists || codeDoc.data().used) {
      return res.status(400).json({ success: false, message: 'الكود غير صالح' });
    }

    const pudoData = codeDoc.data();
    const now = new Date().toISOString();

    // تحديث الطرد
    const parcelRef = db.collection('parcels').doc(pudoData.parcelId);
    const parcelDoc = await parcelRef.get();
    const parcel = parcelDoc.data();

    await parcelRef.update({
      status: 'delivered',
      updatedAt: now,
      deliveredAt: now,
      deliveryMethod: 'pudo',
      statusHistory: [
        ...parcel.statusHistory,
        {
          status: 'delivered',
          timestamp: now,
          actor: req.user.id,
          actorRole: 'hub',
          note: `تسليم PUDO — كود: ${code}`,
          signature,
        },
      ],
    });

    // إبطال الكود
    await db.collection('pudo_codes').doc(code).update({ used: true, usedAt: now });

    // إضافة عمولة الهوب للرصيد
    await db.collection('users').doc(req.user.id).update({
      balance: FieldValue.increment(0.5),
    });

    res.json({
      success: true,
      message: `✅ تم تسليم الطرد #${pudoData.parcelId} — المبلغ ${parcel.codAmount} DT`,
      parcelId: pudoData.parcelId,
      codAmount: parcel.codAmount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تأكيد التسليم' });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/hubs/status — تغيير حالة الهوب (مفتوح/مغلق)
// ─────────────────────────────────────────────
router.patch('/status', authMiddleware, requireRole('hub'), async (req, res) => {
  try {
    const { isOpen } = req.body;
    const db = getFirestore();
    await db.collection('users').doc(req.user.id).update({
      isOpen: !!isOpen,
      lastStatusChange: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: isOpen ? '🟢 الهوب مفتوح الآن' : '🔴 الهوب مغلق الآن' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تغيير الحالة' });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/hubs/hours — حفظ جدول الدوام
// ─────────────────────────────────────────────
router.patch('/hours', authMiddleware, requireRole('hub'), async (req, res) => {
  try {
    const { hours } = req.body;
    // hours: { monday: {open: "08:00", close: "18:00", active: true}, ... }
    const db = getFirestore();
    await db.collection('users').doc(req.user.id).update({
      workingHours: hours,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: '💾 تم حفظ جدول الدوام' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ الجدول' });
  }
});

// ─────────────────────────────────────────────
// GET /api/hubs/nearby — هوبات قريبة (للترانسبورتور والليفرور)
// ─────────────────────────────────────────────
router.get('/nearby', authMiddleware, async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('users')
      .where('role', '==', 'hub')
      .where('isOpen', '==', true)
      .get();
    const hubs = snap.docs.map(d => {
      const h = d.data();
      return {
        id: h.id,
        name: h.name,
        address: h.address || '',
        city: h.city || '',
        phone: h.phone,
        isOpen: h.isOpen,
        workingHours: h.workingHours,
      };
    });
    res.json({ success: true, hubs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الهوبات' });
  }
});

// ─────────────────────────────────────────────
// POST /api/hubs/receive — استقبال طرد في الهوب (QR أو كود)
// ─────────────────────────────────────────────
router.post('/receive', authMiddleware, requireRole('hub'), async (req, res) => {
  try {
    const { parcelId, qrData } = req.body;
    const db = getFirestore();
    const parcelRef = db.collection('parcels').doc(parcelId);
    const doc = await parcelRef.get();

    if (!doc.exists) return res.status(404).json({ success: false, message: 'الطرد غير موجود' });

    const parcel = doc.data();
    const now = new Date().toISOString();

    await parcelRef.update({
      status: 'hub',
      currentCustodian: req.user.id,
      currentCustodianType: 'hub',
      hubs: [...(parcel.hubs || []), req.user.id],
      updatedAt: now,
      statusHistory: [
        ...parcel.statusHistory,
        {
          status: 'hub',
          timestamp: now,
          actor: req.user.id,
          actorRole: 'hub',
          note: `استقبال في الهوب — QR: ${qrData || 'manual'}`,
        },
      ],
    });

    res.json({
      success: true,
      message: `✅ تم استقبال الطرد #${parcelId} في الهوب`,
      parcel: { id: parcelId, status: 'hub' },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الاستقبال' });
  }
});

module.exports = router;
