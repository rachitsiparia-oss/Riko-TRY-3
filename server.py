import os
import sys
import time
import json
import sqlite3
import html
import datetime
import queue
from functools import wraps
from urllib.parse import urlsplit

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory, Response
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

import db


# Initialize Flask app
app = Flask(__name__, template_folder='templates', static_folder='static')

# ==========================================
# REAL-TIME BROADCAST ANNOUNCER (SSE)
# ==========================================
class MessageAnnouncer:
    def __init__(self):
        self.listeners = []

    def listen(self):
        q = queue.Queue(maxsize=100)
        self.listeners.append(q)
        return q

    def disconnect(self, q):
        if q in self.listeners:
            try:
                self.listeners.remove(q)
            except ValueError:
                pass

    def announce(self, msg):
        for i in reversed(range(len(self.listeners))):
            try:
                self.listeners[i].put_nowait(msg)
            except queue.Full:
                del self.listeners[i]

announcer = MessageAnnouncer()


# ==========================================
# ENVIRONMENT & CONFIGURATION LAYER
# ==========================================
def load_dotenv():
    """Failsafe manual parser for .env configurations to maintain dependency-free operations on Windows."""
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    key_str = key.strip()
                    val_str = val.strip()
                    # Strip surrounding single or double quotes
                    if (val_str.startswith('"') and val_str.endswith('"')) or (val_str.startswith("'") and val_str.endswith("'")):
                        val_str = val_str[1:-1]
                    os.environ[key_str] = val_str

# Run configuration loading
load_dotenv()

# Configure Secret Key for Flask Sessions
app.secret_key = os.environ.get('SECRET_KEY', 'default-signed-secret-key-1897aefd0b3c')

# Initialize and seed database
db.init_db()

# Categories configuration maps
CATEGORIES = ["For One", "Salads", "Cold Dishes", "Hot Dishes", "Main", "Desserts", "Beverages"]
CATEGORY_IDS = {
    "For One": "for-one",
    "Salads": "salads",
    "Cold Dishes": "cold-dishes",
    "Hot Dishes": "hot-dishes",
    "Main": "main",
    "Desserts": "desserts",
    "Beverages": "beverages"
}

# ==========================================
# STATIC ASSETS SERVERS
# ==========================================
@app.route('/styles.css')
def serve_styles():
    return send_from_directory(os.path.dirname(__file__), 'styles.css')

@app.route('/app.js')
def serve_js():
    return send_from_directory(os.path.dirname(__file__), 'app.js')

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'assets'), filename)

@app.route('/uploads/<path:filename>')
def serve_uploads(filename):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'uploads'), filename)

# ==========================================
# SECURITY LAYER (AUTH, RATE LIMIT, SANITIZE)
# ==========================================
# In-memory Login Attempts Store
login_attempts = {}

def get_ip():
    """Extract client IP address, handling proxy headers."""
    if request.headers.getlist("X-Forwarded-For"):
        return request.headers.getlist("X-Forwarded-For")[0]
    return request.remote_addr

def check_rate_limit(ip):
    """Check if the client IP is currently locked out from login attempts."""
    now = time.time()
    if ip in login_attempts:
        record = login_attempts[ip]
        if record['lockout_until'] > now:
            remaining = int(record['lockout_until'] - now)
            return False, f"Too many failed login attempts. Locked out. Please try again in {remaining // 60 + 1} minute(s)."
        if record['lockout_until'] > 0 and record['lockout_until'] <= now:
            # Lockout expired, reset counters
            login_attempts[ip] = {'count': 0, 'lockout_until': 0}
    return True, None

def record_login_attempt(ip, success):
    """Record a failed or successful login attempt for rate-limiting."""
    now = time.time()
    if ip not in login_attempts:
        login_attempts[ip] = {'count': 0, 'lockout_until': 0}
        
    record = login_attempts[ip]
    if success:
        login_attempts[ip] = {'count': 0, 'lockout_until': 0}
    else:
        record['count'] += 1
        if record['count'] >= 5:
            record['lockout_until'] = now + 600 # 10 minutes lockout
            print(f"IP {ip} locked out due to 5 consecutive authentication failures.")

