"""MongoDB layer: collections, validators, indexes, sample data, and
application-level validation of clinical documents."""
import datetime as dt
import re
import config

COLLECTIONS = {"reports": "MedicalReports", "prescriptions": "Prescriptions", "labs": "LabResults"}
DOC_TYPES = {"reports": "MedicalReport", "prescriptions": "Prescription", "labs": "LabResult"}

_INT = ["int", "long"]
_COMMON = {
    "patient_id": {"bsonType": _INT},
    "doctor_id": {"bsonType": _INT},
    "record_date": {"bsonType": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
}
VALIDATORS = {
    "MedicalReports": {"$jsonSchema": {
        "bsonType": "object",
        "required": ["patient_id", "doctor_id", "record_date", "doc_type", "report_type", "diagnosis"],
        "properties": {**_COMMON, "doc_type": {"enum": ["MedicalReport"]},
                       "report_type": {"bsonType": "string"}, "diagnosis": {"bsonType": "string"},
                       "findings": {"bsonType": "string"}, "details": {"bsonType": "object"}}}},
    "Prescriptions": {"$jsonSchema": {
        "bsonType": "object",
        "required": ["patient_id", "doctor_id", "record_date", "doc_type", "medicines"],
        "properties": {**_COMMON, "doc_type": {"enum": ["Prescription"]},
                       "medicines": {"bsonType": "array", "minItems": 1, "items": {
                           "bsonType": "object", "required": ["name", "dosage", "frequency"]}}}}},
    "LabResults": {"$jsonSchema": {
        "bsonType": "object",
        "required": ["patient_id", "doctor_id", "record_date", "doc_type", "test_name", "results"],
        "properties": {**_COMMON, "doc_type": {"enum": ["LabResult"]},
                       "test_name": {"bsonType": "string"},
                       "results": {"bsonType": "array", "minItems": 1, "items": {
                           "bsonType": "object", "required": ["parameter", "value"]}}}}},
}

_state = {}


def _today(offset=0):
    return (dt.date.today() + dt.timedelta(days=offset)).isoformat()


def ensure_collections(db, real=True):
    """Create collections with schema validation, plus indexes.
    If the server rejects a validator, the collection is still created and the
    Flask backend keeps validating documents (see validate() below)."""
    existing = db.list_collection_names()
    for name, validator in VALIDATORS.items():
        if real:
            try:
                if name in existing:
                    db.command("collMod", name, validator=validator)
                else:
                    db.create_collection(name, validator=validator)
            except Exception as e:
                print("[WARNING] Could not apply schema validator to %s: %s" % (name, e))
                if name not in db.list_collection_names():
                    db.create_collection(name)
        db[name].create_index("patient_id")
        db[name].create_index("doctor_id")
        db[name].create_index([("record_date", -1)])


def connect_real():
    """Return a real MongoDB database, or None when the server is not running."""
    try:
        from pymongo import MongoClient
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=2000)
        client.admin.command("ping")
        return client[config.MONGO_DB]
    except Exception:
        return None


def get_db():
    """Returns (database, mode). Falls back to in-memory mongomock if needed."""
    if "db" in _state:
        return _state["db"], _state["mode"]
    db = connect_real()
    if db is not None:
        ensure_collections(db, real=True)
        _state.update(db=db, mode="MongoDB")
    else:
        import mongomock
        print("\n[WARNING] MongoDB is not running at %s." % config.MONGO_URI)
        print("          Using an in-memory stand-in (mongomock). Data is lost when the app stops.")
        print("          Install and start MongoDB for the real demo.\n")
        db = mongomock.MongoClient()[config.MONGO_DB]
        ensure_collections(db, real=False)
        seed(db)
        _state.update(db=db, mode="In-memory fallback")
    return _state["db"], _state["mode"]


