"""Hospital Management System - Flask backend.
MySQL  -> structured operational data (patients, doctors, appointments, billing, beds)
MongoDB -> flexible clinical documents (reports, prescriptions, lab results)
The frontend only talks to these REST APIs, never to a database directly."""
import datetime as dt
import re
from decimal import Decimal
from functools import wraps

import pymysql
from pymysql.cursors import DictCursor
from flask import Flask, g, jsonify, request, session
from flask.json.provider import DefaultJSONProvider
from werkzeug.security import check_password_hash, generate_password_hash

import config
import mongo_db


class JSONProvider(DefaultJSONProvider):
    @staticmethod
    def default(o):
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, dt.datetime):
            return o.strftime("%Y-%m-%d %H:%M")
        if isinstance(o, dt.date):
            return o.isoformat()
        return DefaultJSONProvider.default(o)


app = Flask(__name__, static_folder="static", static_url_path="")
app.json = JSONProvider(app)
app.secret_key = config.SECRET_KEY
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")


# ------------------------------------------------------------ MySQL helpers
def db():
    if "db" not in g:
        g.db = pymysql.connect(host=config.MYSQL_HOST, port=config.MYSQL_PORT, user=config.MYSQL_USER,
                               password=config.MYSQL_PASSWORD, database=config.MYSQL_DB,
                               charset="utf8mb4", cursorclass=DictCursor, autocommit=True)
    return g.db


@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def query(sql, args=(), one=False):
    with db().cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=()):
    with db().cursor() as cur:
        cur.execute(sql, args)
        return cur.lastrowid, cur.rowcount


def call_proc(name, args):
    with db().cursor() as cur:
        cur.callproc(name, args)
        rows = cur.fetchall()
        while cur.nextset():
            pass
    return rows


def update_row(table, pk_col, pk, data, allowed):
    sets = {k: data[k] for k in allowed if k in data}
    if not sets:
        raise ValueError("Nothing to update")
    sql = "UPDATE %s SET %s WHERE %s=%%s" % (table, ", ".join("%s=%%s" % k for k in sets), pk_col)
    _, n = execute(sql, list(sets.values()) + [pk])
    return n


# --------------------------------------------------------------- validation
def need(data, *fields):
    for f in fields:
        if data.get(f) in (None, ""):
            raise ValueError("%s is required" % f.replace("_", " ").capitalize())


def clean_patient(data, partial=False):
    out = {}
    if not partial:
        need(data, "name", "date_of_birth", "gender", "phone")
    if "name" in data:
        out["name"] = str(data["name"]).strip()[:100]
        if not out["name"]:
            raise ValueError("Name is required")
    if "date_of_birth" in data:
        try:
            d = dt.date.fromisoformat(str(data["date_of_birth"]))
        except ValueError:
            raise ValueError("Date of birth must look like 1990-05-21")
        if d > dt.date.today():
            raise ValueError("Date of birth cannot be in the future")
        out["date_of_birth"] = d.isoformat()
    if "gender" in data:
        if data["gender"] not in ("Male", "Female", "Other"):
            raise ValueError("Gender must be Male, Female or Other")
        out["gender"] = data["gender"]
    if "phone" in data:
        if not re.fullmatch(r"[0-9+\- ]{7,15}", str(data["phone"]).strip()):
            raise ValueError("Phone must be 7-15 digits")
        out["phone"] = str(data["phone"]).strip()
    for f, n in (("address", 255), ("blood_group", 5)):
        if f in data:
            out[f] = (str(data[f]).strip()[:n] or None) if data[f] is not None else None
    return out


def clean_doctor(data, partial=False):
    if not partial:
        need(data, "name", "specialization", "phone", "email")
    out = {k: str(data[k]).strip() for k in ("name", "specialization", "phone", "email") if k in data}
    if "email" in out and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", out["email"]):
        raise ValueError("Enter a valid email address")
    if "consultation_fee" in data and data["consultation_fee"] not in (None, ""):
        out["consultation_fee"] = money(data["consultation_fee"], "Consultation fee")
    return out


