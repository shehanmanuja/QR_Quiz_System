import os
import json
import socket
import datetime
import csv
import io
import random
import hmac
import shutil
from functools import wraps
from flask import Flask, render_template, request, jsonify, Response, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__, static_folder='static', template_folder='templates')
APP_ENV = os.environ.get('APP_ENV', 'development').lower()
if APP_ENV == 'production' and (not os.environ.get('SECRET_KEY') or not os.environ.get('ADMIN_USERNAME') or not os.environ.get('ADMIN_PASSWORD')):
    raise RuntimeError('Production requires SECRET_KEY, ADMIN_USERNAME, and ADMIN_PASSWORD environment variables.')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or 'local-development-only-change-before-deploy'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'
app.config['SESSION_COOKIE_SECURE'] = APP_ENV == 'production'
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(hours=8)

# Same-origin by default. Set PUBLIC_ORIGIN only if the frontend is hosted separately.
socketio = SocketIO(app, cors_allowed_origins=os.environ.get('PUBLIC_ORIGIN') or None, async_mode='threading')

BASE_DIR = os.path.dirname(__file__)
SEED_DB_FILE = os.path.join(BASE_DIR, 'data', 'database.json')
DB_FILE = os.environ.get('DATABASE_PATH', SEED_DB_FILE)


def is_admin_authenticated():
    return session.get('is_admin') is True


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin_authenticated():
            if request.path.startswith('/api/'):
                return jsonify({'status': 'error', 'message': 'Admin login required.'}), 401
            return redirect(url_for('admin_login_page'))
        return view(*args, **kwargs)
    return wrapped


def load_db():
    if not os.path.exists(DB_FILE) and DB_FILE != SEED_DB_FILE and os.path.exists(SEED_DB_FILE):
        os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
        shutil.copy2(SEED_DB_FILE, DB_FILE)
    if not os.path.exists(DB_FILE):
        default_db = {
            "questions": [],
            "visitors": [],
            "teams": [],
            "settings": {
                "exhibition_title": "TECHNO 2026 Quiz Challenge",
                "main_stall_name": "Main Stall",
                "require_verification": True
            }
        }
        save_db(default_db)
        return default_db
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            db = json.load(f)
            if 'teams' not in db:
                db['teams'] = []
            if 'forming_group' not in db:
                db['forming_group'] = None
            return db
    except Exception as e:
        print(f"Error reading database: {e}")
        return {"questions": [], "visitors": [], "teams": [], "settings": {}}

def save_db(data):
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"

@app.route('/')
def visitor_page():
    return render_template('index.html')

@app.route('/admin')
def admin_page():
    if not is_admin_authenticated():
        return redirect(url_for('admin_login_page'))
    return render_template('admin.html')


@app.route('/admin/login', methods=['GET'])
def admin_login_page():
    if is_admin_authenticated():
        return redirect(url_for('admin_page'))
    return render_template('login.html')