def seed(db):
    """Sample clinical documents; patient_ids/doctor_ids match sample_data.sql."""
    now = dt.datetime.now().isoformat(timespec="seconds")

    def base(kind, pid, did, offset):
        return {"patient_id": pid, "doctor_id": did, "record_date": _today(offset),
                "doc_type": DOC_TYPES[kind], "created_at": now}

    reports = [
        {**base("reports", 1, 1, -5), "report_type": "Cardiology Consultation",
         "diagnosis": "Mild hypertension", "findings": "BP 146/92. ECG normal sinus rhythm.",
         "details": {"ecg": "Normal sinus rhythm", "bp": "146/92 mmHg", "advice": "Reduce salt, walk 30 min daily"}},
        {**base("reports", 3, 3, -2), "report_type": "X-Ray Report",
         "diagnosis": "Early osteoarthritis, right knee", "findings": "Reduced joint space, small osteophytes.",
         "details": {"view": "AP and lateral", "side": "Right knee", "impression": "Grade 2 osteoarthritis"}},
        {**base("reports", 4, 2, -1), "report_type": "Pediatric Visit",
         "diagnosis": "Viral fever", "findings": "Temp 38.4 C, throat mildly congested.",
         "details": {"weight_kg": 21, "temperature_c": 38.4}},
        {**base("reports", 6, 1, -3), "report_type": "Admission Note",
         "diagnosis": "Uncontrolled blood pressure", "findings": "Admitted for monitoring.",
         "details": {"ward": "Private 202", "monitoring": "4-hourly BP"}},
    ]
    prescriptions = [
        {**base("prescriptions", 1, 1, -5), "medicines": [
            {"name": "Amlodipine", "dosage": "5 mg", "frequency": "Once daily", "duration_days": 30}],
         "notes": "Review after 2 weeks."},
        {**base("prescriptions", 2, 4, -3), "medicines": [
            {"name": "Cetirizine", "dosage": "10 mg", "frequency": "At night", "duration_days": 7},
            {"name": "Calamine lotion", "dosage": "Apply thin layer", "frequency": "Twice daily", "duration_days": 7}]},
        {**base("prescriptions", 3, 3, -2), "medicines": [
            {"name": "Diclofenac gel", "dosage": "Apply locally", "frequency": "Twice daily", "duration_days": 10},
            {"name": "Calcium + Vitamin D3", "dosage": "1 tablet", "frequency": "Once daily", "duration_days": 60}]},
        {**base("prescriptions", 4, 2, -1), "medicines": [
            {"name": "Paracetamol syrup", "dosage": "5 ml", "frequency": "Every 6 hours if fever", "duration_days": 3}],
         "notes": "Plenty of fluids."},
    ]
    labs = [
        {**base("labs", 1, 1, -5), "test_name": "Lipid Profile", "results": [
            {"parameter": "Total Cholesterol", "value": 228, "unit": "mg/dL", "reference_range": "< 200", "flag": "High"},
            {"parameter": "HDL", "value": 46, "unit": "mg/dL", "reference_range": "> 40", "flag": "Normal"},
            {"parameter": "LDL", "value": 148, "unit": "mg/dL", "reference_range": "< 100", "flag": "High"}]},
        {**base("labs", 4, 2, -1), "test_name": "Complete Blood Count", "results": [
            {"parameter": "Hemoglobin", "value": 12.1, "unit": "g/dL", "reference_range": "11.5 - 15.5", "flag": "Normal"},
            {"parameter": "WBC", "value": 13200, "unit": "/uL", "reference_range": "5000 - 12000", "flag": "High"}]},
        {**base("labs", 6, 1, -3), "test_name": "Blood Sugar (Fasting)", "results": [
            {"parameter": "Glucose", "value": 104, "unit": "mg/dL", "reference_range": "70 - 99", "flag": "High"}]},
    ]
    for kind, docs in (("reports", reports), ("prescriptions", prescriptions), ("labs", labs)):
        coll = db[COLLECTIONS[kind]]
        if coll.count_documents({}) == 0:
            coll.insert_many(docs)


# ---------------------------------------------------------- validation
def _text(v, field, required=True, maxlen=500):
    v = (v or "").strip() if isinstance(v, str) or v is None else str(v).strip()
    if required and not v:
        raise ValueError("%s is required" % field)
    if len(v) > maxlen:
        raise ValueError("%s is too long" % field)
    return v


def _date(v):
    v = (v or _today()).strip() if isinstance(v, str) or v is None else str(v)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise ValueError("record_date must look like 2026-11-02")
    dt.date.fromisoformat(v)
    return v


def validate(kind, data, patient_id, doctor_id):
    """Validate/clean a clinical document before it is stored."""
    doc = {"patient_id": int(patient_id), "doctor_id": int(doctor_id),
           "record_date": _date(data.get("record_date")), "doc_type": DOC_TYPES[kind],
           "created_at": dt.datetime.now().isoformat(timespec="seconds")}
    if kind == "reports":
        doc["report_type"] = _text(data.get("report_type"), "Report type", maxlen=100)
        doc["diagnosis"] = _text(data.get("diagnosis"), "Diagnosis", maxlen=300)
        findings = _text(data.get("findings"), "Findings", required=False, maxlen=2000)
        if findings:
            doc["findings"] = findings
        details = {}
        for row in data.get("details") or []:
            k, v = _text(row.get("key"), "Detail name", required=False, maxlen=60), _text(row.get("value"), "Detail value", required=False, maxlen=200)
            if k and v:
                details[k.replace(".", "_").lstrip("$")] = v
        if details:
            doc["details"] = details
    elif kind == "prescriptions":
        meds = []
        for m in data.get("medicines") or []:
            if not any((m.get("name"), m.get("dosage"), m.get("frequency"))):
                continue
            item = {"name": _text(m.get("name"), "Medicine name", maxlen=100),
                    "dosage": _text(m.get("dosage"), "Dosage", maxlen=60),
                    "frequency": _text(m.get("frequency"), "Frequency", maxlen=80)}
            days = str(m.get("duration_days") or "").strip()
            if days:
                if not days.isdigit() or int(days) > 365:
                    raise ValueError("Duration must be a number of days (max 365)")
                item["duration_days"] = int(days)
            meds.append(item)
        if not meds:
            raise ValueError("Add at least one medicine")
        doc["medicines"] = meds
        notes = _text(data.get("notes"), "Notes", required=False, maxlen=1000)
        if notes:
            doc["notes"] = notes
    else:
        doc["test_name"] = _text(data.get("test_name"), "Test name", maxlen=100)
        results = []
        for r in data.get("results") or []:
            if not any((r.get("parameter"), r.get("value"))):
                continue
            value = _text(r.get("value"), "Result value", maxlen=40)
            try:
                value = float(value) if "." in value else int(value)
            except ValueError:
                pass
            item = {"parameter": _text(r.get("parameter"), "Parameter", maxlen=80), "value": value}
            for f in ("unit", "reference_range"):
                t = _text(r.get(f), f, required=False, maxlen=40)
                if t:
                    item[f] = t
            flag = _text(r.get("flag"), "Flag", required=False, maxlen=10)
            if flag:
                if flag not in ("Normal", "High", "Low"):
                    raise ValueError("Flag must be Normal, High or Low")
                item["flag"] = flag
            results.append(item)
        if not results:
            raise ValueError("Add at least one result row")
        doc["results"] = results
    return doc
