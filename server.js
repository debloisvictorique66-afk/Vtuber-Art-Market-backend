/**
 * VTuber Art Market — backend reference skeleton (Node.js / Express)
 * -------------------------------------------------------------
 * This is a STARTING POINT, not a finished production server.
 * It shows the real integration points you'll need:
 *   1. Telegram Stars invoices (native in-app currency)
 *   2. TON payments via TON Connect
 *   3. Protected file delivery (signed, time-limited, watermarked)
 *
 * You must supply: BOT_TOKEN, a database (Postgres/Mongo), and
 * file storage (S3-compatible bucket) before this runs for real.
 */

const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const app = express();
app.use(express.json());

// Allow the Mini App frontend (on a different domain) to call this API.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const BOT_TOKEN = process.env.BOT_TOKEN; // from @BotFather
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ---------------------------------------------------------------
 * 0. EMAIL VERIFICATION — required for both buyer & VTuber accounts
 * ------------------------------------------------------------- */
// Flow:
//   1. User opens Mini App (Telegram already gives us their telegramId).
//   2. They type their email once → we send a 6-digit code.
//   3. They enter the code → email marked verified → account fully active.
// This runs once per account, not on every login.
//
// Email sending: use any transactional email API (Resend, SendGrid, etc).
// Below uses Resend as an example — swap for whichever you set up.
const RESEND_API_KEY = process.env.RESEND_API_KEY;

app.post("/api/account/email/start", requireAuth, async (req, res) => {
  const { email, role } = req.body; // role: "buyer" | "artist"
  const telegramId = req.user.telegramId;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const existing = await getAccountByTelegramId(telegramId);
  if (existing?.emailVerified) {
    return res.status(409).json({ error: "Email is already verified on this account" });
  }

  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");

  await upsertAccount({
    telegramId,
    email,
    role,
    emailVerified: false,
    verificationCodeHash: codeHash,
    verificationExpiresAt: Date.now() + 10 * 60 * 1000, // valid for 10 minutes
  });

  await sendEmail({
    to: email,
    subject: "VTuber Art Market — verification code",
    text: `Your verification code is: ${code}\nThis code is valid for 10 minutes. If you didn't request this, please ignore this email.`,
  });

  res.json({ ok: true, message: "Verification code sent to email" });
});

app.post("/api/account/email/confirm", requireAuth, async (req, res) => {
  const { code } = req.body;
  const telegramId = req.user.telegramId;
  const account = await getAccountByTelegramId(telegramId);

  if (!account || !account.verificationCodeHash) {
    return res.status(400).json({ error: "No email submitted yet" });
  }
  if (Date.now() > account.verificationExpiresAt) {
    return res.status(410).json({ error: "Code has expired, please request a new one" });
  }
  const codeHash = crypto.createHash("sha256").update(String(code)).digest("hex");
  if (codeHash !== account.verificationCodeHash) {
    return res.status(401).json({ error: "Incorrect code" });
  }

  await upsertAccount({
    telegramId,
    emailVerified: true,
    verificationCodeHash: null,
    verificationExpiresAt: null,
  });
  res.json({ ok: true, message: "Email verified" });
});

// Gate: buyers can browse freely, but paying (invoice/TON) and artists
// uploading products should both require emailVerified === true.
async function requireVerifiedEmail(req, res, next) {
  const account = await getAccountByTelegramId(req.user.telegramId);
  if (!account?.emailVerified) {
    return res.status(403).json({ error: "Please verify your email to continue" });
  }
  next();
}

/* ---------------------------------------------------------------
 * 0b. SUBSCRIPTION — ONLY artists pay, buyers browse free
 * ------------------------------------------------------------- */
// Model: buyers pay nothing to enter. Artists pay a recurring Stars
// subscription to be allowed to upload/sell. Every sale afterwards is
// 100% theirs — the platform takes 0% commission on sales.
const ARTIST_SUBSCRIPTION_PRICE_STARS = 500; // weekly/monthly — your call

