// wassalni-qr.js — نظام QR لمنصة وصّلني
// jsQR للقراءة + QRCode.js للتوليد
// ─────────────────────────────────────────────
// أضف في <head>:
//   <script src="https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js"></script>
//   <script src="https://unpkg.com/jsqr@1.4.0/dist/jsQR.js"></script>
//   <script src="/wassalni-qr.js"></script>

// ══════════════════════════════════════════════
//   WsQR — توليد QR للطرود
// ══════════════════════════════════════════════
const WsQR = {

  generate(parcelId, containerId, size = 220) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const payload = JSON.stringify({ id: parcelId, v: 'ws1', t: Date.now() });
    container.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      QRCode.toCanvas(canvas, payload, {
        width: size, margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'H',
      });
    } else {
      container.innerHTML = `
        <div style="width:${size}px;height:${size}px;background:white;border-radius:12px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          border:2px solid #e2e8f5;">
          <div style="font-size:48px;margin-bottom:8px">📦</div>
          <div style="font-family:monospace;font-size:15px;font-weight:700;color:#1a56ff">${parcelId}</div>
          <div style="font-size:11px;color:#64748b;margin-top:6px">وصّلني</div>
        </div>`;
    }
  },

  parseQRData(raw) {
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (p.v === 'ws1' && p.id) return p.id;
      if (p.id) return p.id;
    } catch (e) {}
    if (typeof raw === 'string' && raw.startsWith('WS-')) return raw.trim();
    return null;
  },
};

// ══════════════════════════════════════════════
//   WsQRScanner — ماسح QR بالكاميرا الحقيقية
// ══════════════════════════════════════════════
class WsQRScanner {
  constructor(options = {}) {
    this.containerId = options.containerId || 'qr-scanner-wrap';
    this.onScan      = options.onScan  || (() => {});
    this.onError     = options.onError || (() => {});
    this.active      = false;
    this.stream      = null;
    this.animFrame   = null;
    this.lastScan    = 0;
    this.cooldown    = 2500;
  }

