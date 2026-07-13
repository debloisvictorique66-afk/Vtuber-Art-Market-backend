// app.js — VTuber Art Market (pixel edition) — Telegram Mini App frontend
'use strict';

// Point this at your deployed backend. Left as localhost for local dev;
// swap for your real API URL when you deploy (e.g. https://api.yourdomain.com).
const API_BASE = window.VTUBER_API_BASE || 'http://localhost:3000';
const MAX_DESCRIPTION_LENGTH = 2000;

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

// The Telegram user (falls back to demo values if opened outside Telegram)
const CURRENT_USER = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username) || 'KiraVT';
const CURRENT_CHAT_ID = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || '';
const CURRENT_ARTIST = 'PixelYume'; // which artist profile this device manages in the Panel tab

// Every request identifies the caller the same way: Telegram's signed
// initData when available (the real, spoof-proof path), plus the plain
// dev-fallback headers for local testing outside Telegram.
function tgHeaders(extra = {}) {
  return {
    'x-init-data': (tg && tg.initData) || '',
    'x-username': CURRENT_USER,
    'x-chat-id': CURRENT_CHAT_ID,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tiny pixel-art renderer — draws 12x12 sprites as crisp inline SVG rects.
// ---------------------------------------------------------------------------
const SPRITE_ROWS = [
  '....OOOO....', '...OHHHHO...', '..OHHHHHHO..', '.OHhHHHHhHO.',
  'OHhHHHHHHhHO', 'OHSSSSSSSSHO', 'OHSEESSEESHO', 'OHSBSSSSBSHO',
  'OHSSSSSSSSHO', '.OHSSSSSSHO.', '..OOHSSHOO..', '...OOOOOO...',
].map((r) => r.padEnd(12, '.').slice(0, 12));

const PALETTES = {
  purple: { O: '#3A1F5C', H: '#8C4FCF', h: '#5C2E99', S: '#FFDFC4', E: '#3A1F5C', B: '#FF9FC0' },
  blue:   { O: '#1F3F5C', H: '#5FB8E8', h: '#2E7FB0', S: '#FFDFC4', E: '#1F3F5C', B: '#FF9FC0' },
  pink:   { O: '#5C1F3F', H: '#FF8FC0', h: '#D9528F', S: '#FFDFC4', E: '#5C1F3F', B: '#FFC94A' },
};

function pixelAvatarSVG(paletteName, size = 64) {
  const palette = PALETTES[paletteName] || PALETTES.purple;
  let rects = '';
  SPRITE_ROWS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch] || '#000'}"/>`;
    });
  });
  return `<svg viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function placeholderThumbSVG(size = 64) {
  const rows = [
    'OOOOOOOOOOOO', 'O..........O', 'O.WW....WW.O', 'O.WW....WW.O',
    'O..........O', 'O....OO....O', 'O...OOOO...O', 'O..........O',
    'OFFFFFFFFFFO', 'OFFFFFFFFFFO', 'OFFFFFFFFFFO', 'OOOOOOOOOOOO',
  ];
  const palette = { O: '#3A1F5C', W: '#FFC94A', F: '#8C4FCF' };
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch] || '#000'}"/>`;
    });
  });
  return `<svg viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function productThumbHTML(product, size) {
  if (product.previewUrl) {
    return `<img src="${API_BASE}${product.previewUrl}" alt="" style="width:100%;height:100%;object-fit:cover;image-rendering:pixelated;" />`;
  }
  return placeholderThumbSVG(size);
}

// ---------------------------------------------------------------------------
// Pixel icon set
// ---------------------------------------------------------------------------
const ICONS = {
  person:  ['...OOOO...', '..O....O..', '..O....O..', '...OOOO...', '..O....O..', '.O......O.', 'O........O', 'OOOOOOOOOO'],
  star:    ['....O.....', '...OOO....', 'OOOOOOOOOO', '.OOOOOOOO.', '..OOOOOO..', '.OO....OO.', 'OO......OO', '..O....O..'],
  bell:    ['...OOOO...', '..O....O..', '..O....O..', '..O....O..', '.OOOOOOOO.', 'OOOOOOOOOO', '....OO....', '....OO....'],
  shield:  ['..OOOOOO..', '.O......O.', 'O........O', 'O..OOOO..O', 'O..OOOO..O', '.O..OO..O.', '..O.OO.O..', '...OOOO...'],
  globe:   ['..OOOOOO..', '.O.OOOO.O.', 'OOOOOOOOOO', 'OOOOOOOOOO', 'OOOOOOOOOO', 'OOOOOOOOOO', '.O.OOOO.O.', '..OOOOOO..'],
  help:    ['..OOOOOO..', '.O......O.', 'O...OO...O', 'O..O..O..O', 'O.....O..O', 'O....O...O', 'O........O', 'O...OO...O'],
  doc:     ['OOOOOOOO..', 'O......O..', 'O......OOO', 'O.........', 'O.OOOOO..O', 'O.........', 'O.OOOOO..O', 'OOOOOOOOOO'],
  plus:    ['....OO....', '....OO....', '....OO....', 'OOOOOOOOOO', 'OOOOOOOOOO', '....OO....', '....OO....', '....OO....'],
  edit:    ['........OO', '.......OO.', '......OO..', '.....OO...', 'OO..OO....', 'OOOOO.....', 'OOOOO.....', 'OOOOO.....'],
  trash:   ['.OOOOOOOO.', 'OOOOOOOOOO', '..O....O..', '..O.OO.O..', '..O.OO.O..', '..O.OO.O..', '..O.OO.O..', '.OOOOOOOO.'],
  box:     ['OOOOOOOOOO', 'O.O....O.O', 'O..O..O..O', 'O...OO...O', 'O..O..O..O', 'O.O....O.O', 'OOOOOOOOOO', '..........'],
  sparkle: ['....O.....', '....O.....', '.O..O..O..', '..O.O.O...', '...OOO....', 'OOOOOOOOOO', '...OOO....', '..O.O.O...'],
  crown:   ['O.O.O.O.O.', 'OOOOOOOOOO', '.OOOOOOOO.', '.O.O..O.O.', '.O.O..O.O.', '.OOOOOOOO.', '.OOOOOOOO.', '..........'],
};

function iconSVG(name, color = 'currentColor', size = 20) {
  const rows = ICONS[name] || ICONS.star;
  const w = rows[0].length, h = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
    });
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

// ---------------------------------------------------------------------------
// API helpers. A 402 response means "subscription required" — instead of
// throwing a normal error, we pop the subscription gate over the whole app.
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: tgHeaders({ 'Content-Type': 'application/json' }),
    ...options,
  });
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    showSubscriptionGate(body.subscription);
    throw new Error('SUBSCRIPTION_REQUIRED');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function apiForm(path, formData, method = 'POST') {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: tgHeaders(),
    body: formData,
  });
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    showSubscriptionGate(body.subscription);
    throw new Error('SUBSCRIPTION_REQUIRED');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// SUBSCRIPTION GATE — a full-screen, non-dismissable overlay shown whenever
// the current user has neither an active monthly subscription nor a
// sponsor/whitelist pass. Paying re-checks status and unlocks the app.
// ---------------------------------------------------------------------------
let gateOpen = false;

function showSubscriptionGate(status) {
  if (gateOpen) return;
  gateOpen = true;
  const gate = document.getElementById('subscriptionGate');
  const priceLine = document.getElementById('gatePriceLine');
  if (status?.priceStars) priceLine.innerHTML = `${iconSVG('star', '#FFC94A', 18)} ${status.priceStars} STARS / MONTH`;
  gate.classList.add('open');
}

function hideSubscriptionGate() {
  gateOpen = false;
  document.getElementById('subscriptionGate').classList.remove('open');
}

async function checkAppAccess() {
  try {
    const res = await fetch(`${API_BASE}/api/subscription/status`, {
      headers: tgHeaders(),
    });
    const status = await res.json();
    if (status.active) hideSubscriptionGate();
    else showSubscriptionGate(status);
    return status;
  } catch (e) {
    // If the backend isn't reachable at all, don't hard-block the UI on
    // top of an already-broken connection — the page loaders will show
    // their own "could not load" messages.
    return { active: true };
  }
}

async function paySubscription() {
  if (!tg || !tg.openInvoice) {
    showToast('OPEN THIS APP INSIDE TELEGRAM TO SUBSCRIBE WITH STARS');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/subscription/invoice-link`, {
      method: 'POST',
      headers: tgHeaders(),
    });
    const { link, error } = await res.json();
    if (error) { showToast(error.toUpperCase()); return; }
    tg.openInvoice(link, async (status) => {
      if (status === 'paid') {
        showToast('SUBSCRIBED! WELCOME TO VTUBER ART MARKET 🎉');
        hideSubscriptionGate();
        switchPage('market');
        loadAccount();
      } else if (status === 'failed') {
        showToast('PAYMENT FAILED');
      } else if (status === 'cancelled') {
        showToast('SUBSCRIPTION CANCELLED');
      }
    });
  } catch (e) {
    showToast(e.message.toUpperCase());
  }
}