app.post("/api/subscription/invoice", requireAuth, requireVerifiedEmail, async (req, res) => {
  const { chatId } = req.body;
  const resp = await fetch(`${TG_API}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Artist subscription",
      description: "Platformada mahsulot yuklash va sotish huquqi",
      payload: JSON.stringify({ kind: "artist_subscription", telegramId: req.user.telegramId }),
      provider_token: "",
      currency: "XTR",
      prices: [{ label: "Artist subscription", amount: ARTIST_SUBSCRIPTION_PRICE_STARS }],
      // subscription_period: 2592000 → makes this a recurring Stars subscription
      // (30 days in seconds). Telegram then auto-charges and auto-renews it.
      subscription_period: 2592000,
    }),
  });
  const data = await resp.json();
  res.json({ invoiceLink: data.result });
});

// In your bot webhook handler, alongside successful_payment for product
// purchases, also listen for the subscription payload and flip a flag:
//
// if (payload.kind === "artist_subscription") {
//   return setArtistSubscriptionActive(payload.telegramId, true, {
//     subscriptionExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
//   });
// }
//
// Telegram can auto-renew this subscription itself (subscription_period
// above handles that). But auto-renewal can silently fail — user's Stars
// balance too low, they canceled it in Telegram settings, etc. So we also
// run our own reminder + expiry check daily as a safety net, not instead
// of Telegram's auto-renewal.

// Cron — run daily.
async function runSubscriptionRenewalJob() {
  const expiringSoon = await getArtistsExpiringWithinDays(3);
  for (const artist of expiringSoon) {
    const invoiceLink = await createSubscriptionInvoiceLink(artist.telegramId);
    await notifyArtist(
      artist.telegramId,
      `Your subscription ${daysUntil(artist.subscriptionExpiresAt)} day(s) left before it expires. Renew here: ${invoiceLink}`
    );
  }

  const expired = await getArtistsWithExpiredSubscription();
  for (const artist of expired) {
    await setArtistSubscriptionActive(artist.telegramId, false);
    await notifyArtist(
      artist.telegramId,
      "Your subscription has expired — your products are temporarily hidden from the store. Open the panel to renew."
    );
    // Note: existing products are hidden from the marketplace, not deleted —
    // reactivating the subscription should simply unhide them again.
  }
}

function daysUntil(timestamp) {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000)));
}

async function createSubscriptionInvoiceLink(telegramId) {
  const resp = await fetch(`${TG_API}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Artist subscription — renewal",
      description: "Platformada mahsulot yuklash va sotishni davom ettirish",
      payload: JSON.stringify({ kind: "artist_subscription", telegramId }),
      provider_token: "",
      currency: "XTR",
      prices: [{ label: "Artist subscription", amount: ARTIST_SUBSCRIPTION_PRICE_STARS }],
      subscription_period: 2592000,
    }),
  });
  const data = await resp.json();
  return data.result;
}

async function requireActiveSubscription(req, res, next) {
  const account = await getAccountByTelegramId(req.user.telegramId);
  if (!account?.subscriptionActive) {
    return res.status(402).json({ error: "Activate your subscription before uploading products" });
  }
  next();
}

/* ---------------------------------------------------------------
 * 1. TELEGRAM STARS — create an invoice for a product
 * ------------------------------------------------------------- */
