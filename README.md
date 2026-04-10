# 🚚 وصّلني — Backend دليل التثبيت الكامل

## هيكل المشروع

```
wassalni/
├── server.js                  ← نقطة الدخول الرئيسية
├── package.json
├── .env.example               ← انسخه كـ .env وعبّيه
├── config/
│   └── firebase.js            ← Firebase Admin SDK
├── middleware/
│   └── auth.js                ← JWT + role guards
├── routes/
│   ├── auth.js                ← تسجيل دخول / تسجيل / تفعيل
│   ├── parcels.js             ← إنشاء / تتبع / تحديث الطرود
│   ├── finance.js             ← رصيد / سحب / بلافون / COD
│   ├── hubs.js                ← PUDO codes / استقبال / جدول دوام
│   └── admin.js               ← KPIs / مستخدمين / نزاعات / تقارير
└── public/                    ← ملفات HTML + wassalni-api.js
    ├── wassalni-api.js        ← الجسر بين HTML والـ Backend
    ├── Index.html             ← بوابة الدخول الموحدة
    ├── merchant-app.html      ← تطبيق التاجر
    ├── livreur-app.html       ← تطبيق الليفرور
    ├── hub-app.html           ← تطبيق الهوب
    ├── transporteur-app.html  ← تطبيق الترانسبورتور
    └── admin-dashboard.html   ← لوحة الأدمين
```

---

## خطوات التثبيت

### 1. تثبيت الـ packages
```bash
cd wassalni
npm install
```

### 2. Firebase Service Account Key
1. روح على https://console.firebase.google.com
2. Project Settings → Service Accounts
3. اضغط "Generate new private key" → احفظ الملف كـ `serviceAccountKey.json`

### 3. إنشاء ملف .env
```bash
cp .env.example .env
```
عبّي هذه القيم في `.env`:
```
JWT_SECRET=اكتب-مفتاح-سري-طويل-هنا
ADMIN_PASSWORD=كلمة-سر-الأدمين
FIREBASE_PROJECT_ID=wassalni--app
FIREBASE_DATABASE_URL=https://wassalni--app-default-rtdb.firebaseio.com
FIREBASE_PRIVATE_KEY_ID=من-ملف-serviceAccountKey.json
FIREBASE_PRIVATE_KEY="من-ملف-serviceAccountKey.json"
FIREBASE_CLIENT_EMAIL=من-ملف-serviceAccountKey.json
```

### 4. تشغيل الـ Server
```bash
# Development
npm run dev

# Production
npm start
```

الـ server يشتغل على: `http://localhost:3000`

---

## الـ API Endpoints

### Auth
| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/api/auth/register` | تسجيل مستخدم جديد |
| POST | `/api/auth/login` | دخول → JWT Token |
| GET | `/api/auth/me` | بيانات المستخدم الحالي |
| POST | `/api/auth/approve/:id` | تفعيل حساب (أدمين) |
| POST | `/api/auth/suspend/:id` | تعليق حساب (أدمين) |

### Login Examples
```json
// تاجر
{ "phone": "55123456", "password": "abc123" }

// أدمين
{ "phone": "admin", "password": "ADMIN_PASSWORD_من_.env" }
```

### Response بعد Login ناجح
```json
{
  "success": true,
  "token": "eyJ...",
  "user": { "id": "...", "name": "محمد", "role": "merchant" },
  "redirect": "/merchant-app.html"
}
```

---

## كيف يعمل الـ JWT

كل request بعد Login يحتاج:
```
Authorization: Bearer <token>
```

الـ `wassalni-api.js` يضيف هذا تلقائياً من `localStorage`.

---

## Firestore Collections

| Collection | الوصف |
|-----------|-------|
| `users` | كل المستخدمين |
| `parcels` | الطرود |
| `registration_requests` | طلبات التسجيل |
| `pudo_codes` | أكواد PUDO (24h) |
| `withdrawal_requests` | طلبات السحب |
| `cash_transactions` | سجل الكاش COD |
| `settlements` | تسويات التجار |
| `settlement_codes` | أكواد خلاص التجار |
| `disputes` | النزاعات |
| `notifications` | الإشعارات |
| `zones` | مناطق التسليم |

---

## Firestore Security Rules (أضفها في Firebase Console)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // كل العمليات عبر Backend فقط (Firebase Admin SDK)
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

> ⚠️ مهم: بما أن الـ backend يستخدم Firebase Admin SDK، فهو يتجاوز الـ rules. الـ rules هنا لحماية من الوصول المباشر.

---

## تدفق العمل الكامل

```
1. مستخدم جديد → POST /api/auth/register → status: pending
2. أدمين يرى الطلب في Dashboard → POST /api/admin/users/:id/approve
3. المستخدم يدخل → POST /api/auth/login → يحصل على JWT → يُوجَّه للصفحة المناسبة
4. كل action في الـ HTML → wassalni-api.js → Backend API → Firestore
```

---

## Deploy على Railway/Render

```bash
# Railway
railway login
railway init
railway up

# Render
# أضف environment variables من .env في لوحة Render
# Start Command: node server.js
```

---

## ⚠️ ملاحظات مهمة

1. **كلمات السر**: في الـ production، غيّر `JWT_SECRET` و`ADMIN_PASSWORD` لقيم قوية
2. **HTTPS**: استخدم دائماً HTTPS في الـ production
3. **Rate Limiting**: مفعّل — 200 request/15min، 10 login attempts/15min
4. **Passwords**: مشفّرة بـ bcrypt (لا تُخزَّن كـ plain text)
5. **Firebase Rules**: فعّل الـ rules لإغلاق الوصول المباشر لـ Firestore
