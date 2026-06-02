import datetime
import json
import os
import shutil
import sqlite3
import urllib.error
import urllib.parse
import urllib.request


BASE_DIR = os.path.dirname(__file__)
BUNDLED_DB_FILE = os.path.join(BASE_DIR, 'riko.db')
DB_FILE = os.path.join('/tmp', 'riko.db') if os.environ.get('VERCEL') else BUNDLED_DB_FILE
SCHEMA_FILE = os.path.join(BASE_DIR, 'schema.json')
SEED_FILE = os.path.join(BASE_DIR, 'menu_items_seed.json')

RESERVATION_FIELDS = {
    'name': 'TEXT NOT NULL DEFAULT ""',
    'phone': 'TEXT NOT NULL DEFAULT ""',
    'guests': 'INTEGER NOT NULL DEFAULT 1',
    'date': 'TEXT NOT NULL DEFAULT ""',
    'time': 'TEXT NOT NULL DEFAULT ""',
    'special_request': 'TEXT',
    'status': 'TEXT NOT NULL DEFAULT "New"',
    'is_read': 'INTEGER NOT NULL DEFAULT 0',
    'created_at': 'TEXT NOT NULL DEFAULT ""',
}

if os.environ.get('VERCEL') and not os.path.exists(DB_FILE) and os.path.exists(BUNDLED_DB_FILE):
    shutil.copyfile(BUNDLED_DB_FILE, DB_FILE)


