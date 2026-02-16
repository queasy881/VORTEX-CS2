/* ================================================================
   QUIST.WORLD — app.js
   Interactive starfield, scroll reveal, dynamic pricing, promo codes
   ================================================================ */

// ── CONFIG ──
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '' // same origin in dev
  : 'https://quist.world'; // production

// ================================================================
//  STARFIELD — particles that connect with lines near the cursor
// ================================================================
(function() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, stars = [], mouse = { x: -1000, y: -1000 };
  const STAR_COUNT = 120;
  const CONNECT_DIST = 140;
  const MOUSE_DIST = 200;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Star {
    constructor() {
      this.x = Math.random() * w;
      this.y = Math.random() * h;
      this.vx = (Math.random() - 0.5) * 0.25;
      this.vy = (Math.random() - 0.5) * 0.25;
      this.r = Math.random() * 1.2 + 0.4;
      this.baseAlpha = Math.random() * 0.4 + 0.15;
      this.twinkleSpeed = Math.random() * 0.02 + 0.005;
      this.twinkleOffset = Math.random() * Math.PI * 2;
    }
    update(t) {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < -10) this.x = w + 10;
      if (this.x > w + 10) this.x = -10;
      if (this.y < -10) this.y = h + 10;
      if (this.y > h + 10) this.y = -10;

      // Mouse repulsion (gentle)
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const md = Math.sqrt(dx*dx + dy*dy);
      if (md < 80) {
        this.x += dx * 0.008;
        this.y += dy * 0.008;
      }
    }
  }

  for (let i = 0; i < STAR_COUNT; i++) stars.push(new Star());

  document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener('mouseleave', () => { mouse.x = -1000; mouse.y = -1000; });

  let t = 0;
  function draw() {
    t++;
    ctx.clearRect(0, 0, w, h);

    // Update & draw stars
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.update(t);
      const twinkle = Math.sin(t * s.twinkleSpeed + s.twinkleOffset) * 0.3 + 0.7;
      const alpha = s.baseAlpha * twinkle;

      // Brighter near mouse
      const mdx = s.x - mouse.x;
      const mdy = s.y - mouse.y;
      const md = Math.sqrt(mdx*mdx + mdy*mdy);
      const mouseBright = md < MOUSE_DIST ? (1 - md / MOUSE_DIST) * 0.6 : 0;

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 + mouseBright * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 200, 220, ${Math.min(alpha + mouseBright, 0.9)})`;
      ctx.fill();

      // Connect to nearby stars
      for (let j = i + 1; j < stars.length; j++) {
        const dx = s.x - stars[j].x;
        const dy = s.y - stars[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > CONNECT_DIST) continue;

        // Only draw lines near mouse (interactive effect)
        const cx = (s.x + stars[j].x) / 2;
        const cy = (s.y + stars[j].y) / 2;
        const cm = Math.sqrt((cx-mouse.x)**2 + (cy-mouse.y)**2);
        if (cm > MOUSE_DIST * 1.5) continue;

        const lineAlpha = (1 - dist / CONNECT_DIST) * (1 - cm / (MOUSE_DIST * 1.5)) * 0.35;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(stars[j].x, stars[j].y);
        ctx.strokeStyle = `rgba(232, 35, 58, ${lineAlpha})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    requestAnimationFrame(draw);
  }
  draw();
})();

// ================================================================
//  NAV SCROLL
// ================================================================
window.addEventListener('scroll', () => {
  const nav = document.querySelector('nav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
});

// Mobile hamburger
function toggleNav() {
  const links = document.getElementById('navLinks');
  if (links) links.classList.toggle('open');
}

// ================================================================
//  SCROLL REVEAL
// ================================================================
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObs.unobserve(e.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
  // Stagger grids
  document.querySelectorAll('.features-grid .reveal, .pricing-grid .reveal').forEach((el, i) => {
    el.style.transitionDelay = `${i * 0.07}s`;
  });
});

// ================================================================
//  DYNAMIC PRICING
// ================================================================
let pricingTiers = [];
let activePromo = null;

function currencySymbol(cur) {
  if (cur === 'EUR') return '\u20AC';
  if (cur === 'GBP') return '\u00A3';
  return '$';
}

function fmtPrice(cents, cur) {
  return currencySymbol(cur) + (cents / 100).toFixed(2);
}

function durationLabel(days) {
  if (days === 1) return '1 day';
  if (days <= 6) return days + ' days';
  if (days === 7) return '1 week';
  if (days < 30) return days + ' days';
  if (days === 30 || days === 31) return '1 month';
  if (days < 365) return Math.round(days / 30) + ' months';
  if (days === 365 || days === 366) return '1 year';
  return Math.round(days / 365) + ' years';
}

