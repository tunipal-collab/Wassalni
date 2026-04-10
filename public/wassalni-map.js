// wassalni-map.js — نظام GPS والخريطة لمنصة وصّلني
// Leaflet.js + OpenStreetMap — مجاني 100%
// ─────────────────────────────────────────────
// أضف في <head> لكل صفحة تحتاج خريطة:
//   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
//   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
//   <script src="/wassalni-map.js"></script>

// ══════════════════════════════════════════════
//   GPS TRACKER — للناقلين (ليفرور / ترانسبورتور)
//   يرسل الموقع للـ backend كل 30 ثانية
// ══════════════════════════════════════════════
const WsGPS = {
  _watchId:   null,
  _interval:  null,
  _active:    false,
  _lastPos:   null,
  _parcelIds: [],

  async start(parcelIds = []) {
    if (this._active) return;
    if (!navigator.geolocation) { console.warn('GPS غير متاح'); return; }
    this._active    = true;
    this._parcelIds = parcelIds;

    this._watchId = navigator.geolocation.watchPosition(
      pos => {
        this._lastPos = {
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed:    pos.coords.speed || 0,
        };
      },
      err => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    this._interval = setInterval(() => this._send(), 30000);
    setTimeout(() => this._send(), 1500);
    console.log('✅ GPS مفعّل — إرسال كل 30 ثانية');
  },

  stop() {
    this._active = false;
    if (this._watchId !== null) navigator.geolocation.clearWatch(this._watchId);
    if (this._interval) clearInterval(this._interval);
    this._watchId = this._interval = null;
    console.log('⏹ GPS متوقف');
  },

  async _send() {
    if (!this._active || !this._lastPos) return;
    const token = localStorage.getItem('ws_token');
    if (!token) return;
    try {
      await fetch('/api/location/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
          lat:       this._lastPos.lat,
          lng:       this._lastPos.lng,
          accuracy:  this._lastPos.accuracy,
          speed:     this._lastPos.speed,
          parcelIds: this._parcelIds,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (e) { console.warn('GPS send error:', e.message); }
  },

  getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject('GPS غير متاح');
      navigator.geolocation.getCurrentPosition(
        p  => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        e  => reject(e.message),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  },

  // حساب المسافة بالكيلومتر بين نقطتين
  distance(lat1, lng1, lat2, lng2) {
    const R  = 6371;
    const dL = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const a  = Math.sin(dL/2)**2 +
               Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },
};

// ══════════════════════════════════════════════
//   WsMap — خريطة Leaflet موحدة لكل الأدوار
// ══════════════════════════════════════════════
class WsMap {
  constructor(containerId, role = 'merchant') {
    this.containerId = containerId;
    this.role        = role;
    this.map         = null;
    this.myMarker    = null;
    this.markers     = {};
    this.hubCircle   = null;
    this.hubMarkers  = [];
  }

  _icon(emoji, color = '#1a56ff', size = 36) {
    return L.divIcon({
      html: `<div style="
        width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
        background:${color};transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white;">
        <span style="transform:rotate(45deg);font-size:${size*0.45}px;line-height:1">${emoji}</span>
      </div>`,
      className: '',
      iconSize:   [size, size],
      iconAnchor: [size/2, size],
      popupAnchor:[0, -size],
    });
  }

  init(lat = 36.8189, lng = 10.1658, zoom = 12) {
    if (this.map) return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    this.map = L.map(this.containerId, {
      zoomControl: true,
      attributionControl: true,
    }).setView([lat, lng], zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);
  }

  // ── موقعي (الناقل) ──
  setMyPosition(lat, lng, label = 'موقعي') {
    if (!this.map) return;
    const icon = this.role === 'livreur'
      ? this._icon('🛵', '#10b981')
      : this._icon('🚗', '#f59e0b');

    if (this.myMarker) {
      this.myMarker.setLatLng([lat, lng]);
    } else {
      this.myMarker = L.marker([lat, lng], { icon })
        .addTo(this.map)
        .bindPopup(`<b>${label}</b><br>موقعك الحالي`);
    }

    // دائرة 5 كلم حول الترانسبورتور لإظهار الهوبات
    if (this.role === 'transporteur') {
      if (this.hubCircle) this.hubCircle.setLatLng([lat, lng]);
      else {
        this.hubCircle = L.circle([lat, lng], {
          radius: 5000,
          color: '#f59e0b',
          fillColor: '#f59e0b',
          fillOpacity: 0.06,
          weight: 1.5,
          dashArray: '6,4',
        }).addTo(this.map);
      }
    }
  }

  // ── طرد على الخريطة ──
  addParcel(parcel) {
    if (!this.map || !parcel.lat || !parcel.lng) return;
    const statusColors = {
      created:   '#94a3b8', pickup: '#6366f1',
      transit:   '#1a56ff', hub:    '#f59e0b',
      delivery:  '#f97316', delivered: '#10b981',
      attempt:   '#ef4444', return: '#ff3d6b',
    };
    const color = statusColors[parcel.status] || '#94a3b8';
    const icon  = this._icon('📦', color, 32);

    if (this.markers[parcel.id]) {
      this.markers[parcel.id].setLatLng([parcel.lat, parcel.lng]);
    } else {
      this.markers[parcel.id] = L.marker([parcel.lat, parcel.lng], { icon })
        .addTo(this.map)
        .bindPopup(`
          <div style="font-family:'Tajawal',sans-serif;min-width:180px;direction:rtl">
            <div style="font-weight:800;font-size:14px;margin-bottom:4px">${parcel.id}</div>
            <div style="font-size:12px;color:#64748b">${parcel.recipientName || ''}</div>
            <div style="font-size:12px;color:#64748b">${parcel.recipientCity || ''}</div>
            <div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:20px;
              background:${color}22;color:${color};font-size:11px;font-weight:700">
              ${parcel.statusLabel || parcel.status}
            </div>
          </div>`);
    }
  }

  // ── هوب على الخريطة ──
  addHub(hub, myLat = null, myLng = null) {
    if (!this.map || !hub.lat || !hub.lng) return;
    const isOpen    = hub.isOpen !== false;
    const color     = isOpen ? '#f59e0b' : '#94a3b8';
    const icon      = this._icon('🏪', color, 34);
    const dist      = (myLat && myLng)
      ? WsGPS.distance(myLat, myLng, hub.lat, hub.lng).toFixed(1) + ' كلم'
      : '';
    const inRange   = (myLat && myLng)
      ? WsGPS.distance(myLat, myLng, hub.lat, hub.lng) <= 5
      : true;

    // للترانسبورتور: يُظهر فقط الهوبات في نطاق 5 كلم
    if (this.role === 'transporteur' && myLat && myLng && !inRange) return;

    const marker = L.marker([hub.lat, hub.lng], { icon })
      .addTo(this.map)
      .bindPopup(`
        <div style="font-family:'Tajawal',sans-serif;min-width:180px;direction:rtl">
          <div style="font-weight:800;font-size:14px;margin-bottom:4px">${hub.name}</div>
          <div style="font-size:12px;color:#64748b">${hub.address || hub.city || ''}</div>
          ${hub.phone ? `<div style="font-size:12px;color:#64748b">📞 ${hub.phone}</div>` : ''}
          ${dist ? `<div style="font-size:12px;color:#1a56ff;margin-top:4px">📍 ${dist}</div>` : ''}
          <div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:20px;
            background:${color}22;color:${color};font-size:11px;font-weight:700">
            ${isOpen ? '🟢 مفتوح' : '🔴 مغلق'}
          </div>
        </div>`);

    this.hubMarkers.push(marker);
    return marker;
  }

  // ── ناقل على الخريطة (للأدمين) ──
  addCourier(courier) {
    if (!this.map || !courier.lat || !courier.lng) return;
    const isLivreur = courier.role === 'livreur';
    const color     = isLivreur ? '#10b981' : '#f59e0b';
    const emoji     = isLivreur ? '🛵' : '🚗';
    const icon      = this._icon(emoji, color, 32);

    if (this.markers['courier_' + courier.id]) {
      this.markers['courier_' + courier.id].setLatLng([courier.lat, courier.lng]);
    } else {
      this.markers['courier_' + courier.id] = L.marker([courier.lat, courier.lng], { icon })
        .addTo(this.map)
        .bindPopup(`
          <div style="font-family:'Tajawal',sans-serif;min-width:160px;direction:rtl">
            <div style="font-weight:800;font-size:14px">${courier.name}</div>
            <div style="font-size:12px;color:#64748b">${isLivreur ? 'ليفرور' : 'ترانسبورتور'}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">
              📦 ${courier.parcelCount || 0} طرد في العهدة
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">
              آخر تحديث: ${courier.lastSeen || '—'}
            </div>
          </div>`);
    }
  }

  // ── تحديث الخريطة لتاجر (يشوف طرده فقط) ──
  async loadForMerchant(parcelId) {
    if (!this.map) return;
    const r = await API.get('/parcels/' + parcelId + '/location');
    if (!r.ok || !r.data.location) return;
    const loc = r.data.location;
    this.addParcel({
      id: parcelId,
      lat: loc.lat,
      lng: loc.lng,
      status: r.data.status,
      statusLabel: r.data.statusLabel,
      recipientName: r.data.recipientName,
      recipientCity: r.data.recipientCity,
    });
    this.map.setView([loc.lat, loc.lng], 14);
  }

  // ── تحديث الخريطة للأدمين (كل الناقلين + الهوبات) ──
  async loadForAdmin() {
    if (!this.map) return;

    // جلب مواقع الناقلين
    const r1 = await API.get('/admin/locations');
    if (r1.ok && r1.data.couriers) {
      r1.data.couriers.forEach(c => this.addCourier(c));
    }

    // جلب الهوبات
    const r2 = await API.get('/admin/hubs');
    if (r2.ok && r2.data.hubs) {
      r2.data.hubs.forEach(h => this.addHub(h));
    }
  }

  // ── تحديث الخريطة للترانسبورتور (هوبات 5 كلم) ──
  async loadForTransporteur() {
    if (!this.map) return;
    try {
      const pos = await WsGPS.getPosition();
      this.setMyPosition(pos.lat, pos.lng, 'موقعك');
      this.map.setView([pos.lat, pos.lng], 13);

      // جلب الهوبات المفتوحة
      const r = await API.get('/hubs/nearby');
      if (r.ok && r.data.hubs) {
        r.data.hubs.forEach(h => {
          if (h.lat && h.lng) this.addHub(h, pos.lat, pos.lng);
        });
      }
    } catch (e) {
      // GPS غير متاح — مركز تونس كـ fallback
      this.map.setView([36.8189, 10.1658], 10);
    }
  }

  // ── تحديث الخريطة للليفرور (طرودو على الخريطة) ──
  async loadForLivreur() {
    if (!this.map) return;
    try {
      const pos = await WsGPS.getPosition();
      this.setMyPosition(pos.lat, pos.lng, 'موقعك');
      this.map.setView([pos.lat, pos.lng], 13);
    } catch (e) {
      this.map.setView([36.8189, 10.1658], 12);
    }

    const r = await API.get('/parcels');
    if (r.ok && r.data.parcels) {
      r.data.parcels.forEach(p => {
        if (p.lat && p.lng) this.addParcel(p);
      });
    }
  }

  removeMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
    }
  }

  fitAll() {
    if (!this.map) return;
    const all = Object.values(this.markers);
    if (this.myMarker) all.push(this.myMarker);
    if (all.length === 0) return;
    const group = L.featureGroup(all);
    this.map.fitBounds(group.getBounds().pad(0.2));
  }
}

// helper داخلي للـ fetch
const API = {
  get: async (path) => {
    const token = localStorage.getItem('ws_token');
    try {
      const res  = await fetch('/api' + path, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch (e) {
      return { ok: false, data: {} };
    }
  },
};
