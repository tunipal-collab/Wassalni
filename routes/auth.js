// routes/auth.js — تسجيل، دخول، تفعيل حسابات
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('../config/firebase');
const { generateToken, authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// أدوار مقبولة
const VALID_ROLES = ['merchant', 'livreur', 'transporteur', 'hub'];

// التاجر يُفعَّل فوراً، البقية تحتاج موافقة الأدمين
const AUTO_APPROVE_ROLES = ['merchant'];

// ─────────────────────────────────────────────
// POST /api/auth/register — تسجيل مستخدم جديد
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, role, address, city, cin,
            activity, vehicleType, phone2 } = req.body;

    // التحقق من الحقول الإلزامية
    if (!name || !phone || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'الاسم، الهاتف، كلمة السر، والدور — كلها مطلوبة',
      });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `الدور غير صحيح — الأدوار المقبولة: ${VALID_ROLES.join(', ')}`,
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'كلمة السر يجب أن تكون 6 أحرف على الأقل',
      });
    }

    const db = getFirestore();

    // التحقق أن الهاتف غير مستعمل
    const existing = await db.collection('users')
      .where('phone', '==', phone.trim())
      .limit(1).get();

    if (!existing.empty) {
      return res.status(409).json({
        success: false,
        message: 'رقم الهاتف مسجل مسبقاً',
      });
    }

    // تشفير كلمة السر
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const now = new Date().toISOString();

    // التاجر يُفعَّل فوراً — البقية status: pending
    const isAutoApproved = AUTO_APPROVE_ROLES.includes(role);

    const userData = {
      id: userId,
      name: name.trim(),
      phone: phone.trim(),
      password: hashedPassword,
      role,
      status: isAutoApproved ? 'active' : 'pending',
      balance: 0,
      cashCeiling: role === 'livreur' ? 500 : null,
      address: address || '',
      city: city || '',
      cin: cin || '',
      activity: activity || '',
      vehicleType: vehicleType || '',
      phone2: phone2 || '',
      isOpen: role === 'hub' ? false : null,
      workingHours: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection('users').doc(userId).set(userData);

    // إذا محتاج موافقة → حفظ طلب التسجيل
    if (!isAutoApproved) {
      await db.collection('registration_requests').doc(userId).set({
        id: userId,
        userId,
        name: name.trim(),
        phone: phone.trim(),
        role,
        city: city || '',
        cin: cin || '',
        status: 'pending',
        createdAt: now,
      });
    }

    // التاجر يدخل مباشرة
    if (isAutoApproved) {
      const token = generateToken({
        id: userId,
        name: userData.name,
        phone: userData.phone,
        role,
      });

      return res.status(201).json({
        success: true,
        message: '✅ تم تسجيلك — مرحباً بك في وصّلني!',
        token,
        user: { id: userId, name: userData.name, phone: userData.phone, role },
        redirect: '/merchant-app.html',
      });
    }

    res.status(201).json({
      success: true,
      status: 'pending',
      message: '✅ تم استلام طلبك — سيتم مراجعته والتواصل معك قريباً',
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'خطأ في التسجيل' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/login — تسجيل الدخول
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'الهاتف وكلمة السر مطلوبان',
      });
    }

    const db = getFirestore();

    // دخول الأدمين بكلمة سر خاصة
    if (phone === 'admin') {
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword || password !== adminPassword) {
        return res.status(401).json({ success: false, message: 'بيانات الأدمين غير صحيحة' });
      }

      const token = generateToken({ id: 'admin', name: 'المدير', phone: 'admin', role: 'admin' });
      return res.json({
        success: true,
        token,
        user: { id: 'admin', name: 'المدير', phone: 'admin', role: 'admin' },
        redirect: '/admin-dashboard.html',
      });
    }

    // بحث المستخدم بالهاتف
    const snap = await db.collection('users')
      .where('phone', '==', phone.trim())
      .limit(1).get();

    if (snap.empty) {
      return res.status(401).json({ success: false, message: 'رقم الهاتف أو كلمة السر غير صحيحة' });
    }

    const user = snap.docs[0].data();

    // التحقق من كلمة السر
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'رقم الهاتف أو كلمة السر غير صحيحة' });
    }

    // التحقق من الحالة
    if (user.status === 'pending') {
      return res.json({
        success: true,
        status: 'pending',
        message: 'حسابك قيد المراجعة — سيتم إشعارك عند التفعيل',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'حسابك موقوف — تواصل مع الدعم',
      });
    }

    // توليد الـ Token
    const token = generateToken({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
    });

    // تحديد صفحة الإعادة حسب الـ role
    const redirectMap = {
      merchant:     '/merchant-app.html',
      livreur:      '/livreur-app.html',
      transporteur: '/transporteur-app.html',
      hub:          '/hub-app.html',
      admin:        '/admin-dashboard.html',
    };

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
      redirect: redirectMap[user.role] || '/Index.html',
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'خطأ في تسجيل الدخول' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/me — بيانات المستخدم الحالي
// ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // الأدمين لا يملك document في Firestore
    if (req.user.role === 'admin') {
      return res.json({
        success: true,
        user: { id: 'admin', name: 'المدير', phone: 'admin', role: 'admin', status: 'active' },
      });
    }

    const db = getFirestore();
    const doc = await db.collection('users').doc(req.user.id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const user = doc.data();
    delete user.password;

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/approve/:id — تفعيل حساب (أدمين)
// ─────────────────────────────────────────────
router.post('/approve/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    const now = new Date().toISOString();

    await db.collection('users').doc(req.params.id).update({
      status: 'active',
      approvedBy: req.user.id,
      approvedAt: now,
      updatedAt: now,
    });

    await db.collection('registration_requests').doc(req.params.id)
      .update({ status: 'approved', updatedAt: now })
      .catch(() => {}); // قد لا يكون موجوداً

    res.json({ success: true, message: '✅ تم تفعيل الحساب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التفعيل' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/suspend/:id — تعليق حساب (أدمين)
// ─────────────────────────────────────────────
router.post('/suspend/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getFirestore();
    await db.collection('users').doc(req.params.id).update({
      status: 'suspended',
      suspendedBy: req.user.id,
      suspendedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: '⚠️ تم تعليق الحساب' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التعليق' });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/auth/profile — تعديل بيانات المستخدم
// ─────────────────────────────────────────────
router.patch('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, address, city, currentPassword, newPassword } = req.body;
    const db = getFirestore();
    const doc = await db.collection('users').doc(req.user.id).get();

    if (!doc.exists) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    const user = doc.data();
    const updates = { updatedAt: new Date().toISOString() };

    if (name)    updates.name    = name.trim();
    if (address) updates.address = address;
    if (city)    updates.city    = city;

    // تغيير كلمة السر
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'كلمة السر الحالية مطلوبة' });
      }
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) {
        return res.status(401).json({ success: false, message: 'كلمة السر الحالية غير صحيحة' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'كلمة السر الجديدة 6 أحرف على الأقل' });
      }
      updates.password = await bcrypt.hash(newPassword, 10);
    }

    await db.collection('users').doc(req.user.id).update(updates);
    res.json({ success: true, message: '✅ تم تحديث بياناتك' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التحديث' });
  }
});

module.exports = router;
