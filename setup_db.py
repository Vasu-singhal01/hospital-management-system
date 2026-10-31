"""One-time (re-runnable) setup: creates MySQL schema + sample data, login
accounts, and the MongoDB collections with sample clinical documents.
WARNING: this resets both databases to the sample state."""
import os
import sys
import pymysql
from werkzeug.security import generate_password_hash
import config
import mongo_db


def split_statements(text):
    delim, stmts, buf = ";", [], []
    for line in text.splitlines():
        s = line.strip()
        if s.upper().startswith("DELIMITER "):
            delim = s.split()[1]
            continue
        if not s or s.startswith("--"):
            continue
        buf.append(line)
        if s.endswith(delim):
            stmts.append("\n".join(buf).rstrip()[: -len(delim)].strip())
            buf = []
    return stmts


def run_file(cur, path):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), path), encoding="utf-8") as f:
        for stmt in split_statements(f.read()):
            cur.execute(stmt)


def main():
    try:
        conn = pymysql.connect(host=config.MYSQL_HOST, port=config.MYSQL_PORT,
                               user=config.MYSQL_USER, password=config.MYSQL_PASSWORD,
                               autocommit=True)
    except pymysql.MySQLError as e:
        print("\nCould not connect to MySQL:", e)
        print("Copy .env.example to .env and set MYSQL_USER / MYSQL_PASSWORD, then run again.")
        sys.exit(1)

    cur = conn.cursor()
    print("MySQL: creating schema, triggers, procedures ...")
    run_file(cur, "schema.sql")
    print("MySQL: loading sample data ...")
    run_file(cur, "sample_data.sql")

    print("MySQL: creating login accounts ...")
    cur.execute("USE " + config.MYSQL_DB)
    users = [("admin", "admin123", "admin", None, None)]
    cur.execute("SELECT doctor_id, name FROM Doctor ORDER BY doctor_id")
    for did, name in cur.fetchall():
        users.append(("dr." + name.split()[-1].lower(), "doctor123", "doctor", None, did))
    cur.execute("SELECT patient_id, name FROM Patient ORDER BY patient_id")
    for pid, name in cur.fetchall():
        users.append((name.split()[0].lower(), "patient123", "patient", pid, None))
    for u, pw, role, pid, did in users:
        cur.execute("INSERT INTO Users (username, password_hash, role, patient_id, doctor_id) VALUES (%s,%s,%s,%s,%s)",
                    (u, generate_password_hash(pw), role, pid, did))
    conn.close()

    print("MongoDB: creating collections, validators, indexes, sample documents ...")
    db = mongo_db.connect_real()
    if db is None:
        print("  MongoDB is NOT running - skipped. Start MongoDB and run this script again.")
        print("  (The app will still start with an in-memory fallback so you can test.)")
    else:
        for name in mongo_db.VALIDATORS:
            db[name].drop()
        mongo_db.ensure_collections(db, real=True)
        mongo_db.seed(db)
        print("  MongoDB ready:", {n: db[n].count_documents({}) for n in mongo_db.VALIDATORS})

    print("\nDone. Demo logins:")
    print("  admin          / admin123")
    print("  dr.sharma      / doctor123   (also dr.mehta, dr.verma, dr.iyer, dr.malhotra)")
    print("  rohan          / patient123  (also ananya, mohit, kavya, arjun, pooja, imran, neha)")
    print("\nStart the app with:  python app.py")


if __name__ == "__main__":
    main()