// ---------------------------------------------------------------------------
// Navigation between the three pages
// ---------------------------------------------------------------------------
function switchPage(name) {
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'market') loadMarket();
  if (name === 'panel') loadPanel();
  if (name === 'account') loadAccount();
}

// ---------------------------------------------------------------------------
// 1. MARKETPLACE
// ---------------------------------------------------------------------------
let marketState = { category: 'ALL', search: '' };

function renderProductCard(p) {
  return `
    <div class="product-card pixel-panel" data-id="${p.id}">
      <div class="product-thumb">
        ${p.badge ? `<span class="badge-new">${p.badge}</span>` : ''}
        ${productThumbHTML(p, 64)}
      </div>
      <div class="product-title">${escapeHTML(p.title)}</div>
    </div>`;
}

async function loadMarket() {
  const grid = document.getElementById('marketGrid');
  grid.innerHTML = `<div class="empty-state">LOADING...</div>`;
  try {
    const qs = new URLSearchParams();
    if (marketState.category !== 'ALL') qs.set('category', marketState.category);
    if (marketState.search) qs.set('search', marketState.search);
    const productList = await api(`/api/products?${qs}`);
    grid.innerHTML = productList.length
      ? productList.map(renderProductCard).join('')
      : `<div class="empty-state" style="grid-column:1/-1;">NO ITEMS FOUND</div>`;
    grid.querySelectorAll('.product-card').forEach((card) => {
      card.addEventListener('click', () => openProductDetail(card.dataset.id));
    });
  } catch (e) {
    if (e.message !== 'SUBSCRIPTION_REQUIRED') {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">COULD NOT LOAD MARKET<br>${e.message}</div>`;
    }
  }
}