def money(v, label="Amount"):
    try:
        d = Decimal(str(v))
    except Exception:
        raise ValueError("%s must be a number" % label)
    if d < 0 or d > Decimal("99999999"):
        raise ValueError("%s must be between 0 and 99,999,999" % label)
    return d


def parse_dt(value):
    try:
        return dt.datetime.fromisoformat(str(value).replace("T", " ")).replace(microsecond=0)
    except ValueError:
        raise ValueError("Choose a valid date and time")


def maybe_create_login(data, role, patient_id=None, doctor_id=None):
    """Optional login creation when admin adds a doctor/patient with credentials."""
    username, password = (data.get("username") or "").strip(), data.get("password") or ""
    if not username and not password:
        return
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,50}", username):
        raise ValueError("Username must be 3-50 letters, digits, dot, dash or underscore")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters")
    execute("INSERT INTO Users (username,password_hash,role,patient_id,doctor_id) VALUES (%s,%s,%s,%s,%s)",
            (username, generate_password_hash(password), role, patient_id, doctor_id))


# ------------------------------------------------------------------- auth
def user():
    return session.get("user")


def access(*roles):
    def deco(f):
        @wraps(f)
        def wrapper(*a, **kw):
            u = user()
            if not u:
                return jsonify(error="Please log in"), 401
            if roles and u["role"] not in roles:
                return jsonify(error="You do not have permission to do this"), 403
            return f(*a, **kw)
        return wrapper
    return deco


