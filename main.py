from fastapi import FastAPI, HTTPException
from aiogram import Bot
from aiogram.types import LabeledPrice

app = FastAPI()
BOT_TOKEN = "SIZNING_BOT_TOKENINGIZ"
bot = Bot(token=BOT_TOKEN)

# Whitelist (Siz buni keyinroq JSON yoki DB dan o'qiydigan qilasiz)
WHITELIST = [123456789, 987654321]

@app.get("/check-access/{user_id}")
async def check_access(user_id: int):
    # Agar foydalanuvchi whitelistda bo'lsa yoki obunasi bo'lsa
    if user_id in WHITELIST:
        return {"status": "granted", "is_premium": True}
    return {"status": "denied", "is_premium": False}

@app.post("/create-payment/{user_id}")
async def create_payment(user_id: int):
    # Telegram Stars uchun to'lov linki yaratish
    invoice_link = await bot.create_invoice_link(
        title="VTuber Art Market Subscription",
        description="1 Month Subscription",
        payload=f"sub_{user_id}",
        currency="XTR", # XTR bu Telegram Stars
        prices=[LabeledPrice(label="Subscription", amount=1500)]
    )
    return {"url": invoice_link}
  