function initMarketControls() {
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      marketState.category = chip.dataset.category;
      loadMarket();
    });
  });
  const searchInput = document.getElementById('marketSearch');
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { marketState.search = searchInput.value.trim(); loadMarket(); }, 300);
  });
}

let activeDetailProduct = null;

async function openProductDetail(productId) {
  try {
    const product = await api(`/api/products/${productId}`);
    activeDetailProduct = product;
    document.getElementById('detailPreview').innerHTML = productThumbHTML(product, 220);
    document.getElementById('detailTitle').textContent = product.title;
    document.getElementById('detailArtist').textContent = `by ${product.artist}`;
    document.getElementById('detailDescription').textContent = product.description || 'No description yet.';
    document.getElementById('detailPrice').innerHTML = `${iconSVG('star', '#FFC94A', 18)} ${product.price} STARS`;
    document.getElementById('productDetailModal').classList.add('open');
  } catch (e) {
    if (e.message !== 'SUBSCRIPTION_REQUIRED') showToast(e.message);
  }
}

async function buyActiveProduct() {
  if (!activeDetailProduct) return;
  const product = activeDetailProduct;

  if (tg && tg.openInvoice) {
    try {
      const { link } = await api(`/api/products/${product.id}/invoice-link`, { method: 'POST' });
      tg.openInvoice(link, (status) => {
        if (status === 'paid') {
          showToast('PAYMENT SUCCESSFUL! FILE SENT TO YOUR CHAT 🎉');
          document.getElementById('productDetailModal').classList.remove('open');
        } else if (status === 'failed') {
          showToast('PAYMENT FAILED');
        } else if (status === 'cancelled') {
          showToast('PAYMENT CANCELLED');
        }
      });
    } catch (e) {
      if (e.message !== 'SUBSCRIPTION_REQUIRED') showToast(e.message.toUpperCase());
    }
    return;
  }

  try {
    await api(`/api/account/${CURRENT_USER}/purchase`, { method: 'POST', body: JSON.stringify({ productId: product.id }) });
    showToast('PURCHASE COMPLETE (DEV MODE)');
    document.getElementById('productDetailModal').classList.remove('open');
    loadAccount();
  } catch (e) {
    if (e.message !== 'SUBSCRIPTION_REQUIRED') showToast(e.message.toUpperCase());
  }
}

// ---------------------------------------------------------------------------
// 2. ARTIST PANEL
// ---------------------------------------------------------------------------
function renderMyProductRow(p) {
  return `
    <div class="product-row" data-id="${p.id}">
      <div class="product-row-thumb">${productThumbHTML(p, 40)}</div>
      <div class="product-row-info">
        <div class="product-title">${escapeHTML(p.title)}</div>
        <div class="price-row">${iconSVG('star', '#FFC94A', 14)} ${p.price} STARS ${p.hasFile ? '' : '· NO FILE'}</div>
      </div>
      <div class="product-row-actions">
        <button class="pixel-btn pixel-btn--sm edit-btn">${iconSVG('edit', '#3A1F5C', 14)}</button>
        <button class="pixel-btn pixel-btn--sm pixel-btn--danger delete-btn">${iconSVG('trash', '#fff', 14)}</button>
      </div>
    </div>`;
}

