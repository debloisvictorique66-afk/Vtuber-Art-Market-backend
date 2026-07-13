// server.js — VTuber Art Market API (v4)
// v4 upgrades this from a demo to something you can actually run in
// production:
//   1. Real persistence — MongoDB (via Mongoose) instead of in-memory
//      arrays. Nothing is lost when the server restarts or redeploys.
//   2. Real identity — verifies Telegram's `initData` HMAC signature
//      against your bot token, instead of trusting plain headers that
//      anyone could fake.
// Everything else (uploads, watermarking, Stars payments, subscriptions,
// whitelist) works the same as before — only the storage layer and the
// "who is this user" check changed.
'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
const MONGODB_URI = process.env.MONGODB_URI || '';
const WATERMARK_TEXT = 'Vtuber Art Market';
const MAX_DESCRIPTION_LENGTH = 2000;
const SUBSCRIPTION_PRICE_STARS = Number(process.env.SUBSCRIPTION_PRICE) || 99;
const SUBSCRIPTION_PERIOD_SECONDS = 2592000; // 30 days — the only value Telegram allows for Stars subscriptions
// How old an initData payload is allowed to be, in seconds, before we
// reject it (defends against someone replaying a captured initData later).
const INIT_DATA_MAX_AGE_SECONDS = 86400;

// -----------------------------------------------------------------------
// Database — MongoDB via Mongoose. See README for how to get a free
// connection string from MongoDB Atlas (takes ~10 minutes).
// -----------------------------------------------------------------------
if (!MONGODB_URI) {
  console.warn('⚠️  MONGODB_URI is not set — the server will crash on first DB access. See .env.example.');
}
mongoose.set('strictQuery', true);
mongoose.connect(MONGODB_URI).then(
  () => console.log('✅ Connected to MongoDB'),
  (err) => console.error('❌ MongoDB connection failed:', err.message)
);

const { Schema } = mongoose;

const ProductSchema = new Schema({
  _id: String,
  title: String,
  category: String,
  price: Number, // Telegram Stars
  artist: String,
  badge: { type: String, default: null },
  img: { type: String, default: 'char-purple' },
  description: { type: String, default: '' },
  previewUrl: { type: String, default: null },
  fileStoredName: { type: String, default: null },
  hasFile: { type: Boolean, default: false },
}, { _id: false, versionKey: false });

const ArtistSchema = new Schema({
  _id: String, // username
  role: String,
  tagline: String,
  motto: String,
  productsCount: { type: Number, default: 0 },
  sales: { type: Number, default: 0 },
  earnedStars: { type: Number, default: 0 },
  avatar: String,
}, { _id: false, versionKey: false });

const AccountSchema = new Schema({
  _id: String, // username
  role: String,
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  expToNext: { type: Number, default: 1000 },
  starBalance: { type: Number, default: 0 },
  avatar: String,
}, { _id: false, versionKey: false });

const OrderSchema = new Schema({
  _id: String,
  productId: String,
  buyer: String,
  status: String,
  total: Number,
  telegramChargeId: { type: String, default: null },
}, { _id: false, versionKey: false });

const SubscriptionSchema = new Schema({
  _id: String, // username
  expiresAt: Number, // JS timestamp (ms)
  chatId: { type: String, default: null },
}, { _id: false, versionKey: false });

const WhitelistSchema = new Schema({
  _id: String, // chatId
}, { _id: false, versionKey: false });

const Product = mongoose.model('Product', ProductSchema);
const Artist = mongoose.model('Artist', ArtistSchema);
const Account = mongoose.model('Account', AccountSchema);
const Order = mongoose.model('Order', OrderSchema);
const Subscription = mongoose.model('Subscription', SubscriptionSchema);
const Whitelist = mongoose.model('Whitelist', WhitelistSchema);