app.post("/api/pay/stars/invoice", requireAuth, requireVerifiedEmail, async (req, res) => {
  const { productId, chatId } = req.body;
  const product = await getProduct(productId); // your DB lookup

  const resp = await fetch(`${TG_API}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: product.title,
      description: product.description,
      payload: JSON.stringify({ kind: "product_purchase", productId, buyerChatId: chatId }),
      provider_token: "", // empty string = Telegram Stars (XTR), no provider needed
      currency: "XTR",
      prices: [{ label: product.title, amount: product.priceStars }],
    }),
  });
  const data = await resp.json();
  res.json({ invoiceLink: data.result });
});

// Telegram sends pre_checkout_query and successful_payment updates to your
// bot webhook — NOT to this REST route. You must handle them in your bot
// update handler. This is also where the 100%-to-artist ledger entry gets
// created — nothing is held back as commission.
//
// bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));
// bot.on("message:successful_payment", async (ctx) => {
//   const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
//   if (payload.kind === "artist_subscription") {
//     return setArtistSubscriptionActive(payload.telegramId, true);
//   }
//   const product = await getProduct(payload.productId);
//   await grantPurchase(payload.buyerChatId, payload.productId);
//   await recordLedgerEntry({
//     artistTelegramId: product.artistTelegramId,
//     productId: payload.productId,
//     amountStars: product.priceStars,
//     platformCut: 0, // 100% to artist — no commission
//     status: "pending_hold", // becomes withdrawable once Telegram's 21-day hold ends
//     receivedAt: Date.now(),
//   });
// });

/* ---------------------------------------------------------------
 * 2. TON — verify an on-chain payment
 * ------------------------------------------------------------- */
// Frontend uses TON Connect (https://docs.ton.org/develop/dapps/ton-connect)
// to open the user's wallet and send a transaction to YOUR wallet address
// with a unique comment/memo per order. This endpoint then confirms it
// actually landed on-chain before unlocking the file.
app.post("/api/pay/ton/verify", async (req, res) => {
  const { orderId, txHash } = req.body;
  // Use a TON indexer (e.g. toncenter.com API) to look up txHash,
  // check destination address + amount + memo match the pending order.
  const verified = await verifyTonTransaction(txHash, orderId);
  if (verified) {
    await markOrderPaid(orderId);
    return res.json({ ok: true });
  }
  res.status(402).json({ ok: false });
});

/* ---------------------------------------------------------------
 * 2b. ARTIST PRODUCT UPLOAD — requires verified email
 * ------------------------------------------------------------- */
app.post("/api/products", requireAuth, requireVerifiedEmail, requireActiveSubscription, async (req, res) => {
  const { title, description, category, priceStars, priceTon, fileKey } = req.body;
  const product = await createProduct({
    artistTelegramId: req.user.telegramId,
    title,
    description,
    category,
    priceStars,
    priceTon,
    fileKey, // uploaded separately to S3 first, this just references it
  });
  res.json({ ok: true, product });
});

/* ---------------------------------------------------------------
 * 4. LEDGER — 100% to the artist, no commission. Shown weekly,
 *    oyma-oy (21+ kunlik Telegram hold tugagach) real to'lanadi.
 * ------------------------------------------------------------- */

// Artists see how much they earned this week in their panel —
// this is for DISPLAY only — it may not have converted to TON yet.
app.get("/api/ledger/me", requireAuth, requireVerifiedEmail, async (req, res) => {
  const entries = await getLedgerEntriesForArtist(req.user.telegramId);
  const thisWeek = entries.filter((e) => Date.now() - e.receivedAt < 7 * 24 * 60 * 60 * 1000);
  const pendingHold = entries.filter((e) => e.status === "pending_hold");
  const withdrawable = entries.filter((e) => e.status === "withdrawable");
  const paidOut = entries.filter((e) => e.status === "paid_out");

  res.json({
    thisWeekStars: sumStars(thisWeek),
    pendingHoldStars: sumStars(pendingHold), // hali 21 kun to'lmagan
    withdrawableStars: sumStars(withdrawable), // hold tugagan, navbatdagi payoutda ketadi
    lifetimePaidOutStars: sumStars(paidOut),
  });
});

function sumStars(entries) {
  return entries.reduce((total, e) => total + e.amountStars, 0);
}

// Cron job — run once daily (e.g. via node-cron or
// hosting'ingizning scheduled-job funksiyasi orqali). Vazifasi:
//   1. 21 kunlik holdi tugagan ledger yozuvlarini "withdrawable" qiladi
//   2. Har oyning belgilangan kunida (masalan har oy 1-sanada) barcha
//      "withdrawable" yozuvlarni artistning TON hamyoniga avtomatik yuboradi
//
// Buni ishga tushirish uchun sizning Fragment/TON withdrawal hisobingizda
// you'll need enough TON on hand (you convert Stars→TON yourself first
// via Fragment, a one-time manual click — this step is still manual,
// Telegram buni botlar uchun to'liq avtomatlashtirishga ruxsat bermaydi).
async function runWeeklyLedgerJob() {
  await markMaturedEntriesWithdrawable(); // 21 kun to'lgan yozuvlarni belgilaydi

  const artists = await getArtistsWithWithdrawableBalance();
  for (const artist of artists) {
    if (!artist.tonWalletAddress) {
      await notifyArtist(artist.telegramId, "Add your TON wallet address — payouts will be sent there");
      continue;
    }
    const amountTon = await starsToTon(artist.withdrawableStars);
    const sent = await sendTonPayment(artist.tonWalletAddress, amountTon, `payout:${artist.telegramId}`);
    if (sent.ok) {
      await markArtistEntriesPaidOut(artist.telegramId);
      await notifyArtist(artist.telegramId, `${amountTon} TON sent to your wallet ✓`);
    }
  }
}

/* ---------------------------------------------------------------
 * 5. AFFILIATE / REFERRAL — using Telegram's own program
 * ------------------------------------------------------------- */
// Telegram mini app'lar uchun rasmiy affiliate dasturi mavjud: kimdir
// shares your app and a new subscriber (artist) joins through it,
// Telegram automatically pays that person a Star commission — no need
// alohida kod bilan hisoblash shart emas, Telegram Bot API orqali
// bot uchun affiliate dasturini yoqasiz. Aniq metod nomlari va foiz
// settings are updated frequently in the Telegram Bot API docs —
// check the "affiliate" section on https://core.telegram.org/bots/api
// ishga tushirishdan oldin albatta tekshirib chiqing.
app.post("/api/referral/track", async (req, res) => {
  const { newTelegramId, referrerTelegramId } = req.body;
  await recordReferral({ newTelegramId, referrerTelegramId, at: Date.now() });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------
 * 3. PROTECTED FILE DELIVERY
 * ------------------------------------------------------------- */
// Be upfront with yourself about this: there is no way to make a file
// fully un-screenshottable or un-recordable once it's rendered on a
// screen. What you CAN realistically do:
//
//  - Never serve the raw file. Serve a short-lived signed URL
//    (e.g. 60 seconds) generated only after payment is confirmed.
//  - Stamp each delivered copy with an invisible-ish per-buyer
//    watermark (username/order id in a corner or steganographically)
//    so leaks can be traced back to a buyer.
//  - For images: serve through a canvas that disables right-click/
//    drag save as a deterrent (not a guarantee).
//  - For video/animation assets: stream instead of allowing direct
//    download, similar to how streaming services limit (not prevent)
//    ripping.
//  - Keep low-res/blurred previews public, full-res gated behind
//    the signed URL above.
app.get("/api/files/:orderId/signed-url", requireAuth, async (req, res) => {
  const order = await getOrder(req.params.orderId);
  if (order.buyerId !== req.user.id || order.status !== "paid") {
    return res.status(403).json({ error: "This order doesn't belong to you or hasn't been paid yet" });
  }
  const signedUrl = await generateSignedUrl(order.fileKey, {
    expiresInSeconds: 60,
    watermark: req.user.username,
  });
  res.json({ url: signedUrl });
});

/* ---------------------------------------------------------------
 * Stubs — replace with real implementations
 * ------------------------------------------------------------- */
async function getProduct(id) {
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) return null;
  return {
    id: data.id,
    artistTelegramId: data.artist_telegram_id,
    title: data.title,
    description: data.description,
    category: data.category,
    priceStars: data.price_stars,
    priceTon: data.price_ton,
    fileKey: data.file_key,
  };
}

async function getOrder(id) {
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).single();
  if (error) return null;
  return { id: data.id, productId: data.product_id, buyerId: data.buyer_telegram_id, status: data.status };
}

async function markOrderPaid(id) {
  await supabase.from("orders").update({ status: "paid" }).eq("id", id);
}

async function verifyTonTransaction(txHash, orderId) { /* toncenter.com call */ return false; }

async function generateSignedUrl(fileKey, opts) { /* S3 getSignedUrl + watermark job */ return ""; }

// Verifies the Telegram WebApp initData sent by the Mini App frontend in
// the "X-Telegram-Init-Data" header, per Telegram's official algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function requireAuth(req, res, next) {
  const initData = req.headers["x-telegram-init-data"];
  if (!initData) return res.status(401).json({ error: "Missing Telegram init data" });

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    return res.status(401).json({ error: "Invalid Telegram init data" });
  }

  const user = JSON.parse(params.get("user") || "{}");
  req.user = { telegramId: String(user.id), username: user.username, id: user.id };
  next();
}

function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || ""); }

async function getAccountByTelegramId(telegramId) {
  const { data, error } = await supabase.from("accounts").select("*").eq("telegram_id", telegramId).single();
  if (error || !data) return null;
  return {
    telegramId: data.telegram_id,
    role: data.role,
    email: data.email,
    emailVerified: data.email_verified,
    verificationCodeHash: data.verification_code_hash,
    verificationExpiresAt: data.verification_expires_at,
    subscriptionActive: data.subscription_active,
    subscriptionExpiresAt: data.subscription_expires_at,
    tonWalletAddress: data.ton_wallet_address,
  };
}

async function createProduct(fields) {
  const { data, error } = await supabase
    .from("products")
    .insert({
      artist_telegram_id: fields.artistTelegramId,
      title: fields.title,
      description: fields.description,
      category: fields.category,
      price_stars: fields.priceStars,
      price_ton: fields.priceTon,
      file_key: fields.fileKey,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function upsertAccount(fields) {
  const row = { telegram_id: fields.telegramId };
  if (fields.role !== undefined) row.role = fields.role;
  if (fields.email !== undefined) row.email = fields.email;
  if (fields.emailVerified !== undefined) row.email_verified = fields.emailVerified;
  if (fields.verificationCodeHash !== undefined) row.verification_code_hash = fields.verificationCodeHash;
  if (fields.verificationExpiresAt !== undefined) row.verification_expires_at = fields.verificationExpiresAt;
  if (fields.subscriptionActive !== undefined) row.subscription_active = fields.subscriptionActive;
  if (fields.subscriptionExpiresAt !== undefined) row.subscription_expires_at = fields.subscriptionExpiresAt;
  if (fields.tonWalletAddress !== undefined) row.ton_wallet_address = fields.tonWalletAddress;
  await supabase.from("accounts").upsert(row, { onConflict: "telegram_id" });
}

async function setArtistSubscriptionActive(telegramId, active, extra = {}) {
  await upsertAccount({
    telegramId,
    subscriptionActive: active,
    ...(extra.subscriptionExpiresAt ? { subscriptionExpiresAt: extra.subscriptionExpiresAt } : {}),
  });
}

async function getArtistsExpiringWithinDays(days) {
  const cutoff = Date.now() + days * 24 * 60 * 60 * 1000;
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .eq("role", "artist")
    .eq("subscription_active", true)
    .lte("subscription_expires_at", cutoff);
  return (data || []).map((a) => ({ telegramId: a.telegram_id, subscriptionExpiresAt: a.subscription_expires_at }));
}

async function getArtistsWithExpiredSubscription() {
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .eq("role", "artist")
    .eq("subscription_active", true)
    .lt("subscription_expires_at", Date.now());
  return (data || []).map((a) => ({ telegramId: a.telegram_id }));
}

async function recordLedgerEntry(fields) {
  await supabase.from("ledger_entries").insert({
    artist_telegram_id: fields.artistTelegramId,
    product_id: fields.productId,
    amount_stars: fields.amountStars,
    platform_cut: fields.platformCut || 0,
    status: fields.status || "pending_hold",
    received_at: fields.receivedAt || Date.now(),
  });
}

async function getLedgerEntriesForArtist(telegramId) {
  const { data } = await supabase.from("ledger_entries").select("*").eq("artist_telegram_id", telegramId);
  return (data || []).map((e) => ({
    amountStars: e.amount_stars,
    status: e.status,
    receivedAt: e.received_at,
  }));
}

async function markMaturedEntriesWithdrawable() {
  const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
  await supabase
    .from("ledger_entries")
    .update({ status: "withdrawable" })
    .eq("status", "pending_hold")
    .lte("received_at", cutoff);
}

async function getArtistsWithWithdrawableBalance() {
  const { data } = await supabase.from("ledger_entries").select("artist_telegram_id, amount_stars").eq("status", "withdrawable");
  const byArtist = {};
  for (const row of data || []) {
    byArtist[row.artist_telegram_id] = (byArtist[row.artist_telegram_id] || 0) + row.amount_stars;
  }
  const artists = [];
  for (const telegramId of Object.keys(byArtist)) {
    const account = await getAccountByTelegramId(telegramId);
    artists.push({
      telegramId,
      withdrawableStars: byArtist[telegramId],
      tonWalletAddress: account?.tonWalletAddress,
    });
  }
  return artists;
}

async function starsToTon(stars) { /* apply Telegram's current Stars→TON payout rate */ return 0; }
async function sendTonPayment(walletAddress, amountTon, memo) { /* TON SDK transfer, returns { ok } */ return { ok: false }; }

async function markArtistEntriesPaidOut(telegramId) {
  await supabase
    .from("ledger_entries")
    .update({ status: "paid_out" })
    .eq("artist_telegram_id", telegramId)
    .eq("status", "withdrawable");
}

async function notifyArtist(telegramId, message) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text: message }),
  });
}

async function recordReferral(fields) {
  await supabase.from("referrals").insert({
    new_telegram_id: fields.newTelegramId,
    referrer_telegram_id: fields.referrerTelegramId,
  });
}
async function sendEmail({ to, subject, text }) {
  // Example using Resend (https://resend.com) — replace with your provider
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "VTuber Art Market <noreply@yourdomain.com>",
      to,
      subject,
      text,
    }),
  });
}

app.listen(process.env.PORT || 3000, () => console.log("VTuber Art Market backend running"));