async function loadPanel() {
  const wrap = document.getElementById('panelContent');
  wrap.innerHTML = `<div class="empty-state">LOADING...</div>`;
  try {
    const data = await api(`/api/artist/${CURRENT_ARTIST}`);
    wrap.innerHTML = `
      <div class="profile-card pixel-panel">
        <div class="avatar-box">${pixelAvatarSVG(data.avatar, 74)}</div>
        <div>
          <div class="profile-name-row">
            <span class="profile-name">${data.username}</span>
            <span class="role-badge">${data.role}</span>
          </div>
          <div class="profile-sub">${data.tagline}</div>
          <div class="profile-motto">${iconSVG('sparkle', '#B9861A', 12)} ${data.motto}</div>
        </div>
      </div>

      <div class="stats-row pixel-panel">
        <div class="stat-cell"><div class="stat-num">${data.productsCount}</div><div class="stat-label">PRODUCTS</div></div>
        <div class="stat-cell"><div class="stat-num">${data.sales}</div><div class="stat-label">SALES</div></div>
        <div class="stat-cell"><div class="stat-num">${iconSVG('star', '#FFC94A', 12)} ${data.earnedStars}</div><div class="stat-label">EARNED</div></div>
      </div>

      <div class="action-row">
        <button class="pixel-btn pixel-btn--pink" id="addProductBtn">${iconSVG('plus', '#fff', 14)} ADD PRODUCT</button>
        <button class="pixel-btn pixel-btn--purple" id="viewOrdersBtn">${iconSVG('box', '#fff', 14)} ORDERS</button>
      </div>

      <div class="section-label">MY PRODUCTS <a href="#" id="viewAllBtn">VIEW ALL &gt;</a></div>
      <div class="pixel-panel" style="padding: 4px 12px;" id="myProductsList">
        ${data.products.length ? data.products.map(renderMyProductRow).join('') : '<div class="empty-state">NO PRODUCTS YET</div>'}
      </div>
    `;

    document.getElementById('addProductBtn').addEventListener('click', () => openAddProductModal());
    document.getElementById('viewOrdersBtn').addEventListener('click', openOrdersModal);
    document.getElementById('viewAllBtn').addEventListener('click', (e) => { e.preventDefault(); switchPage('market'); });

    wrap.querySelectorAll('.product-row').forEach((row) => {
      const id = row.dataset.id;
      const product = data.products.find((p) => p.id === id);
      row.querySelector('.edit-btn').addEventListener('click', () => openAddProductModal(product));
      row.querySelector('.delete-btn').addEventListener('click', () => deleteProduct(id));
    });
  } catch (e) {
    if (e.message !== 'SUBSCRIPTION_REQUIRED') {
      wrap.innerHTML = `<div class="empty-state">COULD NOT LOAD PANEL<br>${e.message}</div>`;
    }
  }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try {
    await api(`/api/products/${id}`, { method: 'DELETE' });
    showToast('PRODUCT DELETED');
    loadPanel();
  } catch (e) {
    if (e.message !== 'SUBSCRIPTION_REQUIRED') showToast(e.message.toUpperCase());
  }
}

function openAddProductModal(existing) {
  const modal = document.getElementById('productModal');
  document.getElementById('productModalTitle').textContent = existing ? 'EDIT PRODUCT' : 'ADD PRODUCT';
  document.getElementById('productTitleInput').value = existing?.title || '';
  document.getElementById('productPriceInput').value = existing?.price || '';
  document.getElementById('productCategoryInput').value = existing?.category || 'ILLUST';
  document.getElementById('productDescriptionInput').value = existing?.description || '';
  document.getElementById('previewFileInput').value = '';
  document.getElementById('assetFileInput').value = '';
  updateDescCounter();
  modal.classList.add('open');

  document.getElementById('saveProductBtn').onclick = async () => {
    const title = document.getElementById('productTitleInput').value.trim();
    const price = Number(document.getElementById('productPriceInput').value);
    const category = document.getElementById('productCategoryInput').value;
    const description = document.getElementById('productDescriptionInput').value;
    if (!title || !price) { showToast('FILL IN ALL FIELDS'); return; }
    if (description.length > MAX_DESCRIPTION_LENGTH) { showToast('DESCRIPTION TOO LONG'); return; }

    const form = new FormData();
    form.append('title', title);
    form.append('price', price);
    form.append('category', category);
    form.append('description', description);
    const previewFile = document.getElementById('previewFileInput').files[0];
    const assetFile = document.getElementById('as