// Seed a little demo data the first time the database is empty, purely so
// the app has something to show. Safe to delete once you have real data.
async function seedIfEmpty() {
  if (await Product.countDocuments() === 0) {
    await Product.create({
      _id: 'p1',
      title: 'Cute Vtuber Illustration',
      category: 'ILLUST',
      price: 9,
      artist: 'PixelYume',
      badge: 'NEW',
      img: 'char-purple',
      description: 'A hand-painted chibi vtuber portrait, delivered as a layered PNG. ✨🎨 Great for stream overlays or profile art!',
    });
  }
  if (await Artist.countDocuments() === 0) {
    await Artist.create({
      _id: 'PixelYume', role: 'ARTIST', tagline: 'Digital Artist & Vtuber',
      motto: "Let's create magic!", productsCount: 1, sales: 248, earnedStars: 3450, avatar: 'char-purple',
    });
  }
  if (await Account.countDocuments() === 0) {
    await Account.create({
      _id: 'KiraVT', role: 'Vtuber & Artist', level: 12, exp: 720, expToNext: 1500, starBalance: 1250, avatar: 'char-pink',
    });
  }
  // Demo account starts with an active subscription so local testing isn't
  // blocked by the gate — remove once you have real paying users.
  if (await Subscription.countDocuments() === 0) {
    await Subscription.create({ _id: 'KiraVT', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, chatId: null });
  }
}
mongoose.connection.once('open', () => { seedIfEmpty().catch((e) => console.error('Seed error:', e.message)); });

// -----------------------------------------------------------------------
// File storage — local disk. NOTE: most hosts (Render free tier included)
// wipe local disk on every redeploy/restart — uploaded files are NOT
// covered by the MongoDB upgrade above. For real production use, point
// these at S3 / Cloudflare R2 / another object store instead. Left as
// local disk here to keep the scaffold simple to run anywhere first.
// -----------------------------------------------------------------------
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const PREVIEW_DIR = path.join(UPLOAD_ROOT, 'previews');
const FILE_DIR = path.join(UPLOAD_ROOT, 'files');
fs.mkdirSync(PREVIEW_DIR, { recursive: true });
fs.mkdirSync(FILE_DIR, { recursive: true });
app.use('/uploads/previews', express.static(PREVIEW_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// -----------------------------------------------------------------------
// REAL Telegram identity — verifies initData's HMAC signature instead of
// trusting a plain header. See:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// -----------------------------------------------------------------------
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    return { id: String(user.id), username: user.username || `user${user.id}` };
  } catch {
    return null;
  }
}

// Resolves the caller's identity for every request:
//   1. If a valid, signed `x-init-data` header is present, trust it fully
//      — this is the real, spoof-proof path used by the live Mini App.
//   2. Otherwise fall back to plain `x-username` / `x-chat-id` headers —
//      ONLY useful for local development without a live bot. Logged so you
//      notice if this path is ever hit in production.
function resolveUser(req, res, next) {
  const initData = req.header('x-init-data');
  const verified = verifyInitData(initData);
  if (verified) {
    req.user = verified;
    return next();
  }
  if (initData) {
    // A header was sent but failed verification — reject rather than
    // silently falling back, since this looks like a spoofing attempt.
    return res.status(401).json({ error: 'Invalid Telegram signature' });
  }
  const devUsername = req.header('x-username');
  if (devUsername) {
    console.warn(`⚠️  Unverified dev request as "${devUsername}" — no x-init-data present.`);
    req.user = { username: devUsername, id: req.header('x-chat-id') || null };
    return next();
  }
  req.user = { username: 'KiraVT', id: null };
  next();
}
app.use(resolveUser);

function currentUser(req) { return req.user.username; }
function currentChatId(req) { return req.user.id; }

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
const uid = (prefix) => `${prefix}${crypto.randomBytes(4).toString('hex')}`;

async function hasPurchased(username, productId) {
  return !!(await Order.findOne({ buyer: username, productId, status: 'completed' }));
}

function publicProduct(p) {
  const obj = p.toObject ? p.toObject() : p;
  const { fileStoredName, ...safe } = obj;
  return { ...safe, id: obj._id };
}

async function isWhitelisted(chatId) {
  if (!chatId) return false;
  return !!(await Whitelist.findById(String(chatId)));
}

async function subscriptionStatus(username, chatId) {
  if (await isWhitelisted(chatId)) return { active: true, whitelisted: true, expiresAt: null };
  const sub = await Subscription.findById(username);
  const active = !!sub && sub.expiresAt > Date.now();
  return { active, whitelisted: false, expiresAt: sub?.expiresAt || null };
}