def admin_required(f):
    """Decorator to protect admin panel views and APIs."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "error": "Unauthorized access denied."}), 401
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated_function

def sanitize_input(val):
    """Strip tags and escape characters in inputs to prevent XSS."""
    if isinstance(val, str):
        cleaned = val.strip()
        return html.escape(cleaned)
    return val

def wants_api_json():
    return request.path.startswith('/api/')

@app.errorhandler(HTTPException)
def handle_http_exception(exc):
    if wants_api_json():
        return jsonify({
            "success": False,
            "error": exc.name,
            "details": exc.description
        }), exc.code
    return exc

@app.errorhandler(Exception)
def handle_unexpected_exception(exc):
    print(f"Unhandled application error on {request.path}: {exc}")
    if wants_api_json():
        return jsonify({
            "success": False,
            "error": "Internal server error.",
            "details": str(exc)
        }), 500
    raise exc

def get_request_data():
    return request.get_json(silent=True) or request.form or {}

def require_supabase_reservations():
    """Reservations are production data and must be served from Supabase."""
    if db.use_supabase():
        return None
    return jsonify({
        "success": False,
        "error": "Supabase is not configured for reservations.",
        "details": "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the deployed environment. The reservation inbox reads Supabase only."
    }), 500

def load_seed_menu_collection(search_query=None, sort_col='id', sort_dir='ASC', page=1, per_page=10, category_filter=None, status_filter=None):
    if not os.path.exists(db.SEED_FILE):
        raise RuntimeError(f"Seed file not found: {db.SEED_FILE}")

    with open(db.SEED_FILE, 'r', encoding='utf-8') as f:
        items = json.load(f)

    normalized = []
    for index, item in enumerate(items, start=1):
        row = dict(item)
        row.setdefault('id', index)
        row.setdefault('status', 'Published')
        normalized.append(row)

    if search_query:
        needle = search_query.lower()
        normalized = [
            item for item in normalized
            if needle in str(item.get('name', '')).lower()
            or needle in str(item.get('description', '')).lower()
            or needle in str(item.get('category', '')).lower()
            or needle in str(item.get('status', '')).lower()
        ]

    if category_filter:
        normalized = [item for item in normalized if item.get('category') == category_filter]
    if status_filter:
        normalized = [item for item in normalized if item.get('status') == status_filter]

    allowed_sort_cols = {'id', 'name', 'slug', 'description', 'price', 'category', 'status'}
    sort_key = sort_col if sort_col in allowed_sort_cols else 'id'
    reverse = str(sort_dir).upper() == 'DESC'
    normalized.sort(key=lambda item: item.get(sort_key) if item.get(sort_key) is not None else '', reverse=reverse)

    total_items = len(normalized)
    page = max(int(page), 1)
    per_page = max(int(per_page), 1)
    start = (page - 1) * per_page
    paged = normalized[start:start + per_page]

    return {
        "items": paged,
        "total_items": total_items,
        "page": page,
        "per_page": per_page,
        "total_pages": (total_items + per_page - 1) // per_page if total_items > 0 else 1,
        "warning": "Loaded bundled menu seed because the configured database query failed."
    }

def validate_menu_item(form_data, has_file, is_update=False):
    """Server-side validation for menu items fields."""
    errors = {}
    
    # Dish Name
    name = sanitize_input(form_data.get('name', ''))
    if not name and not is_update:
        errors['name'] = "Dish Name is required."
    elif name and len(name) > 100:
        errors['name'] = "Dish Name must be under 100 characters."

    # Description
    desc = sanitize_input(form_data.get('description', ''))
    if not desc and not is_update:
        errors['description'] = "Description is required."

    # Price
    price_str = form_data.get('price')
    if price_str is not None:
        try:
            price = float(price_str)
            if price < 0:
                errors['price'] = "Price must be a positive number."
        except ValueError:
            errors['price'] = "Price must be a valid number."
    elif not is_update:
        errors['price'] = "Price is required."

    # Category
    category = form_data.get('category')
    if category is not None:
        if category not in CATEGORIES:
            errors['category'] = f"Invalid category. Must be one of: {', '.join(CATEGORIES)}"
    elif not is_update:
        errors['category'] = "Category selection is required."

    # Status
    status = form_data.get('status')
    if status is not None:
        if status not in ["Published", "Draft"]:
            errors['status'] = "Status must be either 'Published' or 'Draft'."

    # Image upload check
    if not is_update and not has_file:
        errors['image_url'] = "Dish Image is required."

    return errors

def slugify(text):
    """Generate a clean slug from dish name."""
    import re
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')

# ==========================================
# IMAGE COMPRESSION & OPTIMIZATION LAYER
# ==========================================
def process_and_save_image(file, slug):
    """Validate, optimize (resize and compress), convert to WebP format, and write to uploads/."""
    try:
        from PIL import Image
    except ImportError:
        return None, "Image processing dependency is not installed. Please verify Pillow is installed in the deployment."

    filename = secure_filename(file.filename)
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in ['.jpg', '.jpeg', '.png', '.webp']:
        return None, "File type not supported. Use JPG, PNG, or WEBP images."

    try:
        # Load image via Pillow
        img = Image.open(file.stream)
    except Exception as e:
        return None, f"Failed to open image file: {str(e)}"

    # Set up uploads dir
    uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
    os.makedirs(uploads_dir, exist_ok=True)
    
    # Save standard optimized filename (e.g. slug_timestamp.webp)
    target_filename = f"{slug}_{int(time.time())}.webp"
    target_path = os.path.join(uploads_dir, target_filename)

    # 1. Resize: maintaining aspect ratio if bounds exceed 1200px
    max_size = 1200
    width, height = img.size
    if width > max_size or height > max_size:
        if width > height:
            new_width = max_size
            new_height = int((height / width) * max_size)
        else:
            new_height = max_size
            new_width = int((width / height) * max_size)
        # Resize using high-quality lanczos resampler
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    # 2. Convert and Compress to WEBP
    try:
        # Preserve transparency layers for PNG uploads if they contain alpha
        if img.mode in ('RGBA', 'LA'):
            # Convert LA to RGBA to ensure broad support in webp formats
            if img.mode == 'LA':
                img = img.convert('RGBA')
            img.save(target_path, 'WEBP', quality=85, optimize=True)
        else:
            # Convert CMYK/others to standard RGB
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img.save(target_path, 'WEBP', quality=85, optimize=True)
            
        return f"uploads/{target_filename}", None
    except Exception as e:
        return None, f"Image compression error: {str(e)}"

# CORS Support for static preview tools (like Live Server running on port 5500)
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    return response

# ==========================================
# PUBLIC ROUTING (FRONTEND & LOGIN)
# ==========================================
@app.route('/')
def home():
    """Render Riko website, dynamics loaded from database."""
    try:
        data = db.get_all(
            collection_name='menu_items',
            sort_col='id',
            sort_dir='ASC',
            page=1,
            per_page=200,
            status_filter='Published'
        )
        menu_items = data['items']
    except Exception as exc:
        print(f"Homepage menu load failed, using bundled seed data: {exc}")
        menu_items = []
        if os.path.exists(db.SEED_FILE):
            with open(db.SEED_FILE, 'r', encoding='utf-8') as f:
                menu_items = [item for item in json.load(f) if item.get('status', 'Published') == 'Published']

    # Build category buckets
    items_by_category = {cat: [] for cat in CATEGORIES}
    for item in menu_items:
        cat = item['category']
        if cat in items_by_category:
            items_by_category[cat].append(item)

    return render_template(
        'index.html',
        categories=CATEGORIES,
        category_ids=CATEGORY_IDS,
        items_by_category=items_by_category
    )

@app.route('/admin', methods=['GET', 'POST'])
def admin_login():
    """Verify administrator password server-side with session state tracking."""
    # Redirect if session is already active
    if session.get('admin_logged_in'):
        return redirect(url_for('admin_dashboard'))

    ip = get_ip()
    
    if request.method == 'POST':
        # 1. Rate Limit Verification
        allowed, error_msg = check_rate_limit(ip)
        if not allowed:
            return render_template('login.html', error=error_msg)

        password_input = request.form.get('password', '')
        
        # 2. Get active password dynamically from environment
        admin_password = os.environ.get('ADMIN_PASSWORD')

        if admin_password and password_input == admin_password:
            # Reset IP lockout history, authorize session
            record_login_attempt(ip, success=True)
            session['admin_logged_in'] = True
            session.permanent = True # session persists for browser lifespan
            return redirect(url_for('admin_dashboard'))
        else:
            # Log attempt failure
            record_login_attempt(ip, success=False)
            return render_template('login.html', error="Invalid administrative password.")

    return render_template('login.html')

@app.route('/admin/logout')
def admin_logout():
    """Terminate authorization session."""
    session.pop('admin_logged_in', None)
    return redirect(url_for('admin_login'))

# ==========================================
# PRIVATE ROUTING (ADMIN DASHBOARD)
# ==========================================
@app.route('/admin/dashboard')
@admin_required
def admin_dashboard():
    """Serve Riko operations admin control panel with Menu CMS, Reservations and Settings views."""
    with open(db.SCHEMA_FILE, 'r', encoding='utf-8') as f:
        schemas = json.load(f)
        
    # Support view navigation parameters
    current_view = request.args.get('view', 'menu_cms')
    if current_view not in ['menu_cms', 'reservations', 'settings']:
        current_view = 'menu_cms'
        
    current_collection = 'menu_items'
        
    return render_template(
        'dashboard.html',
        schemas=schemas,
        current_view=current_view,
        current_collection=current_collection
    )


# ==========================================
# REST API ENDPOINTS (PROTECTED CRUD FOR CMS)
# ==========================================
@app.route('/api/collections/<collection_name>', methods=['GET'])
@admin_required
def api_get_collection(collection_name):
    """Retrieve collection records matching pagination, sorting, search, and category/status filters."""
    # Read sorting/filtering parameters
    search = request.args.get('search', '').strip()
    category = request.args.get('category', '').strip()
    status = request.args.get('status', '').strip()
    sort_col = request.args.get('sort_col', 'id').strip()
    sort_dir = request.args.get('sort_dir', 'DESC').strip()
    
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
    except ValueError:
        page = 1
        per_page = 10

    # Ensure valid database table collection
    with open(db.SCHEMA_FILE, 'r', encoding='utf-8') as f:
        schemas = json.load(f)
    if collection_name not in schemas:
        return jsonify({"success": False, "error": f"Collection '{collection_name}' not found."}), 404

    try:
        data = db.get_all(
            collection_name=collection_name,
            search_query=search,
            sort_col=sort_col,
            sort_dir=sort_dir,
            page=page,
            per_page=per_page,
            category_filter=category if category else None,
            status_filter=status if status else None
        )
    except Exception as exc:
        print(f"Collection fetch failed for {collection_name}: {exc}")
        if collection_name == 'menu_items':
            try:
                fallback_data = load_seed_menu_collection(
                    search_query=search,
                    sort_col=sort_col,
                    sort_dir=sort_dir,
                    page=page,
                    per_page=per_page,
                    category_filter=category if category else None,
                    status_filter=status if status else None
                )
                fallback_data["success"] = True
                fallback_data["details"] = str(exc)
                return jsonify(fallback_data)
            except Exception as fallback_exc:
                print(f"Menu seed fallback failed: {fallback_exc}")
        return jsonify({
            "success": False,
            "error": "Collection fetch failed. Check Supabase URL, service role key, table names, and columns.",
            "details": str(exc)
        }), 500
    return jsonify(data)

@app.route('/api/health/database', methods=['GET'])
@admin_required
def api_database_health():
    """Report database wiring status without exposing credentials."""
    supabase_url = os.environ.get('SUPABASE_URL', '').strip()
    supabase_host = urlsplit(supabase_url).netloc if supabase_url else None
    status = {
        "success": True,
        "database": "supabase" if db.use_supabase() else "sqlite",
        "supabase_host": supabase_host,
        "env": {
            "SUPABASE_URL": bool(os.environ.get('SUPABASE_URL')),
            "SUPABASE_SERVICE_ROLE_KEY": bool(os.environ.get('SUPABASE_SERVICE_ROLE_KEY')),
            "ADMIN_PASSWORD": bool(os.environ.get('ADMIN_PASSWORD')),
            "SECRET_KEY": bool(os.environ.get('SECRET_KEY'))
        },
        "checks": {}
    }

    for collection_name in ["menu_items", "reservations"]:
        try:
            result = db.get_all(collection_name, page=1, per_page=1) if collection_name == "menu_items" else db.get_reservations_filtered(page=1, per_page=1)
            status["checks"][collection_name] = {
                "ok": True,
                "total_items": result.get("total_items", 0)
            }
        except Exception as exc:
            status["success"] = False
            status["checks"][collection_name] = {
                "ok": False,
                "error": str(exc)
            }

    return jsonify(status), 200 if status["success"] else 500

@app.route('/api/collections/<collection_name>/<int:item_id>', methods=['GET'])
@admin_required
def api_get_item(collection_name, item_id):
    """Fetch item record details by database identifier."""
    try:
        item = db.get_by_id(collection_name, item_id)
    except Exception as exc:
        print(f"Collection item fetch failed for {collection_name}/{item_id}: {exc}")
        return jsonify({"success": False, "error": "Collection item fetch failed.", "details": str(exc)}), 500
    if not item:
        return jsonify({"success": False, "error": "Item not found."}), 404
    return jsonify({"success": True, "item": item})

@app.route('/api/collections/<collection_name>', methods=['POST'])
@admin_required
def api_create_item(collection_name):
    """Create a new collection record, generating slugs and optimizing uploaded image files."""
    has_file = 'image_url' in request.files and request.files['image_url'].filename != ''
    
    # 1. Server-side validation
    errors = validate_menu_item(request.form, has_file, is_update=False)
    if errors:
        return jsonify({"success": False, "error": "Validation failed.", "fields": errors}), 400

    # 2. Extract and Sanitize Inputs
    name = sanitize_input(request.form['name'])
    description = sanitize_input(request.form['description'])
    price = float(request.form['price'])
    category = request.form['category']
    status = request.form.get('status', 'Published')
    
    # Auto-generate unique slug
    base_slug = slugify(name)
    slug = base_slug
    counter = 1
    # Ensure slug uniqueness in database table
    while db.get_by_slug(collection_name, slug) is not None:
        slug = f"{base_slug}-{counter}"
        counter += 1

    # 3. Secure and Compress Upload Image
    file = request.files['image_url']
    image_path, upload_err = process_and_save_image(file, slug)
    if upload_err:
        return jsonify({"success": False, "error": upload_err}), 400

    # 4. Insert into database
    data = {
        "name": name,
        "slug": slug,
        "description": description,
        "price": price,
        "category": category,
        "image_url": image_path,
        "status": status
    }
    
    last_id, db_err = db.insert_item(collection_name, data)
    if db_err:
        return jsonify({"success": False, "error": f"Database insertion failed: {db_err}"}), 500

    data["id"] = last_id
    return jsonify({"success": True, "item": data}), 201

@app.route('/api/collections/<collection_name>/<int:item_id>', methods=['POST'])
@admin_required
def api_update_item(collection_name, item_id):
    """Update details of an existing collection item with instant response support."""
    item = db.get_by_id(collection_name, item_id)
    if not item:
        return jsonify({"success": False, "error": "Item not found."}), 404

    has_file = 'image_url' in request.files and request.files['image_url'].filename != ''
    
    # 1. Validation check
    errors = validate_menu_item(request.form, has_file, is_update=True)
    if errors:
        return jsonify({"success": False, "error": "Validation failed.", "fields": errors}), 400

    # 2. Extract modified fields
    update_data = {}
    
    # If Name changed, regenerate slug
    if 'name' in request.form:
        new_name = sanitize_input(request.form['name'])
        if new_name != item['name']:
            update_data['name'] = new_name
            # Rebuild slug
            base_slug = slugify(new_name)
            slug = base_slug
            counter = 1
            while True:
                existing = db.get_by_slug(collection_name, slug)
                if existing is None or existing['id'] == item_id:
                    break
                slug = f"{base_slug}-{counter}"
                counter += 1
            update_data['slug'] = slug

    if 'description' in request.form:
        update_data['description'] = sanitize_input(request.form['description'])
        
    if 'price' in request.form:
        update_data['price'] = float(request.form['price'])
        
    if 'category' in request.form:
        update_data['category'] = request.form['category']
        
    if 'status' in request.form:
        update_data['status'] = request.form['status']

    # 3. Handle image replacement upload
    if has_file:
        file = request.files['image_url']
        current_slug = update_data.get('slug', item['slug'])
        image_path, upload_err = process_and_save_image(file, current_slug)
        if upload_err:
            return jsonify({"success": False, "error": upload_err}), 400
            
        update_data['image_url'] = image_path
        
        # Optional cleanup: remove old uploads from file system
        old_path = os.path.join(os.path.dirname(__file__), item['image_url'])
        # Avoid deleting default assets/ images if they are referenced
        if os.path.exists(old_path) and 'uploads/' in item['image_url']:
            try:
                os.remove(old_path)
            except OSError:
                pass

    if not update_data:
        return jsonify({"success": True, "item": item})

    # 4. Save updates to DB
    ok, db_err = db.update_item(collection_name, item_id, update_data)
    if not ok:
        return jsonify({"success": False, "error": db_err}), 500

    updated_item = db.get_by_id(collection_name, item_id)
    return jsonify({"success": True, "item": updated_item})

@app.route('/api/collections/<collection_name>/<int:item_id>', methods=['PATCH'])
@admin_required
def api_patch_item(collection_name, item_id):
    """Partially modify specific fields (such as status) inline."""
    item = db.get_by_id(collection_name, item_id)
    if not item:
        return jsonify({"success": False, "error": "Item not found."}), 404

    data = get_request_data()
    if not data:
        return jsonify({"success": False, "error": "No data provided."}), 400

    update_data = {}
    if 'status' in data:
        status = data['status']
        if status not in ["Published", "Draft"]:
            return jsonify({"success": False, "error": "Invalid status."}), 400
        update_data['status'] = status

    if not update_data:
        return jsonify({"success": True, "item": item})

    ok, db_err = db.update_item(collection_name, item_id, update_data)
    if not ok:
        return jsonify({"success": False, "error": db_err}), 500

    updated_item = db.get_by_id(collection_name, item_id)
    return jsonify({"success": True, "item": updated_item})

@app.route('/api/collections/<collection_name>/<int:item_id>', methods=['DELETE'])
@admin_required
def api_delete_item(collection_name, item_id):
    """Permanently delete a collection record and clean up local image file uploads."""
    item = db.get_by_id(collection_name, item_id)
    if not item:
        return jsonify({"success": False, "error": "Item not found."}), 404

    # Delete row
    db.delete_item(collection_name, item_id)

    # Clean up uploaded image file
    if 'uploads/' in item['image_url']:
        img_path = os.path.join(os.path.dirname(__file__), item['image_url'])
        if os.path.exists(img_path):
            try:
                os.remove(img_path)
            except OSError:
                pass

    return jsonify({"success": True})

@app.route('/api/collections/<collection_name>/bulk', methods=['POST'])
@admin_required
def api_bulk_action(collection_name):
    """Apply operations (Publish, Draft, Delete) on multiple items simultaneously."""
    data = get_request_data()
    if not data or 'ids' not in data or 'action' not in data:
        return jsonify({"success": False, "error": "Missing ids or action parameters."}), 400

    ids = [int(x) for x in data['ids']]
    action = data['action']

    if not ids:
        return jsonify({"success": True})

    if action == 'publish':
        db.bulk_update_status(collection_name, ids, 'Published')
    elif action == 'draft':
        db.bulk_update_status(collection_name, ids, 'Draft')
    elif action == 'delete':
        # Retrieve filenames for upload file cleanups
        rows = db.get_items_by_ids(collection_name, ids, columns='image_url')

        # Delete from DB
        db.bulk_delete_items(collection_name, ids)

        # File system cleanups
        for row in rows:
            img_url = row['image_url']
            if 'uploads/' in img_url:
                img_path = os.path.join(os.path.dirname(__file__), img_url)
                if os.path.exists(img_path):
                    try:
                        os.remove(img_path)
                    except OSError:
                        pass
    else:
        return jsonify({"success": False, "error": "Invalid bulk operation."}), 400

    return jsonify({"success": True})

# ==========================================
# RESERVATION SYSTEM ROUTING & APIs
# ==========================================
reservation_rate_limits = {}

def is_rate_limited(ip):
    """Simple in-memory rate-limiter (30 seconds window per IP for submission)."""
    now = time.time()
    if ip in reservation_rate_limits:
        last_submission = reservation_rate_limits[ip]
        if now - last_submission < 30:
            return True
    return False

def record_reservation_submission(ip):
    reservation_rate_limits[ip] = time.time()

@app.route('/api/reservations', methods=['POST'])
def api_create_reservation():
    """Submit a new reservation proposal. Rate-limited and validated."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    ip = get_ip()
    if is_rate_limited(ip):
        return jsonify({"success": False, "error": "Rate limit exceeded. Please wait 30 seconds before submitting another booking proposal."}), 429

    # Try JSON body, fallback to URL-encoded form data
    data = get_request_data()
        
    if not data:
        return jsonify({"success": False, "error": "No reservation details provided."}), 400

    name = sanitize_input(data.get('name', ''))
    phone = sanitize_input(data.get('phone', ''))
    guests = data.get('guests')
    date = sanitize_input(data.get('date', ''))
    time_val = sanitize_input(data.get('time', ''))
    special_request = sanitize_input(data.get('special_request', ''))

    errors = {}
    if not name or len(name) < 2:
        errors['name'] = "Full Name is required (minimum 2 characters)."
    if not phone or len(phone) < 8:
        errors['phone'] = "Valid phone coordinates are required."
        
    try:
        guests_count = int(guests)
        if guests_count <= 0 or guests_count > 100:
            errors['guests'] = "Guest count must be between 1 and 100."
    except (ValueError, TypeError):
        errors['guests'] = "Guest count must be a valid number."
        
    if not date:
        errors['date'] = "Desired Date is required."
    if not time_val:
        errors['time'] = "Desired Time is required."

    if errors:
        return jsonify({"success": False, "error": "Validation failed.", "fields": errors}), 400

    # Duplicate checking
    try:
        if db.check_duplicate_reservation(phone, date, time_val):
            return jsonify({"success": False, "error": "A booking proposal for this phone and date/time already exists. To make modifications, please contact the restaurant coordinates directly."}), 400
    except Exception as exc:
        print(f"Reservation duplicate check failed: {exc}")
        return jsonify({
            "success": False,
            "error": "Reservation database check failed. Please try again shortly.",
            "details": str(exc)
        }), 500

    res_data = {
        "name": name,
        "phone": phone,
        "guests": guests_count,
        "date": date,
        "time": time_val,
        "special_request": special_request,
        "status": "New"
    }

    try:
        saved_reservation = db.create_reservation(res_data)
    except Exception as exc:
        print(f"Reservation insert failed: {exc}")
        return jsonify({
            "success": False,
            "error": "Reservation database insertion failed.",
            "details": str(exc)
        }), 500

    last_id = saved_reservation["id"]

    # Create history log entry
    try:
        db.insert_reservation_log(last_id, "Create", None, "New")
    except Exception as exc:
        print(f"Reservation log insert failed for reservation {last_id}: {exc}")

    # Broadcast to SSE announcer
    announcer.announce(json.dumps({
        "type": "new_reservation",
        "item": saved_reservation
    }))

    record_reservation_submission(ip)
    return jsonify({"success": True, "item": saved_reservation}), 201

