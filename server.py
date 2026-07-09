import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
# Vercel'dagi frontend saytingiz bemalol bog'lanishi uchun CORS'ni yoqamiz
CORS(app)

# Namuna uchun oq ro'yxat (Sizning va Artistlarning Telegram ID raqamlari)
PROMO_WHITELIST = [123456789, 987654321]

# Namuna uchun mahsulotlar bazasi (Xotirada saqlanadi)
products_db = [
    {
        "id": 1,
        "title": "Cute Neko Rigged Model v1",
        "image": "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500",
        "description": "Fully rigged Live2D VTuber model. Ready for VTube Studio."
    },
    {
        "id": 2,
        "title": "Cyberpunk Cyber-Gamer Overlay",
        "image": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500",
        "description": "Animated Twitch overlays and panels for VTubers."
    }
]

# 1. Market uchun mahsulotlarni olish
@app.route('/api/products', methods=['GET'])
def get_products():
    return jsonify(products_db)

# 2. Foydalanuvchining oq ro'yxatda bor-yo'qligini tekshirish
@app.route('/api/check-user/<int:user_id>', methods=['GET'])
def check_user(user_id):
    is_active = user_id in PROMO_WHITELIST
    return jsonify({"promo_active": is_active})

# 3. Yangi mahsulot yuklash (Xavfsizlik filtri bilan)
@app.route('/api/upload', methods=['POST'])
def upload_product():
    data = request.json
    user_id = data.get('user_id')
    title = data.get('title')
    image = data.get('image')
    about = data.get('about')

    # Oq ro'yxat tekshiruvi
    if user_id not in PROMO_WHITELIST:
        return jsonify({"error": "Subscription required to publish items!"}), 403

    # Xavfsizlik filtri: Telegram havola, @ username yoki telefon raqamlarni taqiqlash
    forbidden_keywords = ["t.me", "tg://", "@", "+998"]
    for word in forbidden_keywords:
        if word in about.lower() or word in title.lower():
            return jsonify({"error": "Security Alert: Sharing direct contact links or usernames is prohibited!"}), 400

    # Bazaga qo'shish
    new_item = {
        "id": len(products_db) + 1,
        "title": title,
        "image": image,
        "description": about[:100] + "..." if len(about) > 100 else about
    }
    products_db.append(new_item)
    
    return jsonify({"message": "Product successfully published to the market!"}), 201

if __name__ == '__main__':
    # Render portni o'zi tayinlaydi
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