  _buildUI() {
    const c = document.getElementById(this.containerId);
    if (!c) return;
    c.innerHTML = `
      <style>
        @keyframes ws-sweep{0%,100%{top:12%}50%{top:78%}}
      </style>
      <div style="position:relative;width:100%;max-width:300px;margin:0 auto;
        border-radius:20px;overflow:hidden;background:#000;aspect-ratio:1/1;">
        <video id="wsqr-video" style="width:100%;height:100%;object-fit:cover;"
          playsinline autoplay muted></video>
        <canvas id="wsqr-canvas" style="display:none;"></canvas>
        <div style="position:absolute;inset:0;pointer-events:none;
          display:flex;align-items:center;justify-content:center;">
          <div style="position:relative;width:190px;height:190px;">
            <div style="position:absolute;top:0;right:0;width:28px;height:28px;
              border-top:3px solid #1a56ff;border-right:3px solid #1a56ff;border-radius:0 8px 0 0;"></div>
            <div style="position:absolute;top:0;left:0;width:28px;height:28px;
              border-top:3px solid #1a56ff;border-left:3px solid #1a56ff;border-radius:8px 0 0 0;"></div>
            <div style="position:absolute;bottom:0;right:0;width:28px;height:28px;
              border-bottom:3px solid #1a56ff;border-right:3px solid #1a56ff;border-radius:0 0 8px 0;"></div>
            <div style="position:absolute;bottom:0;left:0;width:28px;height:28px;
              border-bottom:3px solid #1a56ff;border-left:3px solid #1a56ff;border-radius:0 0 0 8px;"></div>
            <div style="position:absolute;left:4px;right:4px;height:2px;
              background:linear-gradient(90deg,transparent,#1a56ff,#00b87a,#1a56ff,transparent);
              animation:ws-sweep 2s ease-in-out infinite;box-shadow:0 0 8px #1a56ff55;"></div>
          </div>
        </div>
        <div id="wsqr-flash" style="position:absolute;inset:0;pointer-events:none;
          transition:background 0.3s;border-radius:20px;"></div>
        <div id="wsqr-status" style="position:absolute;bottom:0;left:0;right:0;
          background:rgba(0,0,0,0.65);color:white;text-align:center;padding:10px;
          font-family:'Tajawal',sans-serif;font-size:13px;font-weight:700;">
          📷 وجّه الكاميرا نحو QR الطرد
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <input id="wsqr-manual" type="text" placeholder="أو أدخل رقم الطرد يدوياً"
          style="flex:1;background:#f0f4ff;border:1.5px solid #e2e8f5;border-radius:12px;
            padding:12px 14px;font-family:'Tajawal',sans-serif;font-size:14px;
            color:#0f172a;outline:none;text-transform:uppercase;"
          oninput="this.value=this.value.toUpperCase()">
        <button id="wsqr-btn" style="background:#1a56ff;color:white;border:none;
          border-radius:12px;padding:12px 16px;font-family:'Tajawal',sans-serif;
          font-size:14px;font-weight:700;cursor:pointer;">تأكيد</button>
      </div>`;

    document.getElementById('wsqr-btn').onclick = () => {
      const val = document.getElementById('wsqr-manual').value.trim();
      if (!val) return;
      const id = WsQR.parseQRData(val);
      if (id) { this._success(id); document.getElementById('wsqr-manual').value = ''; }
      else this._setStatus('❌ رقم غير صحيح', '#ef4444');
    };
    document.getElementById('wsqr-manual').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('wsqr-btn').click();
    });
  }

  async start() {
    this._buildUI();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
      });
      document.getElementById('wsqr-video').srcObject = this.stream;
      await document.getElementById('wsqr-video').play();
      this.active = true;
      this._loop();
    } catch (err) {
      this._setStatus('❌ الكاميرا غير متاحة — استخدم الإدخال اليدوي', '#ef4444');
      this.onError(err);
    }
  }

  stop() {
    this.active = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = this.animFrame = null;
  }

  _loop() {
    if (!this.active) return;
    const video = document.getElementById('wsqr-video');
    const canvas = document.getElementById('wsqr-canvas');
    if (video && canvas && video.readyState === 4) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      if (typeof jsQR !== 'undefined') {
        const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          const now = Date.now();
          if (now - this.lastScan > this.cooldown) {
            const id = WsQR.parseQRData(code.data);
            if (id) { this.lastScan = now; this._success(id); }
          }
        }
      }
    }
    this.animFrame = requestAnimationFrame(() => this._loop());
  }

  _success(parcelId) {
    const flash = document.getElementById('wsqr-flash');
    if (flash) {
      flash.style.background = 'rgba(16,185,129,0.35)';
      setTimeout(() => flash.style.background = 'transparent', 600);
    }
    this._setStatus('✅ تم — ' + parcelId, '#10b981');
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    this.onScan(parcelId);
  }

  _setStatus(msg, color = 'white') {
    const el = document.getElementById('wsqr-status');
    if (el) { el.textContent = msg; el.style.color = color; }
  }
}