@app.route('/api/reservations', methods=['GET'])
@admin_required
def api_get_reservations():
    """Retrieve reservations with filtering, search, sorting and pagination."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    search = request.args.get('search', '').strip()
    status = request.args.get('status', '').strip()
    date_filter = request.args.get('date_filter', '').strip()
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()
    
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
    except ValueError:
        page = 1
        per_page = 10

    try:
        data = db.get_reservations_filtered(
            search_query=search if search else None,
            status_filter=status if status else None,
            date_filter=date_filter if date_filter else None,
            start_date=start_date if start_date else None,
            end_date=end_date if end_date else None,
            page=page,
            per_page=per_page
        )
        if data.get("total_items", 0) == 0 and not search and status in ("", "All") and date_filter in ("", "all"):
            direct_data = db.get_all(
                collection_name="reservations",
                sort_col="id",
                sort_dir="DESC",
                page=page,
                per_page=per_page
            )
            if direct_data.get("total_items", 0) > 0:
                data = direct_data
                data["warning"] = "Loaded reservations through direct collection fallback."
        data["success"] = True
        data["database"] = "supabase" if db.use_supabase() else "sqlite"
    except Exception as exc:
        print(f"Reservation inbox fetch failed: {exc}")
        return jsonify({
            "success": False,
            "error": "Reservation inbox fetch failed. Check Supabase URL, service role key, table names, and columns.",
            "details": str(exc)
        }), 500
    return jsonify(data)

@app.route('/api/reservations/<int:res_id>', methods=['GET'])
@admin_required
def api_get_reservation_detail(res_id):
    """Retrieve detailed reservation. Marks the item as read automatically."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    try:
        res = db.get_by_id("reservations", res_id)
    except Exception as exc:
        print(f"Reservation detail fetch failed for {res_id}: {exc}")
        return jsonify({"success": False, "error": "Reservation detail fetch failed.", "details": str(exc)}), 500
    if not res:
        return jsonify({"success": False, "error": "Reservation not found."}), 404
        
    return jsonify({"success": True, "item": res})

