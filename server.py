import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PROMO_WHITELIST = [123456789, 987654321]

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

# MASALANI YECHIMI: Bosh sahifaga kirganda ishlayotganini ko'rsatuvchi xabar
@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "success", "message": "Backend is running successfully!"})

@app.route('/api/products', methods=['GET'])
def get_products():
    return jsonify(products_db)

@app.route('/api/check-user/<int:user_id>', methods=['GET'])
def check_user(user_id):
    is_active = user_id in PROMO_WHITELIST
    return jsonify({"promo_active": is_active})

@app.route('/api/upload', methods=['POST'])
def upload_product():
    data = request.json
    user_id = data.get('user_id')
    title = data.get('title')
    image = data.get('image')
    about = data.get('about')

    if user_id not in PROMO_WHITELIST:
        return jsonify({"error": "Subscription required to publish items!"}), 403

    forbidden_keywords = ["t.me", "tg://", "@", "+998"]
    for word in forbidden_keywords:
        if word in about.lower() or word in title.lower():
            return jsonify({"error": "Security Alert: Sharing direct contact links or usernames is prohibited!"}), 400

    new_item = {
        "id": len(products_db) + 1,
        "title": title,
        "image": image,
        "description": about[:100] + "..." if len(about) > 100 else about
    }
    products_db.append(new_item)
    
    return jsonify({"message": "Product successfully published to the market!"}), 201

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
    import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# PROMO_WHITELIST ga o'z IDingizni qo'shib qo'ying
PROMO_WHITELIST = [123456789, 987654321, 678335943]

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

# --- ESKI KODLAR (O'zgartirilmadi) ---

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "success", "message": "Backend is running successfully!"})

@app.route('/api/products', methods=['GET'])
def get_products():
    return jsonify(products_db)

@app.route('/api/check-user/<int:user_id>', methods=['GET'])
def check_user(user_id):
    is_active = user_id in PROMO_WHITELIST
    return jsonify({"promo_active": is_active})

@app.route('/api/upload', methods=['POST'])
def upload_product():
    data = request.json
    user_id = data.get('user_id')
    title = data.get('title')
    image = data.get('image')
    about = data.get('about')

    if user_id not in PROMO_WHITELIST:
        return jsonify({"error": "Subscription required to publish items!"}), 403

    forbidden_keywords = ["t.me", "tg://", "@", "+998"]
    for word in forbidden_keywords:
        if word in about.lower() or word in title.lower():
            return jsonify({"error": "Security Alert: Sharing direct contact links or usernames is prohibited!"}), 400

    new_item = {
        "id": len(products_db) + 1,
        "title": title,
        "image": image,
        "description": about[:100] + "..." if len(about) > 100 else about
    }
    products_db.append(new_item)
    
    return jsonify({"message": "Product successfully published to the market!"}), 201

# --- YANI QO'SHILGAN FUNKSIYALAR (Profil va Sozlamalar) ---

user_profiles = {}

@app.route('/api/profile/<int:user_id>', methods=['GET'])
def get_profile(user_id):
    # Agar foydalanuvchi bazada bo'lmasa, default profil yaratamiz
    return jsonify(user_profiles.get(user_id, {"name": "User", "saved": [], "theme": "light"}))

@app.route('/api/profile/update', methods=['POST'])
def update_profile():
    data = request.json
    user_id = data.get('user_id')
    profile_data = data.get('profile')
    user_profiles[user_id] = profile_data
    return jsonify({"message": "Profile updated successfully!"})

@app.route('/api/save-item', methods=['POST'])
def save_item():
    data = request.json
    user_id = data.get('user_id')
    product_id = data.get('product_id')
    
    if user_id not in user_profiles:
        user_profiles[user_id] = {"name": "User", "saved": []}
    
    if product_id not in user_profiles[user_id].get("saved", []):
        user_profiles[user_id].setdefault("saved", []).append(product_id)
        
    return jsonify({"message": "Item saved successfully!"})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
    
