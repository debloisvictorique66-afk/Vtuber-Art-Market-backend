# VTuber Art Market 

A 3-page Telegram Mini App matching your mockup — full pixel-art UI (flat
colours, hard notched borders, stepped drop-shadows, crisp pixel sprites,
"Press Start 2P" + "VT323" fonts) with a real, persistent backend.

```
vtuber-market/
├── backend/            Express REST API + MongoDB
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── frontend/            Static Telegram Mini App client
    ├── index.html
    ├── style.css
    └── app.js
```

## v4 — this is the "actually production-ready" version

Earlier versions kept data in memory and trusted plain headers for who's
calling. v4 fixes both of the things that made this "just a demo":

1. **Real persistence (MongoDB)** — products, artists, accounts, orders,
   subscriptions, and the sponsor whitelist are all stored in MongoDB now.
   Nothing is lost on restart or redeploy.
2. **Real identity (Telegram initData verification)** — the backend now
   verifies the cryptographic signature Telegram attaches to every Mini App
   session (`initData`), instead of trusting a header anyone could fake.
   Requests with a missing/invalid signature outside of local dev are
   rejected with `401`.

**Still local-disk (not yet "real production" for this one piece):** the
actual uploaded preview images and sellable files still live on the
backend server's local disk (`backend/uploads/`). Most hosts, including
Render's free tier, wipe local disk on every redeploy/restart. This is
fine to ship and test with, but before relying on it long-term, swap the
`fs.writeFileSync` calls in `server.js` for an object store like
Cloudflare R2 or AWS S3 — ask me when you're ready and I'll wire it in.

## Setting up MongoDB Atlas (free, ~10 minutes)

1. Go to https://www.mongodb.com/cloud/atlas/register and sign up (free,
   no credit card needed).
2. Create a free **M0** cluster.
3. **Database Access** (left sidebar) → add a database user + password.
4. **Network Access** → **Add IP Address** → **Allow Access from Anywhere**
   (`0.0.0.0/0`) — simplest option for a small app like this.
5. **Connect** → **Drivers** → copy the connection string. It looks like:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/...`
6. Paste it into `MONGODB_URI` in your `.env` (or Render's environment
   variables) — replace `<password>` with your real password.

## 1. Run the backend

```bash
cd backend
npm install
cp .env.example .env     # fill in BOT_TOKEN, MONGODB_URI, ADMIN_KEY, SUBSCRIPTION_PRICE
npm start                 # → http://localhost:3000
```

If `MONGODB_URI` is missing or wrong, you'll see a clear
`❌ MongoDB connection failed` message in the logs — fix the connection
string and restart.

Endpoints:
- `GET  /api/products?category=&search=` — marketplace listing (title + thumbnail only)
- `GET  /api/products/:id` — full detail (description, price, preview)
- `GET  /api/artist/:username` — artist profile + stats + their products
- `POST /api/artist/:username/products` — add a product (multipart: title, category, price, description, preview, asset)
- `PUT  /api/products/:id` / `DELETE /api/products/:id`
- `GET  /api/artist/:username/orders`
- `GET  /api/account/:username` — balance, level, EXP
- `POST /api/account/:username/topup` — add TG Stars (dev/demo wallet)
- `POST /api/account/:username/purchase` — dev-only in-app wallet purchase
- `POST /api/products/:id/invoice-link` — create a real Telegram Stars invoice
- `GET  /api/subscription/status` — is this user active / whitelisted?
- `POST /api/subscription/invoice-link` — create the monthly subscription invoice
- `POST /webhook` — Telegram sends payment updates here
- `GET/POST/DELETE /api/admin/whitelist` — manage sponsor free-access list (needs `x-admin-key`)

## 2. Run the frontend

```bash
cd frontend
npx serve .          # or: python3 -m http.server 8080
```

Open `frontend/app.js` and set the `API_BASE` constant to your deployed
backend URL (or set `window.VTUBER_API_BASE` before the script loads).

## 3. Wire it up as a real Telegram Mini App

1. Create a bot with **@BotFather** and register a Mini App pointing at
   your deployed frontend URL (must be HTTPS).
2. The frontend loads `telegram-web-app.js`, calls `tg.ready()` /
   `tg.expand()`, and sends Telegram's signed `initData` with every API
   request via the `x-init-data` header — this is what the backend
   verifies to know who's really calling.
3. Set your webhook once, after deploying the backend:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourbackend.com/webhook`
4. Deploy the backend (Render/Railway/Fly/a VPS) with `BOT_TOKEN`,
   `MONGODB_URI`, `ADMIN_KEY`, and `SUBSCRIPTION_PRICE` set as environment
   variables, and the frontend (Netlify/Vercel), then set `API_BASE`
   accordingly and enable CORS for your frontend's origin.

### Managing the sponsor whitelist

```bash
curl -X POST https://your-backend.com/api/admin/whitelist \
  -H "x-admin-key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"chatId": "123456789"}'

curl https://your-backend.com/api/admin/whitelist -H "x-admin-key: YOUR_ADMIN_KEY"

curl -X DELETE https://your-backend.com/api/admin/whitelist/123456789 -H "x-admin-key: YOUR_ADMIN_KEY"
```

## Design notes

- Palette: purple `#8C4FCF` / deep ink `#3A1F5C` / pink `#FF6FA5` / gold
  `#FFC94A`, flat with no gradients.
- Character/UI icons are generated as inline SVG pixel grids at runtime in
  `app.js` — no image assets to host for those. Real product preview
  images are uploaded by artists and watermarked server-side with `sharp`.
- Cards use a clipped notched-corner shape (`.pixel-panel`) with a hard
  offset shadow instead of blur, and buttons "press down" on `:active`.
  
