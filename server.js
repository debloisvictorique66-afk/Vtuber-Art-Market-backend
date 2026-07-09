/**
 * VTuber Art Market — Backend Server
 * (Telegram-only Authentication & Whitelist System)
 */

const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const app = express();
app.use(express.json());

// CORS Configuration
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Supabase Initialization
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const BOT_TOKEN = process.env.BOT_TOKEN; 
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// =======================================================================
// CONFIGURATION (YOU CAN EDIT THIS ANYTIME VIA GITHUB)
// =======================================================================

// 1. Subscription price (Monthly Telegram Stars amount)
const ARTIST_SUBSCRIPTION_PRICE_STARS = 1500; 

// 2. PROMO WHITELIST FOR INFLUENCER/PARTNER ARTISTS (Max 500 IDs)
// Just add the Telegram User IDs as strings separated by commas
const PROMO_WHITELIST = [
  "123456789",  // Demo artist 1
  "987654321",  // Demo artist 2
  "555444333"   // Demo artist 3
];

// =======================================================================

/**
 * AUTOMATIC LOGIN & REGISTRATION (Telegram-only)
 */
app.post("/api/account/auth", requireAuth, async (req, res) => {
  const telegramId = req.user.telegramId;
  const username = req.user.username || "Unknown";

  try {
    let account = await getAccountByTelegramId(telegramId);

    // 1. If user doesn't exist in DB -> AUTOMATIC ACCOUNT CREATION
    if (!account) {
      let subscriptionActive = false;
      let subscriptionExpiresAt = null;

      // If the artist is in the Whitelist -> GRANT 1 MONTH (30 DAYS) FREE ACCESS
      if (PROMO_WHITELIST.includes(telegramId)) {
        subscriptionActive = true;
        subscriptionExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // Now + 30 days
      }

      await upsertAccount({
        telegramId,
        username,
        role: "artist",
        subscriptionActive,
        subscriptionExpiresAt
      });

      account = await getAccountByTelegramId(telegramId);
    } else {
      // 2. If user exists but was recently added to Whitelist (and has no active sub)
      if (PROMO_WHITELIST.includes(telegramId) && (!account.subscriptionActive || account.subscriptionExpiresAt === null)) {
        account.subscriptionActive = true;
        account.subscriptionExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
        await upsertAccount({
          telegramId,
          subscriptionActive: true,
          subscriptionExpiresAt: account.subscriptionExpiresAt
        });
      }
      
      // Update username if changed in Telegram
      if (account.username !== username) {
        await supabase.from("accounts").update({ username }).eq("telegram_id", telegramId);
      }
    }

    // Verify if subscription has expired or not
    const now = Date.now();
    const hasActiveSub = account.subscriptionActive && account.subscriptionExpiresAt && account.subscriptionExpiresAt > now;

    res.json({
      ok: true,
      user: {
        telegramId: account.telegramId,
        username: username,
        subscriptionActive: !!hasActiveSub,
        subscriptionExpiresAt: account.subscriptionExpiresAt
      }
    });

  } catch (err) {
    res.status(500).json({ error: "Authentication system error: " + err.message });
  }
});

/**
 * Middleware to check Artist Subscription
 */
async function requireActiveSubscription(req, res, next) {
  const account = await getAccountByTelegramId(req.user.telegramId);
  const now = Date.now();
  const hasActiveSub = account?.subscriptionActive && account?.subscriptionExpiresAt && account?.subscriptionExpiresAt > now;

  if (!hasActiveSub) {
    return res.status(402).json({ error: "Active subscription required to upload assets." });
  }
  next();
}

/**
 * Create Telegram Stars Invoice for Artist Subscription
 */
app.post("/api/subscription/invoice", requireAuth, async (req, res) => {
  try {
    const resp = await fetch(`${TG_API}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Artist Monthly Subscription",
        description: "Unlock unlimited product uploads and keep 100% of your sales.",
        payload: JSON.stringify({ kind: "artist_subscription", telegramId: req.user.telegramId }),
        provider_token: "", // Empty for Telegram Stars (XTR)
        currency: "XTR",
        prices: [{ label: "Artist Subscription", amount: ARTIST_SUBSCRIPTION_PRICE_STARS }],
        subscription_period: 2592000, // 30 days recurring
      }),
    });
    const data = await resp.json();
    res.json({ invoiceLink: data.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Upload New Product (Protected by subscription check)
 */
app.post("/api/products", requireAuth, requireActiveSubscription, async (req, res) => {
  const { title, description, category, priceStars, priceTon, fileKey } = req.body;
  try {
    const product = await createProduct({
      artistTelegramId: req.user.telegramId,
      title,
      description,
      category,
      priceStars,
      priceTon,
      fileKey,
    });
    res.json({ ok: true, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Create Invoice Link for Buying a Product
 */
app.post("/api/pay/stars/invoice", requireAuth, async (req, res) => {
  const { productId, chatId } = req.body;
  const product = await getProduct(productId);

  if (!product) return res.status(404).json({ error: "Product not found" });

  const resp = await fetch(`${TG_API}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: product.title,
      description: product.description || "VTuber Art Asset",
      payload: JSON.stringify({ kind: "product_purchase", productId, buyerChatId: chatId }),
      provider_token: "",
      currency: "XTR",
      prices: [{ label: product.title, amount: product.priceStars }],
    }),
  });
  const data = await resp.json();
  res.json({ invoiceLink: data.result });
});

/**
 * Telegram Security Verification
 */
function requireAuth(req, res, next) {
  if (!BOT_TOKEN) return res.status(500).json({ error: "BOT_TOKEN is missing in server environment." });

  const initData = req.headers["x-telegram-init-data"];
  if (!initData) return res.status(401).json({ error: "Unauthorized (No InitData provided)." });

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) return res.status(401).json({ error: "Invalid Telegram security hash." });

    const user = JSON.parse(params.get("user") || "{}");
    req.user = { telegramId: String(user.id), username: user.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Security error: " + err.message });
  }
}

// Database Helpers
async function getAccountByTelegramId(telegramId) {
  const { data, error } = await supabase.from("accounts").select("*").eq("telegram_id", telegramId).single();
  if (error || !data) return null;
  return {
    telegramId: data.telegram_id,
    username: data.username,
    subscriptionActive: data.subscription_active,
    subscriptionExpiresAt: data.subscription_expires_at,
  };
}

async function upsertAccount(fields) {
  const row = { telegram_id: fields.telegramId };
  if (fields.username !== undefined) row.username = fields.username;
  if (fields.role !== undefined) row.role = fields.role;
  if (fields.subscriptionActive !== undefined) row.subscription_active = fields.subscriptionActive;
  if (fields.subscriptionExpiresAt !== undefined) row.subscription_expires_at = fields.subscriptionExpiresAt;
  await supabase.from("accounts").upsert(row, { onConflict: "telegram_id" });
}

async function createProduct(fields) {
  const { data, error } = await supabase.from("products").insert({
    artist_telegram_id: fields.artistTelegramId,
    title: fields.title,
    description: fields.description || "",
    category: fields.category,
    price_stars: fields.priceStars,
    price_ton: fields.priceTon || 0,
    file_key: fields.fileKey,
  }).select().single();
  if (error) throw error;
  return data;
}

async function getProduct(id) {
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) return null;
  return { id: data.id, title: data.title, description: data.description, priceStars: data.price_stars };
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(process.env.PORT || 3000, () => console.log("VTuber Art Market backend running"));
