import re
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Frontend bilan xatoliksiz bog'lanish uchun

# 1. Artistlar uchun PROMO Oq Ro'yxat (Telegram ID'lar)
PROMO_WHITELIST = [123456789, 987654321, 555666777]

# 2. Xotiradagi vaqtinchalik ma'lumotlar bazasi (Mahsulotlar ro'yxati)
PRODUCTS_DB = [
    {
        "id": 1,
        "title": "Professional 2D Live VTuber Model",
        "description": "Ready to use high-quality VTuber model with full rigging. Perfect for streamers!",
        "image": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500",
        "file_url": "#"
    },
    {
        "id": 2,
        "title": "Chibi Stream Emotes Pack",
        "description": "6 custom cute chibi emotes for Twitch, Discord, and Telegram overlay.",
        "image": "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=500",
        "file_url": "#"
    }
]

# 3. Eng boshidan beri aytilgan MATN FILTRLASH mexanizmi (Hech nima o'tmaydi)
def contains_forbidden_content(text: str) -> bool:
    # Havolalar va domenlar
    url_pattern = r'(https?://[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
    # Ijtimoiy tarmoq foydalanuvchi nomlari (@username)
    username_pattern = r'@[a-zA-Z0-9_]+'
    # Email manzillari
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    # Har xil formatdagi telefon raqamlari
    phone_pattern = r'(\+?[0-9]{1,4}?[\s.-]?\(?[0-9]{1,3}?\)?[\s.-]?[0-9]{3,4}[\s.-]?[0-9]{3,4})'
    # Taqiqlangan kalit so'zlar
    keywords_pattern = r'(instagram|insta|tg|telegram|t\.me|contact|phone|email|dm me|write me|boglanish)'

    if (re.search(url_pattern, text) or 
        re.search(username_pattern, text) or 
        re.search(email_pattern, text) or 
        re.search(phone_pattern, text) or 
        re.search(keywords_pattern, text, re.IGNORECASE)):
        return True
    return False

# API: Market uchun mahsulotlarni olish
@app.route('/api/products', channels=['GET'])
def get_products():
    return jsonify(PRODUCTS_DB), 200

# API: Artist holatini (PROMO/Whitelist) tekshirish
@app.route('/api/check-user/<int:user_id>', channels=['GET'])
def check_user(user_id):
    is_promo = user_id in PROMO_WHITELIST
    return jsonify({"user_id": user_id, "promo_active": is_promo}), 200

# API: Yangi raqamli mahsulot yuklash (Barcha cheklovlar bilan)
@app.route('/api/upload', channels=['POST'])
def upload_product():
    data = request.json
    user_id = int(data.get('user_id', 0))
    about_text = data.get('about', '')
    title = data.get('title', 'Digital Asset')
    image_url = data.get('image', 'https://via.placeholder.com/150')

    # 1. Obuna/Whitelist tekshiruvi
    if user_id not in PROMO_WHITELIST:
        return jsonify({"error": "Subscription Required! You are not in the whitelist."}), 403

    # 2. 2000 belgidan oshmasligi tekshiruvi
    if len(about_text) > 2000:
        return jsonify({"error": "Text exceeds the 2000 characters limit!"}), 400

    # 3. Kontent xavfsizligi filtri
    if contains_forbidden_content(about_text) or contains_forbidden_content(title):
        return jsonify({"error": "Security Breach! Links, emails, phone numbers, or social usernames are strictly forbidden!"}), 466

    # Agar hammasi toza bo'lsa, bazaga qo'shish
    new_product = {
        "id": len(PRODUCTS_DB) + 1,
        "title": title,
        "description": about_text,
        "image": image_url,
        "file_url": "#"
    }
    PRODUCTS_DB.insert(0, new_product) # Yangi mahsulotni boshiga qo'shadi
    return jsonify({"message": "Product successfully published to Market! 🎉"}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)
