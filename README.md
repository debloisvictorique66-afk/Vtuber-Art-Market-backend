# VTuber Art Market - Telegram Mini App

Pixel-perfect cute VTuber art marketplace Mini App for Telegram.

## Features
- 🛍️ Full Marketplace with pixel UI
- 👩‍🎨 Artist Panel for uploading products
- 👤 Account & Settings
- ⭐ Telegram Stars payments simulation
- Monthly subscription (1500 Stars)
- Whitelist support for free users (edit in JS)
- Preview watermarks
- Favorites / Cart
- Responsive pixel art style

## How to Deploy
1. Open in Telegram Mini App via BotFather or direct link.
2. For production: Host on GitHub Pages / Vercel / any static host.
3. Connect to your Telegram Bot for real payments, file delivery and backend (use Node.js + Telegraf for example).

## Whitelist
Edit `whitelist` array in index.html JS for free access users (promoters).

## Real Integration
- Use `Telegram.WebApp` for user data, payments.
- For Stars payments: implement `createInvoice` via Bot API.
- File delivery: after successful payment, bot sends file to user.

Made with ❤️ for cute VTuber community.

Launch ready! 🚀