// ══════════════════════════════════════════════
//   WsCustody — منطق نقل العهدة بالـ QR
// ══════════════════════════════════════════════
const WsCustody = {
  _scanner: null,

  // فتح ماسح QR وتنفيذ نقل العهدة تلقائياً
  openScanner(containerId, action, onResult) {
    if (this._scanner) this._scanner.stop();
    this._scanner = new WsQRScanner({
      containerId,
      onScan: async (parcelId) => {
        const result = await this.transfer(parcelId, action);
        // جلب بيانات الطرد حسب الـ role
        const parcelData = await this.getParcelData(parcelId);
        onResult(result, parcelId, parcelData);
      },
      onError: (err) => console.warn('Scanner:', err),
    });
    this._scanner.start();
  },

  stopScanner() {
    if (this._scanner) { this._scanner.stop(); this._scanner = null; }
  },

  // نقل العهدة للـ backend
  async transfer(parcelId, action) {
    const statusMap = {
      'pickup':        { status: 'pickup',   note: 'استلام الليفرور من التاجر' },
      'hub_in':        { status: 'hub',      note: 'استقبال الهوب للطرد' },
      'hub_out':       { status: 'transit',  note: 'استلام الترانسبورتور من الهوب' },
      'transport_in':  { status: 'transit',  note: 'طرد في عهدة الترانسبورتور' },
      'transport_out': { status: 'hub',      note: 'تسليم الترانسبورتور للهوب' },
      'delivery':      { status: 'delivery', note: 'الليفرور في طريقه للتسليم' },
    };
    const cfg = statusMap[action];
    if (!cfg) return { success: false, message: 'إجراء غير معروف' };
    try {
      const token = localStorage.getItem('ws_token');
      const res = await fetch(`/api/parcels/${parcelId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ status: cfg.status, note: cfg.note }),
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: 'خطأ في الاتصال' };
    }
  },

  // تأكيد التسليم النهائي مع التوقيع
  async confirmDelivery(parcelId, signatureDataURL) {
    if (!signatureDataURL) return { success: false, message: 'التوقيع مطلوب' };
    try {
      const token = localStorage.getItem('ws_token');
      const res = await fetch(`/api/parcels/${parcelId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          status: 'delivered',
          note: 'تم التسليم للزبون مع التوقيع الرقمي',
          signature: signatureDataURL,
        }),
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: 'خطأ في الاتصال' };
    }
  },

  // جلب بيانات الطرد — الـ backend يقرر شنوا يظهر حسب الـ role
  // ليفرور التسليم النهائي فقط يشوف: اسم + عنوان + هاتف الزبون + هاتف التاجر
  // بقية الأدوار: ID + الحالة فقط
  async getParcelData(parcelId) {
    try {
      const token = localStorage.getItem('ws_token');
      const res  = await fetch(`/api/parcels/${parcelId}`, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      const data = await res.json();
      if (!data.success) return null;
      return data.parcel;
    } catch (e) { return null; }
  },
};

// ══════════════════════════════════════════════
//   WsSignature — لوحة التوقيع الرقمي
// ══════════════════════════════════════════════
const WsSignature = {
  _canvas: null,
  _ctx:    null,
  _drawing:false,
  _signed: false,

  init(canvasId) {
    this._canvas = document.getElementById(canvasId);
    if (!this._canvas) return;
    this._ctx    = this._canvas.getContext('2d');
    this._signed = false;
    this._ctx.strokeStyle = '#0f172a';
    this._ctx.lineWidth   = 2.5;
    this._ctx.lineCap     = 'round';
    this._ctx.lineJoin    = 'round';

    const pos = (e) => {
      const r = this._canvas.getBoundingClientRect();
      const s = e.touches ? e.touches[0] : e;
      return { x: s.clientX - r.left, y: s.clientY - r.top };
    };
    const start = (e) => {
      e.preventDefault();
      this._drawing = true;
      const p = pos(e);
      this._ctx.beginPath();
      this._ctx.moveTo(p.x, p.y);
    };
    const draw = (e) => {
      e.preventDefault();
      if (!this._drawing) return;
      const p = pos(e);
      this._ctx.lineTo(p.x, p.y);
      this._ctx.stroke();
      this._signed = true;
    };
    const stop = () => { this._drawing = false; };

    ['mousedown','touchstart'].forEach(ev => this._canvas.addEventListener(ev, start, {passive:false}));
    ['mousemove','touchmove'].forEach(ev  => this._canvas.addEventListener(ev, draw,  {passive:false}));
    ['mouseup','touchend'].forEach(ev     => this._canvas.addEventListener(ev, stop));
  },

  clear() {
    if (!this._canvas) return;
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._signed = false;
  },

  isSigned()    { return this._signed; },
  getDataURL()  { return this._signed && this._canvas ? this._canvas.toDataURL('image/png') : null; },
};