def use_supabase():
    return bool(os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_SERVICE_ROLE_KEY'))


def _supabase_rest_base_url():
    configured_url = os.environ['SUPABASE_URL'].strip()
    parsed = urllib.parse.urlsplit(configured_url)
    base_without_query = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', '')).rstrip('/')

    if base_without_query.endswith('/rest/v1'):
        return base_without_query
    if '/rest/v1/' in base_without_query:
        return base_without_query.split('/rest/v1/', 1)[0].rstrip('/') + '/rest/v1'
    return f"{base_without_query}/rest/v1"


def get_db_connection():
    if use_supabase():
        raise RuntimeError("Direct SQLite connections are disabled when Supabase is configured.")

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def _supabase_url(table_name, query=''):
    url = f"{_supabase_rest_base_url()}/{table_name}"
    if query:
        url = f"{url}?{query}"
    return url


def _supabase_headers(prefer=None, count=None):
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    if count:
        headers['Prefer'] = f"{headers.get('Prefer')},count={count}" if headers.get('Prefer') else f"count={count}"
    return headers


def _supabase_request(method, table_name, query='', payload=None, prefer=None, count=None):
    body = None
    if payload is not None:
        body = json.dumps(payload).encode('utf-8')

    url = _supabase_url(table_name, query)
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers=_supabase_headers(prefer, count),
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode('utf-8')
            data = json.loads(raw) if raw else None
            return data, response.headers
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode('utf-8')
        try:
            details = json.loads(raw)
        except json.JSONDecodeError:
            details = raw
        raise RuntimeError(f"Supabase {method} {table_name} failed with HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, 'reason', exc)
        raise RuntimeError(f"Supabase {method} {table_name} connection failed: {reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError(f"Supabase {method} {table_name} timed out.") from exc


def _quote_value(value):
    return urllib.parse.quote(str(value), safe='')


def _quote_like(value):
    return urllib.parse.quote(f"*{value}*", safe='*')


def _build_in_filter(item_ids):
    ids = ','.join(str(int(item_id)) for item_id in item_ids)
    return f"in.({ids})"


def _normalize_item(item):
    if not isinstance(item, dict):
        return item
    if 'price' in item and item['price'] is not None:
        item['price'] = float(item['price'])
    if 'guests' in item and item['guests'] is not None:
        item['guests'] = int(item['guests'])
    if 'is_read' in item and item['is_read'] is not None:
        item['is_read'] = int(item['is_read'])
    return item


def _normalize_reservation(item):
    item = _normalize_item(item)
    if not isinstance(item, dict):
        return item

    item['name'] = item.get('name') or 'Guest'
    item['phone'] = item.get('phone') or ''
    item['guests'] = int(item.get('guests') or 1)
    item['date'] = item.get('date') or ''
    item['time'] = item.get('time') or ''
    item['special_request'] = item.get('special_request') or ''
    item['status'] = item.get('status') or 'New'
    item['is_read'] = int(item.get('is_read', 1) or 0)
    item['created_at'] = item.get('created_at') or datetime.datetime.now().isoformat()
    return item


def ensure_reservation_schema():
    """Guarantee the reservation backend tables exist before reads and writes."""
    if use_supabase():
        return

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
    """)
    cursor.execute("PRAGMA table_info(reservations)")
    existing_cols = {row['name'] for row in cursor.fetchall()}
    for name, sql_type in RESERVATION_FIELDS.items():
        if name not in existing_cols:
            cursor.execute(f"ALTER TABLE reservations ADD COLUMN {name} {sql_type}")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reservation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            prev_status TEXT,
            new_status TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()


def _count_from_headers(headers, fallback_count):
    content_range = headers.get('Content-Range')
    if content_range and '/' in content_range:
        total = content_range.rsplit('/', 1)[-1]
        if total.isdigit():
            return int(total)
    return fallback_count


def init_db():
    if use_supabase():
        print("Supabase database configured. SQLite initialization skipped.")
        return

    if not os.path.exists(SCHEMA_FILE):
        print(f"Error: Schema file {SCHEMA_FILE} not found.")
        return

    with open(SCHEMA_FILE, 'r', encoding='utf-8') as f:
        schemas = json.load(f)

    conn = get_db_connection()
    cursor = conn.cursor()

    for col_name, schema in schemas.items():
        table_name = schema.get('table_name', col_name)
        fields_sql = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]

        for field in schema['fields']:
            name = field['name']
            ftype = field['type']
            req = "NOT NULL" if field.get('required') else ""
            unique = "UNIQUE" if field.get('type') == 'slug' else ""

            sql_type = "TEXT"
            if ftype == "number":
                sql_type = "REAL"

            fields_sql.append(f"{name} {sql_type} {req} {unique}".strip())

        sql = f"CREATE TABLE IF NOT EXISTS {table_name} ({', '.join(fields_sql)});"
        cursor.execute(sql)
        print(f"Initialized table: {table_name}")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reservation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            prev_status TEXT,
            new_status TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
    """)
    print("Initialized table: reservation_logs")

    conn.commit()
    conn.close()
    ensure_reservation_schema()
    seed_if_empty()


def seed_if_empty():
    if use_supabase():
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT COUNT(*) FROM menu_items")
        count = cursor.fetchone()[0]
        if count > 0:
            print("Database already contains data. Seeding skipped.")
            conn.close()
            return
    except sqlite3.OperationalError:
        print("Table menu_items does not exist yet. Run init_db first.")
        conn.close()
        return

    if not os.path.exists(SEED_FILE):
        print(f"Seed file {SEED_FILE} not found. Skipping seeding.")
        conn.close()
        return

    print("Seeding database with default menu items...")
    with open(SEED_FILE, 'r', encoding='utf-8') as f:
        items = json.load(f)

    for item in items:
        if 'slug' not in item or not item['slug']:
            item['slug'] = item['name'].lower().replace(' ', '-').replace("'", "").replace('"', "")

        cursor.execute("""
            INSERT OR IGNORE INTO menu_items (name, slug, description, price, category, image_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            item['name'],
            item['slug'],
            item['description'],
            item['price'],
            item['category'],
            item['image_url'],
            item.get('status', 'Published')
        ))

    conn.commit()
    conn.close()
    print("Database seeding completed successfully.")


def get_all(collection_name, search_query=None, sort_col=None, sort_dir="ASC", page=1, per_page=10, category_filter=None, status_filter=None):
    if use_supabase():
        allowed_cols = ['id', 'name', 'phone', 'guests', 'date', 'time', 'special_request', 'status'] if collection_name == 'reservations' else ['id', 'name', 'slug', 'description', 'price', 'category', 'status']
        order_col = sort_col if sort_col in allowed_cols else 'id'
        order_dir = 'desc' if str(sort_dir).upper() == 'DESC' else 'asc'
        offset = (page - 1) * per_page

        params = [
            'select=*',
            f'order={order_col}.{order_dir}',
            f'limit={int(per_page)}',
            f'offset={int(offset)}',
        ]

        if search_query:
            if collection_name == 'reservations':
                or_filter = f"name.ilike.{_quote_like(search_query)},phone.ilike.{_quote_like(search_query)},special_request.ilike.{_quote_like(search_query)}"
            else:
                or_filter = f"name.ilike.{_quote_like(search_query)},description.ilike.{_quote_like(search_query)},category.ilike.{_quote_like(search_query)},status.ilike.{_quote_like(search_query)}"
            params.append(f"or=({or_filter})")

        if category_filter:
            params.append(f"category=eq.{_quote_value(category_filter)}")
        if status_filter:
            params.append(f"status=eq.{_quote_value(status_filter)}")

        items, headers = _supabase_request('GET', collection_name, '&'.join(params), count='exact')
        normalizer = _normalize_reservation if collection_name == 'reservations' else _normalize_item
        items = [normalizer(item) for item in (items or [])]
        total_items = _count_from_headers(headers, len(items))
        return {
            "items": items,
            "total_items": total_items,
            "page": page,
            "per_page": per_page,
            "total_pages": (total_items + per_page - 1) // per_page if total_items > 0 else 1
        }

    conn = get_db_connection()
    cursor = conn.cursor()
    sql = f"SELECT * FROM {collection_name}"
    params = []
    where_clauses = []

    if search_query:
        search_clauses = []
        if collection_name == 'reservations':
            for col in ['name', 'phone', 'special_request']:
                search_clauses.append(f"{col} LIKE ?")
                params.append(f"%{search_query}%")
        else:
            for col in ['name', 'description', 'category', 'status']:
                search_clauses.append(f"{col} LIKE ?")
                params.append(f"%{search_query}%")
        where_clauses.append(f"({ ' OR '.join(search_clauses) })")

    if category_filter:
        where_clauses.append("category = ?")
        params.append(category_filter)
    if status_filter:
        where_clauses.append("status = ?")
        params.append(status_filter)

    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)

    if collection_name == 'reservations':
        allowed_cols = ['id', 'name', 'phone', 'guests', 'date', 'time', 'special_request', 'status']
    else:
        allowed_cols = ['id', 'name', 'slug', 'description', 'price', 'category', 'status']

    if sort_col and sort_col in allowed_cols:
        direction = "DESC" if sort_dir.upper() == "DESC" else "ASC"
        sql += f" ORDER BY {sort_col} {direction}"
    else:
        sql += " ORDER BY id DESC"

    count_sql = f"SELECT COUNT(*) FROM ({sql})"
    cursor.execute(count_sql, params)
    total_items = cursor.fetchone()[0]

    offset = (page - 1) * per_page
    sql += " LIMIT ? OFFSET ?"
    params.extend([per_page, offset])

    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()

    items = [dict(r) for r in rows]
    return {
        "items": items,
        "total_items": total_items,
        "page": page,
        "per_page": per_page,
        "total_pages": (total_items + per_page - 1) // per_page if total_items > 0 else 1
    }


def get_by_id(collection_name, item_id):
    if use_supabase():
        query = f"select=*&id=eq.{int(item_id)}&limit=1"
        rows, _ = _supabase_request('GET', collection_name, query)
        if not rows:
            return None
        return _normalize_reservation(rows[0]) if collection_name == 'reservations' else _normalize_item(rows[0])

    if collection_name == 'reservations':
        ensure_reservation_schema()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {collection_name} WHERE id = ?", (item_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_by_slug(collection_name, slug):
    if use_supabase():
        query = f"select=*&slug=eq.{_quote_value(slug)}&limit=1"
        rows, _ = _supabase_request('GET', collection_name, query)
        return _normalize_item(rows[0]) if rows else None

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {collection_name} WHERE slug = ?", (slug,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_items_by_ids(collection_name, item_ids, columns='*'):
    if not item_ids:
        return []

    if use_supabase():
        query = f"select={urllib.parse.quote(columns, safe='*,')}&id={_build_in_filter(item_ids)}"
        rows, _ = _supabase_request('GET', collection_name, query)
        normalizer = _normalize_reservation if collection_name == 'reservations' else _normalize_item
        return [normalizer(row) for row in (rows or [])]

    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ', '.join(['?'] * len(item_ids))
    cursor.execute(f"SELECT {columns} FROM {collection_name} WHERE id IN ({placeholders})", item_ids)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def insert_item(collection_name, data):
    if use_supabase():
        try:
            rows, _ = _supabase_request('POST', collection_name, payload=data, prefer='return=representation')
            normalizer = _normalize_reservation if collection_name == 'reservations' else _normalize_item
            item = normalizer(rows[0]) if rows else None
            return (item.get('id') if item else None), None
        except RuntimeError as exc:
            return None, str(exc)

    if collection_name == 'reservations':
        ensure_reservation_schema()

    conn = get_db_connection()
    cursor = conn.cursor()

    cols = []
    vals = []
    placeholders = []
    for k, v in data.items():
        cols.append(k)
        vals.append(v)
        placeholders.append("?")

    sql = f"INSERT INTO {collection_name} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
    try:
        cursor.execute(sql, vals)
        conn.commit()
        last_id = cursor.lastrowid
        conn.close()
        return last_id, None
    except sqlite3.IntegrityError as e:
        conn.close()
        return None, str(e)


def create_reservation(data):
    """Persist a reservation and return the saved, normalized record."""
    normalized = _normalize_reservation(dict(data))

    if use_supabase():
        supabase_payload = {
            key: normalized[key]
            for key in ['name', 'phone', 'guests', 'date', 'time', 'special_request', 'status']
            if key in normalized
        }
        rows, _ = _supabase_request(
            'POST',
            'reservations',
            payload=supabase_payload,
            prefer='return=representation'
        )
        if not rows:
            raise RuntimeError("Supabase did not return the created reservation.")
        return _normalize_reservation(rows[0])

    ensure_reservation_schema()
    last_id, err = insert_item('reservations', normalized)
    if err:
        raise RuntimeError(err)

    saved = get_by_id('reservations', last_id)
    if not saved:
        raise RuntimeError("Reservation was inserted but could not be read back.")
    return _normalize_reservation(saved)


def update_item(collection_name, item_id, data):
    if use_supabase():
        try:
            _supabase_request('PATCH', collection_name, f"id=eq.{int(item_id)}", payload=data)
            return True, None
        except RuntimeError as exc:
            return False, str(exc)

    conn = get_db_connection()
    cursor = conn.cursor()

    set_clauses = []
    vals = []
    for k, v in data.items():
        set_clauses.append(f"{k} = ?")
        vals.append(v)

    vals.append(item_id)
    sql = f"UPDATE {collection_name} SET {', '.join(set_clauses)} WHERE id = ?"
    try:
        cursor.execute(sql, vals)
        conn.commit()
        conn.close()
        return True, None
    except sqlite3.IntegrityError as e:
        conn.close()
        return False, str(e)


def delete_item(collection_name, item_id):
    if use_supabase():
        _supabase_request('DELETE', collection_name, f"id=eq.{int(item_id)}")
        return True

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"DELETE FROM {collection_name} WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return True


def bulk_delete_items(collection_name, item_ids):
    if not item_ids:
        return True

    if use_supabase():
        _supabase_request('DELETE', collection_name, f"id={_build_in_filter(item_ids)}")
        return True

    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ', '.join(['?'] * len(item_ids))
    cursor.execute(f"DELETE FROM {collection_name} WHERE id IN ({placeholders})", item_ids)
    conn.commit()
    conn.close()
    return True


def bulk_update_status(collection_name, item_ids, new_status):
    if not item_ids:
        return True

    if use_supabase():
        _supabase_request('PATCH', collection_name, f"id={_build_in_filter(item_ids)}", payload={'status': new_status})
        return True

    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ', '.join(['?'] * len(item_ids))
    sql = f"UPDATE {collection_name} SET status = ? WHERE id IN ({placeholders})"
    cursor.execute(sql, [new_status] + item_ids)
    conn.commit()
    conn.close()
    return True


def insert_reservation_log(reservation_id, action_type, prev_status, new_status):
    now_str = datetime.datetime.now().isoformat()

    if use_supabase():
        _supabase_request('POST', 'reservation_logs', payload={
            'reservation_id': reservation_id,
            'action_type': action_type,
            'prev_status': prev_status,
            'new_status': new_status,
            'timestamp': now_str,
        })
        return True

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO reservation_logs (reservation_id, action_type, prev_status, new_status, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (reservation_id, action_type, prev_status, new_status, now_str))
    conn.commit()
    conn.close()
    return True


def get_reservation_logs(reservation_id):
    if use_supabase():
        query = f"select=*&reservation_id=eq.{int(reservation_id)}&order=timestamp.asc"
        try:
            rows, _ = _supabase_request('GET', 'reservation_logs', query)
        except RuntimeError:
            return []
        return rows or []

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM reservation_logs
        WHERE reservation_id = ?
        ORDER BY timestamp ASC
    """, (reservation_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_recent_reservation_logs(limit=10):
    if use_supabase():
        query = f"select=*,reservations(name)&order=timestamp.desc&limit={int(limit)}"
        try:
            rows, _ = _supabase_request('GET', 'reservation_logs', query)
        except RuntimeError:
            return []
        logs = []
        for row in rows or []:
            reservation = row.pop('reservations', None)
            row['guest_name'] = reservation.get('name') if isinstance(reservation, dict) else None
            logs.append(row)
        return logs

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT rl.*, r.name as guest_name
        FROM reservation_logs rl
        JOIN reservations r ON rl.reservation_id = r.id
        ORDER BY rl.timestamp DESC
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_reservation_counters():
    counts = {"New": 0, "Pending": 0, "Confirmed": 0, "Completed": 0, "Cancelled": 0}

    if use_supabase():
        rows, _ = _supabase_request('GET', 'reservations', 'select=status')
        for row in rows or []:
            status = row.get('status')
            if status in counts:
                counts[status] += 1
        return counts

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT status, COUNT(*) as count
        FROM reservations
        GROUP BY status
    """)
    rows = cursor.fetchall()
    conn.close()

    for r in rows:
        status = r['status']
        if status in counts:
            counts[status] = r['count']
    return counts


def check_duplicate_reservation(phone, date, time):
    if use_supabase():
        query = (
            "select=id"
            f"&phone=eq.{_quote_value(phone)}"
            f"&date=eq.{_quote_value(date)}"
            f"&time=eq.{_quote_value(time)}"
            "&status=neq.Cancelled"
            "&limit=1"
        )
        rows, _ = _supabase_request('GET', 'reservations', query)
        return bool(rows)

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) FROM reservations
        WHERE phone = ? AND date = ? AND time = ? AND status != 'Cancelled'
    """, (phone, date, time))
    count = cursor.fetchone()[0]
    conn.close()
    return count > 0


def mark_reservation_read(item_id, is_read=1):
    if use_supabase():
        _supabase_request('PATCH', 'reservations', f"id=eq.{int(item_id)}", payload={'is_read': int(is_read)})
        return True

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE reservations SET is_read = ? WHERE id = ?", (is_read, item_id))
    conn.commit()
    conn.close()
    return True


def get_reservations_filtered(search_query=None, status_filter=None, date_filter=None, start_date=None, end_date=None, page=1, per_page=10):
    if use_supabase():
        offset = (page - 1) * per_page
        params = [
            'select=*',
            'order=id.desc',
            f'limit={int(per_page)}',
            f'offset={int(offset)}',
        ]

        if search_query:
            params.append(f"or=(name.ilike.{_quote_like(search_query)},phone.ilike.{_quote_like(search_query)})")

        if status_filter and status_filter != 'All':
            params.append(f"status=eq.{_quote_value(status_filter)}")

        today_str = datetime.date.today().isoformat()
        if date_filter == 'today':
            params.append(f"date=eq.{today_str}")
        elif date_filter == 'tomorrow':
            tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
            params.append(f"date=eq.{tomorrow_str}")
        elif date_filter == 'upcoming':
            params.append(f"date=gte.{today_str}")
        elif date_filter == 'custom':
            if start_date:
                params.append(f"date=gte.{_quote_value(start_date)}")
            if end_date:
                params.append(f"date=lte.{_quote_value(end_date)}")

        items, headers = _supabase_request('GET', 'reservations', '&'.join(params), count='exact')
        items = [_normalize_reservation(item) for item in (items or [])]
        total_items = _count_from_headers(headers, len(items))
        return {
            "items": items,
            "total_items": total_items,
            "page": page,
            "per_page": per_page,
            "total_pages": (total_items + per_page - 1) // per_page if total_items > 0 else 1
        }

    ensure_reservation_schema()
    conn = get_db_connection()
    cursor = conn.cursor()

    sql = "SELECT * FROM reservations"
    where_clauses = []
    params = []

    if search_query:
        where_clauses.append("(name LIKE ? OR phone LIKE ?)")
        params.append(f"%{search_query}%")
        params.append(f"%{search_query}%")

    if status_filter and status_filter != 'All':
        where_clauses.append("status = ?")
        params.append(status_filter)

    today_str = datetime.date.today().isoformat()
    if date_filter == 'today':
        where_clauses.append("date = ?")
        params.append(today_str)
    elif date_filter == 'tomorrow':
        tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        where_clauses.append("date = ?")
        params.append(tomorrow_str)
    elif date_filter == 'upcoming':
        where_clauses.append("date >= ?")
        params.append(today_str)
    elif date_filter == 'custom':
        if start_date:
            where_clauses.append("date >= ?")
            params.append(start_date)
        if end_date:
            where_clauses.append("date <= ?")
            params.append(end_date)

    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)

    sql += " ORDER BY id DESC"

    count_sql = f"SELECT COUNT(*) FROM ({sql})"
    cursor.execute(count_sql, params)
    total_items = cursor.fetchone()[0]

    offset = (page - 1) * per_page
    sql += " LIMIT ? OFFSET ?"
    params.extend([per_page, offset])

    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()

    items = [_normalize_reservation(dict(r)) for r in rows]
    return {
        "items": items,
        "total_items": total_items,
        "page": page,
        "per_page": per_page,
        "total_pages": (total_items + per_page - 1) // per_page if total_items > 0 else 1
    }


if __name__ == "__main__":
    init_db()
