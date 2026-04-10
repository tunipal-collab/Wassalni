// routes/finance.js — المالية: رصيد، سحوبات، بلافون الكاش
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { authMiddleware, requireRole, adminOnly } = require('../middleware/auth');

const router = express.Router();

const CASH_CEILING_DEFAULT = 500; // DT — بلافون الليفرور الافتراضي

// ─────────────────────────────────────────────
// GET /api/finance/balance — رصيد المستخدم الحالي
// ─────────────────────────────────────────────
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const db = getFirestore();

    if (req.user.role === 'admin') {
      // Admin يشوف الإجماليات
      const usersSnap = await db.collection('users').get();
      let totalBalance = 0;
      usersSnap.forEach(d => { totalBalance += d.data().balance || 0; });
      return res.json({ success: true, totalPlatformBalance: totalBalance });
    }

    const doc = await db.collection('users').doc(req.user.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    const user = doc.data();

    // للـ livreur: احسب الكاش الحالي في يده
    let cashInHand = 0;
    if (user.role === 'livreur') {
      const parcelsSnap = await db.collection('parcels')
        .where('livreurId', '==', req.user.id)
        .where('status', '==', 'delivered')
        .get();
      // الكاش اللي في يده = COD لطرود مسلّمة ولم يتم تفريغها بعد
      const cashSnap = await db.collection('cash_transactions')
        .where('livreurId', '==', req.user.id)
        .where('type', '==', 'cod_collected')
        .where('cleared', '==', false)
        .get();
      cashSnap.forEach(d => { cashInHand += d.data().amount || 0; });
    }

    res.json({
      success: true,
      balance: user.balance || 0,
      cashCeiling: user.cashCeiling || null,
      cashInHand,
      cashCeilingReached: user.role === 'livreur' && cashInHand >= (user.cashCeiling || CASH_CEILING_DEFAULT),
      currency: 'DT',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الرصيد' });
  }
});

// ─────────────────────────────────────────────
// POST /api/finance/withdraw — طلب سحب رصيد
// ─────────────────────────────────────────────
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, method } = req.body; // method: hub_cash | d17 | bank | poste
    const allowedMethods = ['hub_cash', 'd17', 'bank', 'poste'];

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'أدخل مبلغاً صحيحاً' });
    }
    if (!method || !allowedMethods.includes(method)) {
      return res.status(400).json({ success: false, message: 'طريقة السحب غير صحيحة' });
    }

    const db = getFirestore();
    const doc = await db.collection('users').doc(req.user.id).get();
    const user = doc.data();

    if ((user.balance || 0) < parseFloat(amount)) {
      return res.status(400).json({ success: false, message: 'رصيدك غير كافٍ' });
    }

    // إنشاء طلب السحب
    const requestId = uuidv4();
    await db.collection('withdrawal_requests').doc(requestId).set({
      id: requestId,
      userId: req.user.id,
      userName: req.user.name,
      role: req.user.role,
      amount: parseFloat(amount),
      method,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: `✅ طلب سحب ${amount} DT تم إرساله — طريقة: ${method}`,
      requestId,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في طلب السحب' });
  }
});

