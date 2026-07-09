import re
from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

# 1. Telegram ID orqali artistlarni PROMO ro'yxati (30 kunlik bepul)
PROMO_WHITELIST = [123456789, 987654321]  # O'zingizning va kerakli artistlarning IDlarini yozing

# 2. Xavfsizlik filtri: ijtimoiy tarmoqlar, havolalar, emaillar va raqamlarni tekshirish
def filter_forbidden_content(text: str) -> bool:
    # Havolalar (http, https, www, .com, .uz va h.k.)
    url_pattern = r'(https?://[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
    # Telegram yoki ijtimoiy tarmoq username'lari (@)
    username_pattern = r'@[a-zA-Z0-9_]+'
    # Email manzillari
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    # Telefon raqamlari (har xil formatdagi raqamlar ketma-ketligi)
    phone_pattern = r'(\+?[0-9]{1,4}?[\s.-]?\(?[0-9]{1,3}?\)?[\s.-]?[0-9]{3,4}[\s.-]?[0-9]{3,4})'
    # Qo'shimcha kalit so'zlar (Instagram, telegram, t.me, contact va h.k.)
    keywords_pattern = r'(instagram|insta|tg|telegram|t\.me|contact|phone|email|me bilan bog\'laning|boglaning)'

    if (re.search(url_pattern, text) or 
        re.search(username_pattern, text) or 
        re.search(email_pattern, text) or 
        re.search(phone_pattern, text) or 
        re.search(keywords_pattern, text, re.IGNORECASE)):
        return True # Taqiqlangan kontent topildi
    return False

# Botni ishga tushirish komandasi
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id
    
    # Avtomatik ro'yxatdan o'tish va PROMO tekshiruvi (Email so'ralmaydi)
    status_msg = "Welcome to VTuber Art Market!\n"
    if user_id in PROMO_WHITELIST:
        status_msg += "🎉 Promo Active: You have 30 days of free premium access!"
    else:
        status_msg += "Explore digital assets instantly."

    # Mini App tugmasi (Ingliz tilida va suv belgisi bilan)
    keyboard = [
        [InlineKeyboardButton("Open VTuber Art Market 🎨", web_app=WebAppInfo(url="https://SizningDomenIngiz.com"))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(status_msg, reply_markup=reply_markup)

def main():
    # Bot tokeningizni bu yerga kiriting
    application = Application.builder().token("YOUR_BOT_TOKEN").build()
    application.add_handler(CommandHandler("start", start))
    application.run_polling()

if __name__ == '__main__':
    main()
  