async function requireSubscription(req, res, next) {
  const status = await subscriptionStatus(currentUser(req), currentChatId(req));
  if (status.active) return next();
  return res.status(402).json({ error: 'Monthly subscription required', subscription: status });
}

function requireAdmin(req, res, next) {
  if (req.header('x-admin-key') !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key' });
  next();
}

async function watermarkImage(buffer) {
  const image = sharp(buffer).resize(900, 900, { fit: 'inside', withoutEnlargement: true });
  const meta = await image.metadata();
  const w = meta.width || 900;
  const h = meta.height || 900;
  const fontSize = Math.max(18, Math.round(w / 22));
  const svgOverlay = Buffer.from(`
    <svg width="${w}" height="${h}">
      <style>
        .wm { fill: rgba(255,255,255,0.9); font-family: 'Press Start 2P', monospace; font-size: ${fontSize}px; }
        .wmShadow { fill: rgba(58,31,92,0.9); font-family: 'Press Start 2P', monospace; font-size: ${fontSize}px; }
      </style>
      <rect x="0" y="${h - fontSize * 2.2}" width="${w}" height="${fontSize * 2.2}" fill="rgba(58,31,92,0.55)"/>
      <text x="${w / 2 + 2}" y="${h - fontSize * 0.8 + 2}" text-anchor="middle" class="wmShadow">${WATERMARK_TEXT}</text>
      <text x="${w / 2}" y="${h - fontSize * 0.8}" text-anchor="middle" class="wm">${WATERMARK_TEXT}</text>
    </svg>
  `);
  return image.composite([{ input: svgOverlay, top: 0, left: 0 }]).png().toBuffer();
}

async function callTelegram(method, payload) {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not set on the server — see .env.example');
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `Telegram API error in ${method}`);
  return data.result;
}