@app.route('/api/reservations/<int:res_id>', methods=['PATCH'])
@admin_required
def api_update_reservation(res_id):
    """Update reservation status or read-state, saving status log details."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    try:
        res = db.get_by_id("reservations", res_id)
    except Exception as exc:
        print(f"Reservation status fetch failed for {res_id}: {exc}")
        return jsonify({"success": False, "error": "Reservation status fetch failed.", "details": str(exc)}), 500
    if not res:
        return jsonify({"success": False, "error": "Reservation not found."}), 404

    data = get_request_data()
    update_data = {}
    
    if 'status' in data:
        new_status = data['status']
        if new_status not in ["New", "Confirmed", "Pending", "Completed", "Cancelled"]:
            return jsonify({"success": False, "error": "Invalid reservation status value."}), 400
        
        prev_status = res['status']
        if prev_status != new_status:
            update_data['status'] = new_status
            try:
                db.insert_reservation_log(res_id, "Status Update", prev_status, new_status)
            except Exception as exc:
                print(f"Reservation status log insert failed for {res_id}: {exc}")

    if not update_data:
        return jsonify({"success": True, "item": res})

    ok, db_err = db.update_item("reservations", res_id, update_data)
    if not ok:
        return jsonify({"success": False, "error": db_err}), 500

    try:
        updated_res = db.get_by_id("reservations", res_id)
    except Exception as exc:
        print(f"Reservation refresh failed after update for {res_id}: {exc}")
        return jsonify({"success": False, "error": "Reservation update saved, but refresh failed.", "details": str(exc)}), 500
    
    # Broadcast to SSE announcer
    announcer.announce(json.dumps({
        "type": "reservation_update",
        "item": updated_res
    }))

    return jsonify({"success": True, "item": updated_res})

@app.route('/api/reservations/<int:res_id>', methods=['DELETE'])
@admin_required
def api_delete_reservation(res_id):
    """Permanently delete a reservation from database."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    try:
        res = db.get_by_id("reservations", res_id)
    except Exception as exc:
        print(f"Reservation delete fetch failed for {res_id}: {exc}")
        return jsonify({"success": False, "error": "Reservation delete fetch failed.", "details": str(exc)}), 500
    if not res:
        return jsonify({"success": False, "error": "Reservation not found."}), 404

    try:
        db.delete_item("reservations", res_id)
    except Exception as exc:
        print(f"Reservation delete failed for {res_id}: {exc}")
        return jsonify({"success": False, "error": "Reservation delete failed.", "details": str(exc)}), 500
    
    # Broadcast to SSE announcer
    announcer.announce(json.dumps({
        "type": "reservation_delete",
        "id": res_id
    }))

    return jsonify({"success": True})

