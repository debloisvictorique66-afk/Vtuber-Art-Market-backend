const { Telegraf } = require('telegraf');
const bot = new Telegraf('YOUR_TELEGRAM_BOT_TOKEN');

// Whitelist ro'yxati (Buni keyinchalik DB ga o'tkazing)
const whitelist = [123456789, 987654321]; 

// To'lovni qayta ishlash
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const userId = ctx.from.id;
    // Bu yerda foydalanuvchiga 30 kunlik obuna vaqti qo'shiladi
    await db.users.update({ id: userId }, { $set: { expires: Date.now() + 30*24*60*60*1000 } });
    ctx.reply("✅ Subscription activated! You can now download files.");
});

// Fayl yuklash funksiyasi
bot.command('download', async (ctx) => {
    const userId = ctx.from.id;
    const user = await db.users.findOne({ id: userId });
    
    if (whitelist.includes(userId) || (user && user.expires > Date.now())) {
        ctx.replyWithDocument({ source: './assets/file.zip' });
    } else {
        ctx.reply("❌ Subscription required. Pay 1500 Stars to access.");
    }
});

bot.launch();