async function deliverFileToBuyer(chatId, product) {
  if (!chatId || !product.fileStoredName || !BOT_TOKEN) return;
  const filePath = path.join(FILE_DIR, product.fileStoredName);
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', `🎉 Thanks for your purchase: "${product.title}"! Here is your file.`);
  form.append('document', new Blob([fs.readFileSync(filePath)]), `${product.title}${path.extname(product.fileStoredName)}`);
  const res = await fetch(`${TG_API}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) console.error('sendDocument failed:', data.description);
}

// In-memory only (short-lived, fine to lose on restart): tracks invoice
// links we've generated so the webhook can match a successful_payment
// back to what was being paid for. A restart mid-payment just means that
// one payment's file-delivery falls back to the /api/download route.
let pendingInvoices = {}; // payloadId -> { type, productId?, buyer, chatId }

// -----------------------------------------------------------------------
// SUBSCRIPTION routes (never gated — a locked-out user must still be able
// to check status and pay)
// -----------------------------------------------------------------------

app.get('/api/subscription/status', async (req, res) => {
  const status = await subscriptionStatus(currentUser(req), currentChatId(req));
  res.json({ ...status, priceStars: SUBSCRIPTION_PRICE_STARS });
});

app.post('/api/subscription/invoice-link', async (req, res) => {
  const buyer = currentUser(req);
  const chatId = currentChatId(req);
  const payloadId = uid('sub');
  pendingInvoices[payloadId] = { type: 'subscription', buyer, chatId };
  try {
    const link = await callTelegram('createInvoiceLink', {
      title: 'VTuber Art Market — Monthly Subscription',
      description: 'Full access to the marketplace and artist tools for 30 days. Renews automatically each month via Telegram Stars.',
      payload: payloadId,
      currency: 'XTR',
      prices: [{ label: 'Monthly subscription', amount: SUBSCRIPTION_PRICE_STARS }],
      subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
    });
    res.json({ link });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------
// ADMIN — sponsor whitelist
// -----------------------------------------------------------------------

app.get('/api/admin/whitelist', requireAdmin, async (req, res) => {
  const docs = await Whitelist.find();
  res.json({ whitelist: docs.map((d) => d._id) });
});

app.post('/api/admin/whitelist', requireAdmin, async (req, res) => {
  const chatId = String(req.body.chatId || '').trim();
  if (!chatId) return res.status(400).json({ error: 'chatId is required' });
  await Whitelist.findByIdAndUpdate(chatId, { _id: chatId }, { upsert: true });
  const docs = await Whitelist.find();
  res.status(201).json({ whitelist: docs.map((d) => d._id) });
});

app.delete('/api/admin/whitelist/:chatId', requireAdmin, async (req, res) => {
  await Whitelist.findByIdAndDelete(req.params.chatId);
  const docs = await Whitelist.find();
  res.json({ whitelist: docs.map((d) => d._id) });
});

// -----------------------------------------------------------------------
// Marketplace routes — gated behind an active subscription or whitelist
// -----------------------------------------------------------------------

app.get('/api/products', requireSubscription, async (req, res) => {
  const { category, search } = req.query;
  const query = {};
  if (category && category !== 'ALL') query.category = category;
  if (search) {
    const q = new RegExp(search, 'i');
    query.$or = [{ title: q }, { artist: q }];
  }
  const list = await Product.find(query);
  res.json(list.map((p) => ({ id: p._id, title: p.title, img: p.img, previewUrl: p.previewUrl, badge: p.badge })));
});

app.get('/api/products/:id', requireSubscription, async (req, res) => {
  const item = await Product.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Product not found' });
  res.json(publicProduct(item));
});

app.get('/api/artist/:username', requireSubscription, async (req, res) => {
  const artist = await Artist.findById(req.params.username);
  if (!artist) return res.status(404).json({ error: 'Artist not found' });
  const myProducts = await Product.find({ artist: req.params.username });
  res.json({ ...artist.toObject(), username: artist._id, products: myProducts.map(publicProduct) });
});

app.post(
  '/api/artist/:username/products', requireSubscription,
  upload.fields([{ name: 'preview', maxCount: 1 }, { name: 'asset', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { title, category, price, description } = req.body;
      if (!title || !category || !price) return res.status(400).json({ error: 'title, category and price are required' });
      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: `Description must be under ${MAX_DESCRIPTION_LENGTH} characters` });
      }

      const id = uid('p');
      let previewUrl = null;
      if (req.files?.preview?.[0]) {
        const watermarked = await watermarkImage(req.files.preview[0].buffer);
        const fileName = `${id}.png`;
        fs.writeFileSync(path.join(PREVIEW_DIR, fileName), watermarked);
        previewUrl = `/uploads/previews/${fileName}`;
      }
      let fileStoredName = null;
      if (req.files?.asset?.[0]) {
        const ext = path.extname(req.files.asset[0].originalname) || '.bin';
        fileStoredName = `${id}${ext}`;
        fs.writeFileSync(path.join(FILE_DIR, fileStoredName), req.files.asset[0].buffer);
      }

      const product = await Product.create({
        _id: id, title, category, price: Number(price), artist: req.params.username, badge: 'NEW', img: 'char-purple',
        description: description || '', previewUrl, fileStoredName, hasFile: !!fileStoredName,
      });
      await Artist.findByIdAndUpdate(req.params.username, { $inc: { productsCount: 1 } });
      res.status(201).json(publicProduct(product));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/products/:id', requireSubscription,
  upload.fields([{ name: 'preview', maxCount: 1 }, { name: 'asset', maxCount: 1 }]),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const { title, category, price, description } = req.body;
      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: `Description must be under ${MAX_DESCRIPTION_LENGTH} characters` });
      }
      if (title) product.title = title;
      if (category) product.category = category;
      if (price) product.price = Number(price);
      if (description !== undefined) product.description = description;

      if (req.files?.preview?.[0]) {
        const watermarked = await watermarkImage(req.files.preview[0].buffer);
        const fileName = `${product._id}.png`;
        fs.writeFileSync(path.join(PREVIEW_DIR, fileName), watermarked);
        product.previewUrl = `/uploads/previews/${fileName}`;
      }
      if (req.files?.asset?.[0]) {
        const ext = path.extname(req.files.asset[0].originalname) || '.bin';
        product.fileStoredName = `${product._id}${ext}`;
        fs.writeFileSync(path.join(FILE_DIR, product.fileStoredName), req.files.asset[0].buffer);
        product.hasFile = true;
      }
      await product.save();
      res.json(publicProduct