@app.route('/api/reservations/counters', methods=['GET'])
@admin_required
def api_get_reservation_counters():
    """Retrieve live stats counters for the dashboard."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    try:
        counts = db.get_reservation_counters()
    except Exception as exc:
        print(f"Reservation counter fetch failed: {exc}")
        return jsonify({"success": False, "error": "Reservation counter fetch failed.", "details": str(exc)}), 500
    return jsonify({"success": True, "counters": counts})

@app.route('/api/reservations/logs/recent', methods=['GET'])
@admin_required
def api_get_recent_logs():
    """Retrieve the last 10 reservation activity logs across the entire system."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    try:
        logs = db.get_recent_reservation_logs(10)
    except Exception as exc:
        print(f"Recent reservation log fetch failed: {exc}")
        return jsonify({"success": False, "error": "Recent reservation log fetch failed.", "details": str(exc)}), 500
    return jsonify({"success": True, "logs": logs})


@app.route('/api/reservations/<int:res_id>/logs', methods=['GET'])
@admin_required
def api_get_reservation_logs(res_id):
    """Retrieve audit history logs trail."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    try:
        logs = db.get_reservation_logs(res_id)
    except Exception as exc:
        print(f"Reservation log fetch failed for {res_id}: {exc}")
        return jsonify({"success": False, "error": "Reservation log fetch failed.", "details": str(exc)}), 500
    return jsonify({"success": True, "logs": logs})

@app.route('/api/reservations/stream')
@admin_required
def stream_reservations():
    """Server-Sent Events stream for real-time notification synchronization."""
    supabase_error = require_supabase_reservations()
    if supabase_error:
        return supabase_error

    messages = announcer.listen()
    def event_stream():
        try:
            # Keepalive initial event
            yield "data: {\"type\": \"ping\"}\n\n"
            while True:
                try:
                    # Timeout prevents blocking forever so we can detect disconnects via ping
                    msg = messages.get(timeout=5.0)
                    yield f"data: {msg}\n\n"
                except queue.Empty:
                    # Yield ping to check if client socket is still active
                    yield "data: {\"type\": \"ping\"}\n\n"
        except (GeneratorExit, ConnectionError, OSError):
            pass
        finally:
            announcer.disconnect(messages)
    return Response(event_stream(), mimetype="text/event-stream")

# ==========================================
# BOOTSTRAP INITIALIZER
# ==========================================
if __name__ == '__main__':

    # Development server only. Vercel imports the Flask app directly.
    port = int(os.environ.get('PORT', 5000))
    print(f"Riko Engine running on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True, threaded=True)