@app.errorhandler(ValueError)
def on_value_error(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(pymysql.MySQLError)
def on_mysql_error(e):
    code = e.args[0] if e.args else 0
    msg = e.args[1] if len(e.args) > 1 else str(e)
    if code == 1644:
        return jsonify(error=msg), 409
    if code == 1062:
        m = re.search(r"for key '(?:\w+\.)?(\w+)'", msg)
        key = m.group(1) if m else ""
        text = {"uq_bed_patient": "This patient already has a bed", "username": "That username is taken",
                "email": "That email is already used"}.get(key, "That record already exists")
        return jsonify(error=text), 409
    if code in (1451, 1217):
        return jsonify(error="Cannot delete: other records still depend on this one"), 409
    if code == 1452:
        return jsonify(error="The referenced patient or doctor does not exist"), 400
    if code in (3819, 4025):
        return jsonify(error="A value is outside the allowed range"), 400
    app.logger.exception("MySQL error")
    return jsonify(error="Database error. Check that MySQL is running."), 500


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    row = query("SELECT * FROM Users WHERE username=%s", (str(data.get("username", "")).strip(),), one=True)
    if not row or not check_password_hash(row["password_hash"], data.get("password") or ""):
        return jsonify(error="Wrong username or password"), 401
    name = "Administrator"
    if row["role"] == "doctor":
        name = query("SELECT name FROM Doctor WHERE doctor_id=%s", (row["doctor_id"],), one=True)["name"]
    elif row["role"] == "patient":
        name = query("SELECT name FROM Patient WHERE patient_id=%s", (row["patient_id"],), one=True)["name"]
    session["user"] = {"user_id": row["user_id"], "username": row["username"], "role": row["role"],
                       "patient_id": row["patient_id"], "doctor_id": row["doctor_id"], "name": name}
    return jsonify(session["user"])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    return jsonify(user=user())


@app.get("/api/health")
def health():
    _, mode = mongo_db.get_db()
    try:
        query("SELECT 1")
        mysql_ok = True
    except Exception:
        mysql_ok = False
    return jsonify(mysql=mysql_ok, mongo=mode)


@app.post("/api/register")
def register():
    """Patient self-registration: creates Patient row (MySQL) + login."""
    data = request.get_json(silent=True) or {}
    clean = clean_patient(data)
    need(data, "username", "password")
    c = db()
    c.begin()
    try:
        pid, _ = execute("INSERT INTO Patient (name,date_of_birth,gender,phone,address,blood_group) VALUES (%s,%s,%s,%s,%s,%s)",
                         (clean["name"], clean["date_of_birth"], clean["gender"], clean["phone"],
                          clean.get("address"), clean.get("blood_group")))
        maybe_create_login(data, "patient", patient_id=pid)
        c.commit()
    except Exception:
        c.rollback()
        raise
    return jsonify(patient_id=pid), 201


# --------------------------------------------------------------- dashboard
@app.get("/api/stats")
@access("admin")
def stats():
    mdb, mode = mongo_db.get_db()
    one = lambda sql: list(query(sql, one=True).values())[0]
    return jsonify(
        mysql={
            "patients": one("SELECT COUNT(*) FROM Patient"),
            "doctors": one("SELECT COUNT(*) FROM Doctor"),
            "staff": one("SELECT COUNT(*) FROM Staff"),
            "appointments_today": one("SELECT COUNT(*) FROM Appointment WHERE DATE(date_time)=CURDATE() AND status<>'Cancelled'"),
            "appointments_upcoming": one("SELECT COUNT(*) FROM Appointment WHERE date_time>=NOW() AND status='Scheduled'"),
            "beds_total": one("SELECT COUNT(*) FROM RoomBed"),
            "beds_occupied": one("SELECT COUNT(*) FROM RoomBed WHERE status='Occupied'"),
            "outstanding": float(one("SELECT COALESCE(SUM(amount),0) FROM Bill WHERE payment_status<>'Paid'")),
            "collected": float(one("SELECT COALESCE(SUM(amount),0) FROM Bill WHERE payment_status='Paid'")),
        },
        mongo={"mode": mode, **{k: mdb[v].count_documents({}) for k, v in mongo_db.COLLECTIONS.items()}},
        upcoming=query("SELECT appointment_id, patient_name, doctor_name, date_time, status FROM vw_appointment_details "
                       "WHERE date_time>=NOW() AND status='Scheduled' ORDER BY date_time LIMIT 5"),
    )


# ---------------------------------------------------------------- patients
@app.get("/api/patients")
@access("admin", "doctor")
def patients_list():
    q = (request.args.get("q") or "").strip()
    if q:
        like = "%" + q + "%"
        rows = query("SELECT * FROM Patient WHERE name LIKE %s OR phone LIKE %s OR patient_id=%s ORDER BY name",
                     (like, like, q if q.isdigit() else -1))
    else:
        rows = query("SELECT * FROM Patient ORDER BY name")
    return jsonify(rows)


@app.post("/api/patients")
@access("admin")
def patients_create():
    data = request.get_json(silent=True) or {}
    c = clean_patient(data)
    pid, _ = execute("INSERT INTO Patient (name,date_of_birth,gender,phone,address,blood_group) VALUES (%s,%s,%s,%s,%s,%s)",
                     (c["name"], c["date_of_birth"], c["gender"], c["phone"], c.get("address"), c.get("blood_group")))
    try:
        maybe_create_login(data, "patient", patient_id=pid)
    except Exception:
        execute("DELETE FROM Patient WHERE patient_id=%s", (pid,))
        raise
    return jsonify(patient_id=pid), 201


def can_see_patient(pid):
    u = user()
    return u["role"] in ("admin", "doctor") or u["patient_id"] == pid


@app.get("/api/patients/<int:pid>")
@access()
def patient_get(pid):
    if not can_see_patient(pid):
        return jsonify(error="You do not have permission to do this"), 403
    row = query("SELECT * FROM Patient WHERE patient_id=%s", (pid,), one=True)
    if not row:
        return jsonify(error="Patient not found"), 404
    row["bed"] = query("SELECT room_number, ward FROM RoomBed WHERE patient_id=%s", (pid,), one=True)
    return jsonify(row)


@app.put("/api/patients/<int:pid>")
@access("admin", "patient")
def patient_update(pid):
    u = user()
    if u["role"] == "patient" and u["patient_id"] != pid:
        return jsonify(error="You do not have permission to do this"), 403
    data = request.get_json(silent=True) or {}
    allowed = ("name", "date_of_birth", "gender", "phone", "address", "blood_group") if u["role"] == "admin" \
        else ("phone", "address", "blood_group")
    c = clean_patient({k: data[k] for k in allowed if k in data}, partial=True)
    update_row("Patient", "patient_id", pid, c, allowed)
    return jsonify(ok=True)


@app.delete("/api/patients/<int:pid>")
@access("admin")
def patient_delete(pid):
    """Keeps both databases consistent: free the bed, remove clinical docs, then delete."""
    if not query("SELECT 1 FROM Patient WHERE patient_id=%s", (pid,), one=True):
        return jsonify(error="Patient not found"), 404
    call_proc("sp_discharge_patient", (pid,))
    mdb, _ = mongo_db.get_db()
    removed = sum(mdb[n].delete_many({"patient_id": pid}).deleted_count for n in mongo_db.VALIDATORS)
    execute("DELETE FROM Patient WHERE patient_id=%s", (pid,))
    return jsonify(ok=True, clinical_documents_removed=removed)


# ----------------------------------------------------------------- doctors
@app.get("/api/doctors")
@access()
def doctors_list():
    return jsonify(query("SELECT * FROM Doctor ORDER BY name"))


@app.post("/api/doctors")
@access("admin")
def doctors_create():
    data = request.get_json(silent=True) or {}
    c = clean_doctor(data)
    did, _ = execute("INSERT INTO Doctor (name,specialization,phone,email,consultation_fee) VALUES (%s,%s,%s,%s,%s)",
                     (c["name"], c["specialization"], c["phone"], c["email"], c.get("consultation_fee", 500)))
    try:
        maybe_create_login(data, "doctor", doctor_id=did)
    except Exception:
        execute("DELETE FROM Doctor WHERE doctor_id=%s", (did,))
        raise
    return jsonify(doctor_id=did), 201


@app.put("/api/doctors/<int:did>")
@access("admin")
def doctors_update(did):
    update_row("Doctor", "doctor_id", did, clean_doctor(request.get_json(silent=True) or {}, partial=True),
               ("name", "specialization", "phone", "email", "consultation_fee"))
    return jsonify(ok=True)


@app.delete("/api/doctors/<int:did>")
@access("admin")
def doctors_delete(did):
    execute("DELETE FROM Doctor WHERE doctor_id=%s", (did,))
    return jsonify(ok=True)


# ------------------------------------------------------------------- staff
@app.get("/api/staff")
@access("admin")
def staff_list():
    return jsonify(query("SELECT * FROM Staff ORDER BY name"))


@app.post("/api/staff")
@access("admin")
def staff_create():
    d = request.get_json(silent=True) or {}
    need(d, "name", "role")
    sid, _ = execute("INSERT INTO Staff (name,role,department,phone,email) VALUES (%s,%s,%s,%s,%s)",
                     (d["name"].strip(), d["role"].strip(), d.get("department") or None, d.get("phone") or None, d.get("email") or None))
    return jsonify(staff_id=sid), 201


@app.put("/api/staff/<int:sid>")
@access("admin")
def staff_update(sid):
    update_row("Staff", "staff_id", sid, request.get_json(silent=True) or {}, ("name", "role", "department", "phone", "email"))
    return jsonify(ok=True)


@app.delete("/api/staff/<int:sid>")
@access("admin")
def staff_delete(sid):
    execute("DELETE FROM Staff WHERE staff_id=%s", (sid,))
    return jsonify(ok=True)


# ------------------------------------------------------------ appointments
@app.get("/api/appointments")
@access()
def appointments_list():
    u, where, args = user(), [], []
    if u["role"] == "doctor":
        where.append("doctor_id=%s"); args.append(u["doctor_id"])
    elif u["role"] == "patient":
        where.append("patient_id=%s"); args.append(u["patient_id"])
    status = request.args.get("status")
    if status in ("Scheduled", "Completed", "Cancelled"):
        where.append("status=%s"); args.append(status)
    sql = "SELECT * FROM vw_appointment_details" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY date_time DESC"
    return jsonify(query(sql, args))


@app.post("/api/appointments")
@access("admin", "patient")
def appointments_create():
    u, d = user(), request.get_json(silent=True) or {}
    pid = u["patient_id"] if u["role"] == "patient" else d.get("patient_id")
    need({"patient_id": pid, **d}, "patient_id", "doctor_id", "date_time")
    rows = call_proc("sp_book_appointment", (int(pid), int(d["doctor_id"]), parse_dt(d["date_time"]), (d.get("reason") or "")[:255]))
    return jsonify(appointment_id=rows[0]["appointment_id"]), 201


@app.put("/api/appointments/<int:aid>")
@access()
def appointments_update(aid):
    u, d = user(), request.get_json(silent=True) or {}
    appt = query("SELECT * FROM Appointment WHERE appointment_id=%s", (aid,), one=True)
    if not appt:
        return jsonify(error="Appointment not found"), 404
    status = d.get("status")
    if status not in ("Scheduled", "Completed", "Cancelled"):
        return jsonify(error="Status must be Scheduled, Completed or Cancelled"), 400
    owns = (u["role"] == "doctor" and appt["doctor_id"] == u["doctor_id"]) or \
           (u["role"] == "patient" and appt["patient_id"] == u["patient_id"] and status == "Cancelled")
    if u["role"] != "admin" and not owns:
        return jsonify(error="You do not have permission to do this"), 403
    execute("UPDATE Appointment SET status=%s WHERE appointment_id=%s", (status, aid))
    return jsonify(ok=True)


@app.delete("/api/appointments/<int:aid>")
@access("admin")
def appointments_delete(aid):
    execute("DELETE FROM Appointment WHERE appointment_id=%s", (aid,))
    return jsonify(ok=True)


# ------------------------------------------------------------------- bills
@app.get("/api/bills")
@access("admin", "patient")
def bills_list():
    u = user()
    base = "SELECT b.*, p.name AS patient_name FROM Bill b JOIN Patient p ON p.patient_id=b.patient_id"
    if u["role"] == "patient":
        return jsonify(query(base + " WHERE b.patient_id=%s ORDER BY b.billed_at DESC", (u["patient_id"],)))
    return jsonify(query(base + " ORDER BY b.billed_at DESC"))


@app.post("/api/bills")
@access("admin")
def bills_create():
    d = request.get_json(silent=True) or {}
    need(d, "patient_id", "description", "amount")
    status = d.get("payment_status") or "Pending"
    if status not in ("Pending", "Partial", "Paid"):
        raise ValueError("Payment status must be Pending, Partial or Paid")
    bid, _ = execute("INSERT INTO Bill (patient_id,description,amount,payment_status) VALUES (%s,%s,%s,%s)",
                     (int(d["patient_id"]), d["description"].strip()[:200], money(d["amount"]), status))
    return jsonify(bill_id=bid), 201


@app.put("/api/bills/<int:bid>")
@access("admin")
def bills_update(bid):
    d = request.get_json(silent=True) or {}
    if "amount" in d:
        d["amount"] = money(d["amount"])
    if "payment_status" in d and d["payment_status"] not in ("Pending", "Partial", "Paid"):
        raise ValueError("Payment status must be Pending, Partial or Paid")
    update_row("Bill", "bill_id", bid, d, ("description", "amount", "payment_status"))
    return jsonify(ok=True)


@app.post("/api/bills/<int:bid>/pay")
@access("patient")
def bills_pay(bid):
    """Demo payment: marks the patient's own bill as Paid (fires the audit trigger)."""
    _, n = execute("UPDATE Bill SET payment_status='Paid' WHERE bill_id=%s AND patient_id=%s AND payment_status<>'Paid'",
                   (bid, user()["patient_id"]))
    if not n:
        return jsonify(error="Bill not found or already paid"), 404
    return jsonify(ok=True)


@app.delete("/api/bills/<int:bid>")
@access("admin")
def bills_delete(bid):
    execute("DELETE FROM Bill WHERE bill_id=%s", (bid,))
    return jsonify(ok=True)


@app.get("/api/bills/audit")
@access("admin")
def bills_audit():
    return jsonify(query("SELECT * FROM BillAudit ORDER BY audit_id DESC LIMIT 10"))


# -------------------------------------------------------------- rooms/beds
@app.get("/api/beds")
@access("admin", "doctor")
def beds_list():
    return jsonify(query("SELECT r.*, p.name AS patient_name FROM RoomBed r "
                         "LEFT JOIN Patient p ON p.patient_id=r.patient_id ORDER BY r.room_number, r.bed_id"))


@app.post("/api/beds")
@access("admin")
def beds_create():
    d = request.get_json(silent=True) or {}
    need(d, "room_number")
    if d.get("ward", "General") not in ("General", "Private", "ICU"):
        raise ValueError("Ward must be General, Private or ICU")
    bid, _ = execute("INSERT INTO RoomBed (room_number, ward) VALUES (%s,%s)", (d["room_number"].strip()[:10], d.get("ward", "General")))
    return jsonify(bed_id=bid), 201


@app.put("/api/beds/<int:bid>")
@access("admin")
def beds_assign(bid):
    """Assign a patient to a bed, or release it with patient_id = null."""
    d = request.get_json(silent=True) or {}
    bed = query("SELECT * FROM RoomBed WHERE bed_id=%s", (bid,), one=True)
    if not bed:
        return jsonify(error="Bed not found"), 404
    pid = d.get("patient_id")
    if pid in ("", None):
        pid = None
    else:
        pid = int(pid)
        if bed["patient_id"] not in (None, pid):
            return jsonify(error="This bed is already occupied"), 409
    execute("UPDATE RoomBed SET patient_id=%s WHERE bed_id=%s", (pid, bid))   # trigger sets status
    return jsonify(ok=True)


@app.delete("/api/beds/<int:bid>")
@access("admin")
def beds_delete(bid):
    execute("DELETE FROM RoomBed WHERE bed_id=%s", (bid,))
    return jsonify(ok=True)


# ------------------------------------------------ clinical docs (MongoDB)
def collection(kind):
    if kind not in mongo_db.COLLECTIONS:
        raise ValueError("Unknown record type")
    mdb, _ = mongo_db.get_db()
    return mdb[mongo_db.COLLECTIONS[kind]]


def shape(doc, names):
    doc["id"] = str(doc.pop("_id"))
    doc["doctor_name"] = names["doctors"].get(doc.get("doctor_id"), "Unknown doctor")
    doc["patient_name"] = names["patients"].get(doc.get("patient_id"), "Unknown patient")
    return doc


def name_maps():
    return {"doctors": {r["doctor_id"]: r["name"] for r in query("SELECT doctor_id,name FROM Doctor")},
            "patients": {r["patient_id"]: r["name"] for r in query("SELECT patient_id,name FROM Patient")}}


@app.get("/api/clinical/<kind>")
@access("doctor", "patient")
def clinical_list(kind):
    coll, u = collection(kind), user()
    if u["role"] == "patient":
        flt = {"patient_id": u["patient_id"]}
    else:
        pid = request.args.get("patient_id", type=int)
        flt = {"patient_id": pid} if pid else {"doctor_id": u["doctor_id"]}
    names = name_maps()
    return jsonify([shape(d, names) for d in coll.find(flt).sort("record_date", -1).limit(200)])


@app.post("/api/clinical/<kind>")
@access("doctor")
def clinical_create(kind):
    coll, d = collection(kind), request.get_json(silent=True) or {}
    need(d, "patient_id")
    pid = int(d["patient_id"])
    # MySQL and MongoDB cannot share a foreign key, so the backend checks the reference.
    if not query("SELECT 1 FROM Patient WHERE patient_id=%s", (pid,), one=True):
        return jsonify(error="Patient %d does not exist in the patient records" % pid), 404
    doc = mongo_db.validate(kind, d, pid, user()["doctor_id"])
    doc["_id"] = coll.insert_one(doc).inserted_id
    return jsonify(shape(doc, name_maps())), 201


@app.get("/api/patients/<int:pid>/history")
@access("doctor", "patient")
def patient_history(pid):
    if not can_see_patient(pid):
        return jsonify(error="You do not have permission to do this"), 403
    names, items = name_maps(), []
    for kind in mongo_db.COLLECTIONS:
        items += [shape(d, names) for d in collection(kind).find({"patient_id": pid})]
    items.sort(key=lambda x: (x["record_date"], x.get("created_at", "")), reverse=True)
    return jsonify(items)


@app.get("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    mongo_db.get_db()          # connect (or warn about fallback) at start-up
    print("\nHospital Management System running at http://127.0.0.1:5000\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