// ─────────────────────────────────────────────
// POST /api/finance/cod — تسجيل كاش COD (ليفرور/هوب)
// ─────────────────────────────────────────────
router.post('/cod', authMiddleware, requireRole('livreur', 'hub'), async (req, res) => {
  try {
    const { parcelId, amount, type } = req.body;
    // type: cod_collected (قبض من زبون) | cod_transferred (تسليم للهوب) | cod_cleared (تفريغ)

    const db = getFirestore();
    const txId = uuidv4();

    await db.collection('cash_transactions').doc(txId).set({
      id: txId,
      parcelId,
      amount: parseFloat(amount),
      type,
      actorId: req.user.id,
      actorRole: req.user.role,
      livreurId: req.user.role === 'livreur' ? req.user.id : null,
      hubId: req.user.role === 'hub' ? req.user.id : null,
      cleared: false,
      createdAt: new Date().toISOString(),
    });

    // تحديث رصيد المستخدم إذا كان تفريغ
    if (type === 'cod_cleared') {
      await db.collection('users').doc(req.user.id).update({
        balance: FieldValue.increment(parseFloat(amount)),
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: '✅ تم تسجيل العملية المالية', txId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل الكاش' });
  }
});

// ─────────────────────────────────────────────
// GET /api/finance/ceiling/:userId — جلب بلافون الكاش
// ─────────────────────────────────────────────
router.get('/ceiling/:userId', authMiddleware, async (req, res) => {
  try {
    // المستخدم يشوف بلافونه، أو الأدمين يشوف أي مستخدم
    const targetId = req.params.userId === 'me' ? req.user.id : req.params.userId;
    if (targetId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    }

    const db = getFirestore();
    const doc = await db.collection('users').doc(targetId).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    const user = doc.data();
    res.json({
      success: true,
      userId: targetId,
      cashCeiling: user.cashCeiling || CASH_CEILING_DEFAULT,
      balance: user.balance || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب البلافون' });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/finance/ceiling/:userId — أدمين يعدّل البلافون
// ─────────────────────────────────────────────
router.patch('/ceiling/:userId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { newCeiling } = req.body;
    if (!newCeiling || parseFloat(newCeiling) <= 0) {
      return res.status(400).json({ success: false, message: 'أدخل مبلغ صحيح' });
    }

    const db = getFirestore();
    await db.collection('users').doc(req.params.userId).update({
      cashCeiling: parseFloat(newCeiling),
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, message: `✅ تم تحديث البلافون إلى ${newCeiling} DT` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث البلافون' });
  }
});

// ─────────────────────────────────────────────
// GET /api/finance/withdrawals — أدمين يشوف طلبات السحب
// ─────────────────────────────────────────────
router.get('/withdrawals', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const { status } = req.query;
    let query = db.collection('withdrawal_requests').orderBy('createdAt', 'desc');
    if (status) query = query.where('status', '==', status);
    const snap = await query.limit(100).get();
    const requests = snap.docs.map(d => d.data());
    res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الطلبات' });
  }
});

// ─────────────────────────────────────────────
// POST /api/finance/merchant-settle — خلاص التاجر (أدمين)
// ─────────────────────────────────────────────
router.post('/merchant-settle', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { merchantId, amount, code } = req.body;
    // code: رمز التحقق اللي يرسله الأدمين للتاجر

    const db = getFirestore();

    // التحقق من الكود
    const codeSnap = await db.collection('settlement_codes')
      .where('merchantId', '==', merchantId)
      .where('code', '==', code)
      .where('used', '==', false)
      .limit(1).get();

    if (codeSnap.empty) {
      return res.status(400).json({ success: false, message: 'الكود غير صحيح أو مستعمل' });
    }

    const txId = uuidv4();
    const now = new Date().toISOString();

    // خصم من رصيد التاجر وإضافة transaction
    await db.collection('users').doc(merchantId).update({
      balance: 0, // reset بعد الخلاص
      updatedAt: now,
    });

    await db.collection('settlement_codes').doc(codeSnap.docs[0].id).update({ used: true });

    await db.collection('settlements').doc(txId).set({
      id: txId,
      merchantId,
      amount: parseFloat(amount),
      settledBy: req.user.id,
      settledAt: now,
      code,
    });

    res.json({ success: true, message: `✅ تم تسوية مبلغ ${amount} DT للتاجر`, txId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التسوية' });
  }
});

// ─────────────────────────────────────────────
// POST /api/finance/generate-settlement-code — توليد كود خلاص للتاجر
// ─────────────────────────────────────────────
router.post('/generate-settlement-code', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { merchantId } = req.body;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const db = getFirestore();

    await db.collection('settlement_codes').add({
      merchantId,
      code,
      used: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 ساعة
    });

    res.json({ success: true, code, message: `كود الخلاص: ${code}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في توليد الكود' });
  }
});

module.exports = router;