@app.route('/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or request.form
    username = str(data.get('username', ''))
    password = str(data.get('password', ''))
    expected_username = os.environ.get('ADMIN_USERNAME', '')
    expected_password = os.environ.get('ADMIN_PASSWORD', '')
    if (expected_username and expected_password and
        hmac.compare_digest(username, expected_username) and
        hmac.compare_digest(password, expected_password)):
        session.clear()
        session['is_admin'] = True
        session.permanent = True
        return jsonify({'status': 'success', 'redirect': url_for('admin_page')})
    return jsonify({'status': 'error', 'message': 'Invalid username or password.'}), 401


@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    session.clear()
    return jsonify({'status': 'success', 'redirect': url_for('visitor_page')})

@app.route('/api/info', methods=['GET'])
def get_info():
    local_ip = get_local_ip()
    port = int(os.environ.get('PORT', 5000))
    db = load_db()
    
    stats = get_stats_summary(db)
    
    return jsonify({
        "status": "success",
        "local_ip": local_ip,
        "port": port,
        "server_url": f"http://{local_ip}:{port}",
        "exhibition_title": db.get('settings', {}).get('exhibition_title', 'Exhibition Quiz'),
        "main_stall_name": db.get('settings', {}).get('main_stall_name', 'Main Stall'),
        "stats": stats
    })

@app.route('/api/settings', methods=['POST'])
@admin_required
def update_settings():
    data = request.get_json(force=True, silent=True) or {}
    title = data.get('exhibition_title', '').strip()
    stall = data.get('main_stall_name', '').strip()

    db = load_db()
    if 'settings' not in db:
        db['settings'] = {}
    
    if title:
        db['settings']['exhibition_title'] = title
    if stall:
        db['settings']['main_stall_name'] = stall

    save_db(db)

    info_data = {
        "exhibition_title": db['settings'].get('exhibition_title'),
        "main_stall_name": db['settings'].get('main_stall_name'),
        "stats": get_stats_summary(db)
    }

    socketio.emit('settings_updated', info_data, room='admin_room')
    socketio.emit('stats_update', get_stats_summary(db), room='admin_room')

    return jsonify({
        "status": "success",
        "message": "Settings updated successfully!",
        "settings": db['settings']
    })

@app.route('/api/register', methods=['POST'])
def register_visitor():
    data = request.get_json(force=True, silent=True) or {}
    name = data.get('name', '').strip()
    age = str(data.get('age', '')).strip()
    phone = data.get('phone', '').strip()
    email = data.get('email', '').strip()
    company = data.get('company', '').strip()
    solar_raw = data.get('solar_interest', 'No')
    solar_interest = "Yes" if str(solar_raw).strip().lower() in ['yes', 'true', '1'] else "No"

    if not name or not phone:
        return jsonify({"status": "error", "message": "Name and Phone number are required!"}), 400

    db = load_db()
    visitors = db.get('visitors', [])
    
    # Check if already registered by phone
    existing = next((v for v in visitors if v.get('phone') == phone), None)
    if existing:
        return jsonify({
            "status": "success",
            "message": "Welcome back! Retrieved existing registration.",
            "visitor": existing
        })

    visitor_id = f"EPE{len(visitors) + 1:03d}"
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    new_visitor = {
        "id": visitor_id,
        "name": name,
        "age": age,
        "phone": phone,
        "email": email,
        "company": company,
        "solar_interest": solar_interest,
        "status": "pending_visit",  # pending_visit, verified, in_team, completed
        "team_id": None,
        "registered_at": now_str,
        "verified_at": None
    }
    
    visitors.append(new_visitor)
    db['visitors'] = visitors
    save_db(db)

    # Real-time notification to admin dashboard
    socketio.emit('visitor_registered', new_visitor, room='admin_room')
    socketio.emit('stats_update', get_stats_summary(db), room='admin_room')

    return jsonify({
        "status": "success",
        "message": "Registration successful! Please visit the Main Hall so stall admin can assign you to a 5-player team.",
        "visitor": new_visitor
    })

@app.route('/api/visitor/<visitor_id>', methods=['GET'])
def get_visitor_status(visitor_id):
    db = load_db()
    visitor = next((v for v in db.get('visitors', []) if v.get('id') == visitor_id or v.get('phone') == visitor_id), None)
    if not visitor:
        return jsonify({"status": "error", "message": "Visitor not found"}), 404
    
    team = None
    if visitor.get('team_id'):
        team = next((t for t in db.get('teams', []) if t.get('id') == visitor.get('team_id')), None)

    return jsonify({
        "status": "success",
        "visitor": visitor,
        "team": team,
        "forming_group": db.get('forming_group', None)
    })

@app.route('/api/verify', methods=['POST'])
@admin_required
def verify_visitor():
    data = request.get_json(force=True, silent=True) or {}
    visitor_id = data.get('visitor_id', '').strip()

    if not visitor_id:
        return jsonify({"status": "error", "message": "Visitor ID or Phone is required!"}), 400

    db = load_db()
    visitors = db.get('visitors', [])
    visitor = next((v for v in visitors if v.get('id') == visitor_id or v.get('phone') == visitor_id), None)

    if not visitor:
        return jsonify({"status": "error", "message": "Visitor not found with specified ID or Phone!"}), 404

    # Verify visitor arrival at main hall
    visitor['status'] = 'verified'
    visitor['verified_at'] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    save_db(db)

    socketio.emit('visitor_updated', visitor, room='admin_room')
    socketio.emit('stats_update', get_stats_summary(db), room='admin_room')
    # Real-time event to the specific visitor's device
    socketio.emit('visitor_verified', {"status": "verified", "visitor": visitor}, room=f"visitor_{visitor['id']}")

    return jsonify({
        "status": "success",
        "message": f"Visitor {visitor['name']} ({visitor['id']}) verified & checked in at Main Hall!",
        "visitor": visitor
    })

def select_questions_for_team(db, count=10):
    all_questions = db.get('questions', [])
    if not all_questions:
        return []
    if len(all_questions) <= count:
        return all_questions

    teams = db.get('teams', [])
    last_used_ids = set()
    for t in reversed(teams):
        if 'assigned_question_ids' in t and t['assigned_question_ids']:
            last_used_ids = set(t['assigned_question_ids'])
            break

    # Exclude questions used by the immediately preceding team
    available = [q for q in all_questions if q.get('id') not in last_used_ids]
    if len(available) < count:
        available = list(all_questions)

    selected = random.sample(available, min(count, len(available)))
    return selected

@app.route('/api/group/current', methods=['GET'])
def get_current_group():
    db = load_db()
    return jsonify({"status": "success", "group": db.get('forming_group', None)})

@app.route('/api/group/create', methods=['POST'])
@admin_required
def create_group():
    data = request.get_json(force=True, silent=True) or {}
    custom_name = data.get('team_name', '').strip()
    db = load_db()
    teams = db.get('teams', [])

    team_num = len(teams) + 1
    team_name = custom_name if custom_name else f"Team {team_num:02d}"

    forming_group = {
        "team_name": team_name,
        "members": [],
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    db['forming_group'] = forming_group
    save_db(db)

    payload = {
        "team_name": team_name,
        "members": [],
        "message": f"Group '{team_name}' has been created! Admin is now adding players."
    }
    socketio.emit('group_created', payload)
    socketio.emit('group_updated', payload)

    return jsonify({
        "status": "success",
        "message": f"Group '{team_name}' created successfully!",
        "group": forming_group
    })

@app.route('/api/group/add-member', methods=['POST'])
@admin_required
def add_group_member():
    data = request.get_json(force=True, silent=True) or {}
    visitor_id = data.get('visitor_id', '').strip()
    custom_team_name = data.get('team_name', '').strip()

    if not visitor_id:
        return jsonify({"status": "error", "message": "Visitor ID is required!"}), 400

    db = load_db()
    visitors = db.get('visitors', [])
    teams = db.get('teams', [])

    visitor = next((v for v in visitors if v.get('id') == visitor_id or v.get('phone') == visitor_id), None)
    if not visitor:
        return jsonify({"status": "error", "message": "Visitor not found!"}), 404

    forming = db.get('forming_group')
    if not forming:
        team_num = len(teams) + 1
        team_name = custom_team_name if custom_team_name else f"Team {team_num:02d}"
        forming = {
            "team_name": team_name,
            "members": [],
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        db['forming_group'] = forming
        socketio.emit('group_created', {
            "team_name": team_name,
            "members": [],
            "message": f"Group '{team_name}' has been created!"
        })

    members = forming.get('members', [])
    if any(m.get('id') == visitor['id'] for m in members):
        return jsonify({"status": "error", "message": f"{visitor['name']} is already in this group!"}), 400

    if len(members) >= 5:
        return jsonify({"status": "error", "message": "This group already has 5 players! Click 'Start Quiz' to begin."}), 400

    member_item = {
        "id": visitor["id"],
        "name": visitor["name"],
        "phone": visitor.get("phone", ""),
        "company": visitor.get("company", ""),
        "added_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    members.append(member_item)
    forming['members'] = members
    save_db(db)

    slot_number = len(members)
    update_payload = {
        "team_name": forming['team_name'],
        "members": members,
        "last_added": member_item,
        "slot_number": slot_number,
        "message": f"Player {visitor['name']} ({visitor['id']}) added to {forming['team_name']}! ({slot_number}/5)"
    }
    socketio.emit('group_updated', update_payload)
    socketio.emit('group_player_added', update_payload)
    socketio.emit('you_joined_group', {
        "team_name": forming['team_name'],
        "members": members,
        "slot_number": slot_number
    }, room=f"visitor_{visitor['id']}")

    return jsonify({
        "status": "success",
        "message": f"Added {visitor['name']} to {forming['team_name']} ({slot_number}/5)!",
        "group": forming
    })

@app.route('/api/group/remove-member', methods=['POST'])
@admin_required
def remove_group_member():
    data = request.get_json(force=True, silent=True) or {}
    visitor_id = data.get('visitor_id', '').strip()

    db = load_db()
    forming = db.get('forming_group')
    if not forming:
        return jsonify({"status": "error", "message": "No active group found!"}), 404

    members = [m for m in forming.get('members', []) if m.get('id') != visitor_id]
    forming['members'] = members
    save_db(db)

    update_payload = {
        "team_name": forming['team_name'],
        "members": members,
        "message": f"Player removed from {forming['team_name']}."
    }
    socketio.emit('group_updated', update_payload)

    return jsonify({
        "status": "success",
        "message": "Player removed from group.",
        "group": forming
    })

@app.route('/api/group/auto-form', methods=['POST'])
@admin_required
def auto_form_group():
    data = request.get_json(force=True, silent=True) or {}
    custom_name = data.get('team_name', '').strip()

    db = load_db()
    teams = db.get('teams', [])
    visitors = db.get('visitors', [])

    forming = db.get('forming_group')
    if not forming:
        team_num = len(teams) + 1
        team_name = custom_name if custom_name else f"Team {team_num:02d}"
        forming = {
            "team_name": team_name,
            "members": [],
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        db['forming_group'] = forming

    current_members = forming.get('members', [])
    current_ids = set(m['id'] for m in current_members)

    verified_available = [v for v in visitors if v.get('status') == 'verified' and v.get('id') not in current_ids]

    needed = 5 - len(current_members)
    if needed <= 0:
        return jsonify({"status": "error", "message": "Group already has 5 players!"}), 400

    if len(verified_available) == 0 and len(current_members) == 0:
        return jsonify({"status": "error", "message": "No checked-in visitors available!"}), 400

    to_add = verified_available[:needed]
    for v in to_add:
        current_members.append({
            "id": v["id"],
            "name": v["name"],
            "phone": v.get("phone", ""),
            "company": v.get("company", ""),
            "added_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    forming['members'] = current_members
    save_db(db)

    update_payload = {
        "team_name": forming['team_name'],
        "members": current_members,
        "message": f"Auto-filled {len(to_add)} players into {forming['team_name']}!"
    }
    socketio.emit('group_created', update_payload)
    socketio.emit('group_updated', update_payload)

    for v in to_add:
        socketio.emit('you_joined_group', {
            "team_name": forming['team_name'],
            "members": current_members
        }, room=f"visitor_{v['id']}")

    return jsonify({
        "status": "success",
        "message": f"Auto-filled {len(to_add)} players into {forming['team_name']}!",
        "group": forming
    })

@app.route('/api/group/start-quiz', methods=['POST'])
@admin_required
def start_group_quiz():
    db = load_db()
    forming = db.get('forming_group')
    if not forming or not forming.get('members') or len(forming['members']) == 0:
        return jsonify({"status": "error", "message": "No active group with players found to start quiz!"}), 400

    members = forming['members']
    team_name = forming['team_name']
    member_ids = [m['id'] for m in members]

    teams = db.get('teams', [])
    visitors = db.get('visitors', [])

    for t in teams:
        if t.get('status') == 'unlocked':
            t['status'] = 'completed'

    team_num = len(teams) + 1
    team_id = f"TEAM{team_num:03d}"
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    assigned_questions = select_questions_for_team(db, count=10)
    assigned_question_ids = [q.get('id') for q in assigned_questions]

    new_team = {
        "id": team_id,
        "team_name": team_name,
        "member_ids": member_ids,
        "members": members,
        "status": "unlocked",
        "unlocked_at": now_str,
        "completed_at": None,
        "player_submissions": {},
        "winner_player": None,
        "assigned_questions": assigned_questions,
        "assigned_question_ids": assigned_question_ids
    }

    for v in visitors:
        if v.get('id') in member_ids:
            v['status'] = 'in_team'
            v['team_id'] = team_id

    teams.append(new_team)
    db['teams'] = teams
    db['visitors'] = visitors
    db['forming_group'] = None  # Clear active forming group
    save_db(db)

    # Unlock quiz for all members in the team!
    for m in members:
        v_obj = next((item for item in visitors if item.get('id') == m['id']), m)
        socketio.emit('quiz_unlocked', {
            "visitor": v_obj,
            "team": new_team
        }, room=f"visitor_{m['id']}")

    socketio.emit('group_started', {"team": new_team})
    socketio.emit('group_updated', None)
    socketio.emit('team_created', new_team, room='admin_room')
    socketio.emit('leaderboard_update', get_leaderboard(db), room='admin_room')
    socketio.emit('stats_update', get_stats_summary(db), room='admin_room')

    return jsonify({
        "status": "success",
        "message": f"Team '{team_name}' started! Quiz unlocked for {len(members)} players.",
        "team": new_team
    })

@app.route('/api/group/cancel', methods=['POST'])
@admin_required
def cancel_group():
    db = load_db()
    db['forming_group'] = None
    save_db(db)
    socketio.emit('group_cancelled', {"message": "Active group formation was cancelled by admin."})
    socketio.emit('group_updated', None)
    return jsonify({"status": "success", "message": "Group formation cancelled."})

@app.route('/api/create-team', methods=['POST'])
@admin_required
def create_team():
    data = request.get_json(force=True, silent=True) or {}
    member_ids = data.get('member_ids', [])
    custom_team_name = data.get('team_name', '').strip()

    if not member_ids or not isinstance(member_ids, list) or len(member_ids) == 0:
        return jsonify({"status": "error", "message": "At least 1 visitor must be selected for the team!"}), 400

    db = load_db()
    visitors = db.get('visitors', [])
    teams = db.get('teams', [])

    selected_members = []
    for m_id in member_ids:
        v = next((item for item in visitors if item.get('id') == m_id or item.get('phone') == m_id), None)
        if v:
            selected_members.append(v)

    if len(selected_members) == 0:
        return jsonify({"status": "error", "message": "No valid visitors found for specified IDs!"}), 400

    # Mark any previously unlocked team as finished if a new active match starts
    for t in teams:
        if t.get('status') == 'unlocked':
            t['status'] = 'completed'

    team_num = len(teams) + 1
    team_id = f"TEAM{team_num:03d}"
    team_name = custom_team_name if custom_team_name else f"Team {team_num:02d}"

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    member_summary = [{
        "id": m["id"],
        "name": m["name"],
        "phone": m["phone"],
        "company": m.get("company", "")
    } for m in selected_members]

    # Select 10 non-repeating questions from question pool for this team
    assigned_questions = select_questions_for_team(db, count=10)
    assigned_question_ids = [q.get('id') for q in assigned_questions]

    new_team = {
        "id": team_id,
        "team_name": team_name,
        "member_ids": [m["id"] for m in selected_members],
        "members": member_summary,
        "status": "unlocked",
        "unlocked_at": now_str,
        "completed_at": None,
        "player_submissions": {},
        "winner_player": None,
        "assigned_questions": assigned_questions,
        "assigned_question_ids": assigned_question_ids
    }

    # Update visitors to in_team
    for m in selected_members:
        m['status'] = 'in_team'
        m['team_id'] = team_id

    teams.append(new_team)
    db['teams'] = teams
    db['visitors'] = visitors
    save_db(db)

    # Emit real-time quiz unlock to each team member's socket room!
    for m in selected_members:
        socketio.emit('quiz_unlocked', {
            "visitor": m,
            "team": new_team
        }, room=f"visitor_{m['id']}")

    socketio.emit('team_created', new_team, room='admin_room')
    socketio.emit('leaderboard_update', get_leaderboard(db), room='admin_room')
    socketio.emit('stats_update', get_stats_summary(db), room='admin_room')

    return jsonify({
        "status": "success",
        "message": f"Team '{team_name}' formed with {len(selected_members)} players! Quiz unlocked for 5-player round.",
        "team": new_team
    })

@app.route('/api/questions', methods=['GET', 'POST'])
def handle_questions():
    db = load_db()
    if request.method in ['GET', 'HEAD']:
        is_admin = request.args.get('admin', 'false').lower() == 'true'
        visitor_id = request.args.get('visitor_id', '').strip()
        team_id_arg = request.args.get('team_id', '').strip()

        all_questions = db.get('questions', [])
        
        if is_admin:
            if not is_admin_authenticated():
                return jsonify({"status": "error", "message": "Admin login required."}), 401
            return jsonify({"status": "success", "questions": all_questions})

        target_team = None
        if team_id_arg:
            target_team = next((t for t in db.get('teams', []) if t.get('id') == team_id_arg), None)
        elif visitor_id:
            visitor = next((v for v in db.get('visitors', []) if v.get('id') == visitor_id or v.get('phone') == visitor_id), None)
            if visitor and visitor.get('team_id'):
                target_team = next((t for t in db.get('teams', []) if t.get('id') == visitor.get('team_id')), None)

        if target_team and target_team.get('assigned_questions'):
            team_questions = target_team.get('assigned_questions')
        else:
            team_questions = all_questions[:10]
        
        # Hide correct answer from visitor payload
        sanitized = []
        for q in team_questions:
            q_copy = dict(q)
            if 'correct' in q_copy:
                del q_copy['correct']
            sanitized.append(q_copy)
        return jsonify({"status": "success", "questions": sanitized})

    elif request.method == 'POST':
        if not is_admin_authenticated():
            return jsonify({"status": "error", "message": "Admin login required."}), 401
        data = request.get_json(force=True, silent=True) or {}
        new_questions = data.get('questions', [])
        if not isinstance(new_questions, list):
            return jsonify({"status": "error", "message": "Questions must be a list!"}), 400

        db['questions'] = new_questions
        save_db(db)
        return jsonify({"status": "success", "message": "Questions updated successfully!", "questions": new_questions})

@app.route('/api/submit-quiz', methods=['POST'])
def submit_quiz():
    data = request.get_json(force=True, silent=True) or {}
    visitor_id = data.get('visitor_id', '').strip()
    team_id_input = data.get('team_id', '').strip()
    answers = data.get('answers', [])
    time_taken_seconds = float(data.get('time_taken_seconds', 0))

    db = load_db()
    teams = db.get('teams', [])
    visitors = db.get('visitors', [])

    visitor = next((v for v in visitors if v.get('id') == visitor_id or v.get('phone') == visitor_id), None)
    if not visitor:
        return jsonify({"status": "error", "message": "Visitor profile not found!"}), 404

    team = None
    if team_id_input:
        team = next((t for t in teams if t.get('id') == team_id_input), None)
    
    if not team and visitor.get('team_id'):
        team = next((t for t in teams if t.get('id') == visitor.get('team_id')), None)
        
    if not team:
        team = next((t for t in teams if visitor['id'] in t.get('member_ids', [])), None)

    if not team:
        return jsonify({"status": "error", "message": "Team not found for submission!"}), 404

    # Use questions assigned to this team
    assigned_q = team.get('assigned_questions')
    if not assigned_q:
        assigned_q = db.get('questions', [])[:10]

    score = 0
    total_q = len(assigned_q)

    all_db_q = db.get('questions', [])
    for i, q in enumerate(assigned_q):
        q_id = q.get('id')
        correct_opt = q.get('correct')
        if correct_opt is None:
            full_q = next((item for item in all_db_q if item.get('id') == q_id), None)
            if full_q:
                correct_opt = full_q.get('correct')

        ans = None
        if q_id is not None:
            ans = next((a for a in answers if a.get('question_id') == q_id), None)
        
        if ans is None and i < len(answers):
            ans = answers[i]

        if ans is not None:
            selected = ans.get('selected_option')
            if selected is not None and str(selected) == str(correct_opt):
                score += 1

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Update individual visitor record
    visitor['status'] = 'completed'
    visitor['score'] = score
    visitor['total_questions'] = total_q
    visitor['time_taken_seconds'] = time_taken_seconds
    visitor['completed_at'] = now_str

    if 'player_submissions' not in team or not isinstance(team['player_submissions'], dict):
        team['player_submissions'] = {}

    team['player_submissions'][visitor['id']] = {
        "visitor_id": visitor['id'],
        "name": visitor.get('name', 'Visitor'),
        "phone": visitor.get('phone', ''),
        "company": visitor.get('company', ''),
        "score": score,
        "total_questions": total_q,
        "time_taken_seconds": time_taken_seconds,
        "completed_at": now_str
    }

    # Count total expected team members and submitted count
    total_expected = len(team.get('member_ids', []))
    submitted_count = len(team['player_submissions'])

    # Emit progress update event to all player rooms in the team
    progress_payload = {
        "team_id": team['id'],
        "submitted_count": submitted_count,
        "total_players": total_expected
    }
    for m_id in team.get('member_ids', []):
        socketio.emit('team_progress_update', progress_payload, room=f"visitor_{m_id}")

    # Check if ALL team members have submitted answers
    if submitted_count >= total_expected:
        team['status'] = 'completed'
        team['completed_at'] = now_str

        # Rank all 5 players in this 5-Player Team match
        match_submissions = list(team['player_submissions'].values())
        match_submissions.sort(key=lambda x: (-x.get('score', 0), x.get('time_taken_seconds', 999999), x.get('completed_at', '9999-99-99')))

        winner_player = match_submissions[0] if match_submissions else None
        team['winner_player'] = winner_player

        save_db(db)

        # Broadcast FINAL MATCH COMPLETED results to every player room in the team!
        this_visitor_res = None
        for m_id in team.get('member_ids', []):
            m_visitor = next((item for item in visitors if item.get('id') == m_id), None)
            m_sub = team['player_submissions'].get(m_id, {})
            p_rank = 1
            for idx, sub in enumerate(match_submissions):
                if sub.get('visitor_id') == m_id:
                    p_rank = idx + 1
                    break

            res_payload = {
                "visitor_id": m_id,
                "visitor_name": m_visitor.get('name') if m_visitor else m_sub.get('name', 'Visitor'),
                "team_id": team.get('id'),
                "team_name": team.get('team_name'),
                "score": m_sub.get('score', 0),
                "total_questions": total_q,
                "time_taken_seconds": m_sub.get('time_taken_seconds', 0),
                "rank_in_team": p_rank,
                "total_team_players": total_expected,
                "is_winner": (p_rank == 1),
                "winner_name": winner_player.get('name') if winner_player else 'Player',
                "winner_score": winner_player.get('score') if winner_player else 0,
                "winner_time": winner_player.get('time_taken_seconds') if winner_player else 0
            }
            if m_id == visitor_id:
                this_visitor_res = res_payload

            socketio.emit('quiz_completed', res_payload, room=f"visitor_{m_id}")

        socketio.emit('leaderboard_update', get_leaderboard(db), room='admin_room')
        socketio.emit('stats_update', get_stats_summary(db), room='admin_room')

        return jsonify({
            "status": "completed",
            "message": "All team members submitted! Match winner calculated.",
            "submitted_count": submitted_count,
            "total_players": total_expected,
            "result": this_visitor_res
        })
    else:
        save_db(db)
        socketio.emit('leaderboard_update', get_leaderboard(db), room='admin_room')
        socketio.emit('stats_update', get_stats_summary(db), room='admin_room')

        return jsonify({
            "status": "pending_others",
            "message": f"Quiz submitted! Waiting for remaining team members ({submitted_count}/{total_expected})...",
            "submitted_count": submitted_count,
            "total_players": total_expected
        })

@app.route('/api/visitors', methods=['GET'])
@admin_required
def get_visitors():
    db = load_db()
    return jsonify({
        "status": "success", 
        "visitors": db.get('visitors', []),
        "teams": db.get('teams', [])
    })

@app.route('/api/export-visitors', methods=['GET'])
@admin_required
def export_visitors():
    db = load_db()
    visitors = db.get('visitors', [])
    teams = db.get('teams', [])
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write CSV Header
    writer.writerow([
        "Visitor ID", "Visitor Name", "Age", "Phone", "Email", "Company", 
        "Solar Interested", "Status", "Assigned Team ID", "Registered At", "Verified At"
    ])
    
    for v in visitors:
        writer.writerow([
            v.get('id', ''),
            v.get('name', ''),
            v.get('age', ''),
            v.get('phone', ''),
            v.get('email', ''),
            v.get('company', ''),
            v.get('solar_interest', 'No'),
            v.get('status', ''),
            v.get('team_id', '-'),
            v.get('registered_at', ''),
            v.get('verified_at', '')
        ])
    
    writer.writerow([])
    writer.writerow(["--- TEAMS PERFORMANCE LEADERBOARD ---"])
    writer.writerow(["Team ID", "Team Name", "Players Count", "Players Names", "Status", "Score", "Total Questions", "Time Taken (s)", "Unlocked At", "Completed At"])
    
    for t in teams:
        member_names = ", ".join([m.get('name', '') for m in t.get('members', [])])
        writer.writerow([
            t.get('id', ''),
            t.get('team_name', ''),
            len(t.get('members', [])),
            member_names,
            t.get('status', ''),
            t.get('score', 0),
            t.get('total_questions', 0),
            t.get('time_taken_seconds', 0),
            t.get('unlocked_at', ''),
            t.get('completed_at', '')
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=Exhibition_Visitors_And_Teams.csv"}
    )

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard_route():
    db = load_db()
    return jsonify({"status": "success", "leaderboard": get_leaderboard(db)})

@app.route('/api/reset', methods=['POST'])
@admin_required
def reset_data():
    db = load_db()
    db['visitors'] = []
    db['teams'] = []
    save_db(db)
    
    socketio.emit('data_reset', {}, room='admin_room')
    socketio.emit('data_reset', {})
    socketio.emit('stats_update', get_stats_summary(db), room='admin_room')
    
    return jsonify({"status": "success", "message": "All visitor registrations and team data reset successfully!"})

def get_leaderboard(db):
    teams = db.get('teams', [])
    visitors = db.get('visitors', [])

    # Active Match (currently playing team)
    active_team = next((t for t in teams if t.get('status') == 'unlocked'), None)
    active_payload = None
    if active_team:
        subs = active_team.get('player_submissions', {})
        active_payload = {
            "id": active_team.get('id'),
            "team_name": active_team.get('team_name'),
            "unlocked_at": active_team.get('unlocked_at'),
            "total_players": len(active_team.get('member_ids', [])),
            "submitted_count": len(subs),
            "members": active_team.get('members', []),
            "submissions": list(subs.values())
        }

    # Completed Match Rounds
    round_matches = []
    for t in teams:
        subs = list(t.get('player_submissions', {}).values())
        if len(subs) > 0 or t.get('status') == 'completed':
            subs.sort(key=lambda x: (-x.get('score', 0), x.get('time_taken_seconds', 999999), x.get('completed_at', '9999-99-99')))
            winner = subs[0] if subs else None
            round_matches.append({
                "team_id": t.get('id'),
                "team_name": t.get('team_name'),
                "unlocked_at": t.get('unlocked_at'),
                "completed_at": t.get('completed_at'),
                "status": t.get('status'),
                "winner_player": winner,
                "all_players": subs,
                "members": t.get('members', [])
            })

    # Top Individual Players across all match rounds
    top_players = [v for v in visitors if v.get('status') == 'completed' and 'score' in v]
    top_players.sort(key=lambda x: (-x.get('score', 0), x.get('time_taken_seconds', 999999), x.get('completed_at', '9999-99-99')))

    return {
        "active_match": active_payload,
        "round_matches": round_matches,
        "top_players": top_players[:20]
    }

def get_stats_summary(db):
    visitors = db.get('visitors', [])
    teams = db.get('teams', [])
    total_registered = len(visitors)
    total_verified = sum(1 for v in visitors if v.get('status') in ['verified', 'in_team', 'completed'])
    total_pending = sum(1 for v in visitors if v.get('status') == 'pending_visit')
    total_teams = len(teams)
    total_completed_teams = sum(1 for t in teams if t.get('status') == 'completed')
    
    avg_score = 0
    if total_completed_teams > 0:
        completed_scores = [t.get('score', 0) for t in teams if t.get('status') == 'completed']
        avg_score = round(sum(completed_scores) / total_completed_teams, 1)

    return {
        "total_registered": total_registered,
        "total_verified": total_verified,
        "total_pending": total_pending,
        "total_teams": total_teams,
        "total_completed": total_completed_teams,
        "avg_score": avg_score
    }

# SocketIO Events
@socketio.on('join_visitor')
def handle_join_visitor(data):
    visitor_id = data.get('visitor_id')
    if visitor_id:
        room = f"visitor_{visitor_id}"
        join_room(room)
        print(f"Visitor joined room: {room}")
        db = load_db()
        visitor = next((v for v in db.get('visitors', []) if v.get('id') == visitor_id), None)
        team = None
        if visitor and visitor.get('team_id'):
            team = next((t for t in db.get('teams', []) if t.get('id') == visitor.get('team_id')), None)
        emit('visitor_status', {"visitor": visitor, "team": team, "forming_group": db.get('forming_group', None)})

@socketio.on('visitor_ready')
def handle_visitor_ready(data):
    visitor_id = data.get('visitor_id') if data else None
    print(f"Visitor ready event received for: {visitor_id}")
    emit('visitor_ready_ack', {"visitor_id": visitor_id, "status": "ready"})

@socketio.on('join_admin')
def handle_join_admin(data=None):
    if not is_admin_authenticated():
        emit('admin_auth_required', {'message': 'Please log in to the admin dashboard.'})
        return
    join_room('admin_room')
    print("Admin joined admin_room")
    db = load_db()
    emit('stats_update', get_stats_summary(db))
    emit('leaderboard_update', get_leaderboard(db))
    emit('group_updated', {"group": db.get('forming_group', None)})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    local_ip = get_local_ip()
    print("\n" + "="*60)
    print(" [>] EXHIBITION QR QUIZ SYSTEM READY!")
    print(f" [*] Main Stall Admin Dashboard: http://{local_ip}:{port}/admin")
    print(f" [*] Mobile Visitor Scan URL:    http://{local_ip}:{port}/")
    print("="*60 + "\n")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