function durationShort(days) {
  if (days === 1) return 'day';
  if (days === 7) return 'week';
  if (days === 30 || days === 31) return 'month';
  if (days === 365 || days === 366) return 'year';
  return days + 'd';
}

// Decide which card gets "best" badge (longest duration or middle)
function bestTierIndex(tiers) {
  if (tiers.length <= 2) return -1;
  // Cheapest per-day
  let bestIdx = 0, bestPPD = Infinity;
  tiers.forEach((t, i) => {
    const ppd = t.price_cents / t.duration_days;
    if (ppd < bestPPD) { bestPPD = ppd; bestIdx = i; }
  });
  return bestIdx;
}

async function loadPricing() {
  const grid = document.getElementById('pricingGrid');
  if (!grid) return;

  grid.innerHTML = '<div class="pricing-loading">Loading prices...</div>';

  try {
    const r = await fetch(API_BASE + '/api/pricing');
    if (!r.ok) throw new Error('API error');
    pricingTiers = await r.json();
  } catch(e) {
    // Fallback — show message
    grid.innerHTML = '<div class="pricing-loading">Pricing unavailable — check back soon</div>';
    return;
  }

  if (!pricingTiers.length) {
    grid.innerHTML = '<div class="pricing-loading">No pricing available yet</div>';
    return;
  }

  renderPricing();
}

function renderPricing() {
  const grid = document.getElementById('pricingGrid');
  if (!grid) return;

  const bestI = bestTierIndex(pricingTiers);
  const features = ['All features unlocked', 'Full ESP + Aimbot', 'Direct2D menu', 'Config system', 'Instant delivery'];

  grid.innerHTML = pricingTiers.map((t, i) => {
    const isBest = i === bestI;
    const originalCents = t.price_cents;
    const discountedCents = activePromo
      ? Math.round(t.price_cents * (1 - activePromo.discount_percent / 100))
      : t.price_cents;
    const showDiscount = activePromo && discountedCents !== originalCents;

    return `<div class="price-card ${isBest ? 'best' : ''} reveal visible">
      <div class="price-name">${esc(t.name)}</div>
      <div class="price-original" style="${showDiscount ? 'display:block' : ''}">${fmtPrice(originalCents, t.currency)}</div>
      <div class="price-amount"><span class="cur">${currencySymbol(t.currency)}</span>${(discountedCents / 100).toFixed(2).replace(/^(\d+)\./, '$1.')}</div>
      <div class="price-dur">/ ${durationShort(t.duration_days)}</div>
      <ul class="price-features">
        ${features.map(f => `<li>${f}</li>`).join('')}
      </ul>
      <button class="price-btn ${isBest ? 'price-btn-fill' : 'price-btn-ghost'}" onclick="selectPlan(${t.id})">
        Select
      </button>
    </div>`;
  }).join('');
}

function selectPlan(tierId) {
  // For now, just alert — you'd integrate Sellix/Stripe here
  const tier = pricingTiers.find(t => t.id === tierId);
  if (!tier) return;
  const price = activePromo
    ? Math.round(tier.price_cents * (1 - activePromo.discount_percent / 100))
    : tier.price_cents;
  const msg = `${tier.name} — ${fmtPrice(price, tier.currency)} for ${durationLabel(tier.duration_days)}${activePromo ? ` (${activePromo.discount_percent}% off with ${activePromo.code})` : ''}`;
  alert('Selected: ' + msg + '\n\nPayment integration coming soon.');
}

// ================================================================
//  PROMO CODES
// ================================================================
async function applyPromo() {
  const input = document.getElementById('promoInput');
  const msg = document.getElementById('promoMsg');
  if (!input || !msg) return;

  const code = input.value.trim().toUpperCase();
  if (!code) { msg.textContent = ''; msg.className = 'promo-msg'; return; }

  msg.textContent = 'Checking...';
  msg.className = 'promo-msg';

  try {
    const r = await fetch(API_BASE + '/api/promo/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await r.json();
    if (data.valid) {
      activePromo = { code: data.code, discount_percent: data.discount_percent };
      msg.textContent = `\u2713 ${data.code} — ${data.discount_percent}% off applied!`;
      msg.className = 'promo-msg ok';
      renderPricing(); // re-render with discount
    } else {
      activePromo = null;
      msg.textContent = data.error || 'Invalid code';
      msg.className = 'promo-msg err';
      renderPricing();
    }
  } catch(e) {
    msg.textContent = 'Could not verify code';
    msg.className = 'promo-msg err';
  }
}

// ================================================================
//  UTIL
// ================================================================
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Auto-load pricing on pages that have the grid
document.addEventListener('DOMContentLoaded', loadPricing);
