// routes/location.js — GPS للناقلين + جلب المواقع للأدمين والتاجر
const express = require('express');
const { getFirestore } = require('../config/firebase');
const { authMiddleware, requireRole, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────
// POST /api/location/update — ناقل يرسل موقعه
// ─────────────────────────────────────────────
router.post('/update', authMiddleware, requireRole('livreur','transporteur'), async (req, res) => {
  try {
    const { lat, lng, accuracy, speed, parcelIds, timestamp } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'lat و lng مطلوبان' });

    const db  = getFirestore();
    const now = new Date().toISOString();

    // حفظ آخر موقع للناقل
    await db.collection('locations').doc(req.user.id).set({
      userId:    req.user.id,
      name:      req.user.name,
      role:      req.user.role,
      lat:       parseFloat(lat),
      lng:       parseFloat(lng),
      accuracy:  accuracy || 0,
      speed:     speed    || 0,
      parcelIds: parcelIds || [],
      updatedAt: now,
      timestamp: timestamp || now,
    });

    // تحديث موقع الطرود المرتبطة
    if (parcelIds?.length) {
      const batch = db.batch();
      for (const pid of parcelIds) {
        const ref = db.collection('parcels').doc(pid);
        batch.update(ref, {
          currentLat:  parseFloat(lat),
          currentLng:  parseFloat(lng),
          locationUpdatedAt: now,
        });
      }
      await batch.commit();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ success: false, message: 'خطأ في تحديث الموقع' });
  }
});


// ─────────────────────────────────────────────
// GET /api/location/parcel/:id — تتبع عام للزبون (بدون token)
// يظهر فقط: الحالة + المدينة + Timeline (بدون بيانات شخصية)
// ─────────────────────────────────────────────
router.get('/parcel/:id', async (req, res) => {
  try {
    const db  = getFirestore();
    const doc = await db.collection('parcels').doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'الطرد غير موجود' });
    }

    const p = doc.data();

    const statusLabels = {
      created:'تم الإنشاء', pickup:'في الاستلام',
      transit:'في الطريق',  hub:'في الهوب',
      delivery:'للتسليم',   delivered:'تم التسليم',
      attempt:'محاولة فاشلة', return:'قيد الإرجاع',
    };

    res.json({
      success: true,
      status:      p.status,
      statusLabel: statusLabels[p.status] || p.status,
      recipientCity: p.recipientCity,
      codAmount:   p.status !== 'delivered' ? p.codAmount : 0,
      // موقع الطرد الحالي — بدون بيانات الزبون
      location: (p.currentLat && p.currentLng) ? {
        lat: p.currentLat,
        lng: p.currentLng,
        updatedAt: p.locationUpdatedAt,
      } : null,
      // Timeline — بدون بيانات شخصية
      timeline: (p.statusHistory || []).map(h => ({
        status:    h.status,
        label:     statusLabels[h.status] || h.status,
        timestamp: h.timestamp,
        note:      h.actorRole ? `${h.actorRole} — ${h.note || ''}` : (h.note || ''),
      })),
    });
  } catch (err) {
    console.error('Public track error:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
});

// ─────────────────────────────────────────────
// GET /api/location/parcel/:id/details — تاجر يتتبع طرده (authenticated)
// ─────────────────────────────────────────────
router.get('/parcel/:id/details', authMiddleware, async (req, res) => {
  try {
    const db  = getFirestore();
    const doc = await db.collection('parcels').doc(req.params.id).get();

    if (!doc.exists) return res.status(404).json({ success: false, message: 'الطرد غير موجود' });

    const p = doc.data();

    // التاجر يشوف فقط طرده
    if (req.user.role === 'merchant' && p.merchantId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    }

    const statusLabels = {
      created:   'تم الإنشاء',  pickup:    'في الاستلام',
      transit:   'في الطريق',   hub:       'في الهوب',
      delivery:  'للتسليم',     delivered: 'تم التسليم',
      attempt:   'محاولة فاشلة', return:   'مرتجع',
    };

    res.json({
      success: true,
      location: (p.currentLat && p.currentLng) ? {
        lat: p.currentLat,
        lng: p.currentLng,
        updatedAt: p.locationUpdatedAt,
      } : null,
      status:      p.status,
      statusLabel: statusLabels[p.status] || p.status,
      recipientName: p.recipientName,
      recipientCity: p.recipientCity,
      // تاريخ الأحداث للتتبع
      timeline: (p.statusHistory || []).map(h => ({
        status: h.status,
        label:  statusLabels[h.status] || h.status,
        timestamp: h.timestamp,
        note:   h.note,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الموقع' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/locations — أدمين يشوف كل الناقلين
// ─────────────────────────────────────────────
router.get('/admin/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db   = getFirestore();
    const snap = await db.collection('locations').get();

    // فقط المواقع المحدّثة في آخر 2 ساعة
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const couriers = snap.docs
      .map(d => d.data())
      .filter(l => l.updatedAt > twoHoursAgo)
      .map(l => ({
        id:          l.userId,
        name:        l.name,
        role:        l.role,
        lat:         l.lat,
        lng:         l.lng,
        parcelCount: l.parcelIds?.length || 0,
        lastSeen:    l.updatedAt,
        speed:       l.speed,
      }));

    res.json({ success: true, couriers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المواقع' });
  }
});

// ─────────────────────────────────────────────
// GET /api/hubs/nearby — هوبات مفتوحة قريبة (للترانسبورتور)
// مع إحداثيات وهمية للمرحلة الأولى
// ─────────────────────────────────────────────
router.get('/hubs/map', authMiddleware, async (req, res) => {
  try {
    const db   = getFirestore();
    const snap = await db.collection('users')
      .where('role', '==', 'hub')
      .where('status', '==', 'active')
      .get();

    const hubs = snap.docs.map(d => {
      const h = d.data();
      return {
        id:      h.id,
        name:    h.name,
        city:    h.city    || '',
        address: h.address || '',
        phone:   h.phone   || '',
        isOpen:  h.isOpen  || false,
        // إحداثيات حقيقية لو موجودة في البيانات
        lat: h.lat || null,
        lng: h.lng || null,
      };
    }).filter(h => h.lat && h.lng); // فقط اللي عندهم إحداثيات

    res.json({ success: true, hubs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الهوبات' });
  }
});

module.exports = router;
