# Hospital Management System (MySQL + MongoDB + Flask)

Advanced DBMS project, Bennett University. Vasu Singhal (E23CSEU0879) and Vaibhav Aggarwal (E23CSEU0878).

Structured hospital data (patients, doctors, appointments, billing, beds) is stored in **MySQL**.
Clinical documents (medical reports, prescriptions, lab results) are stored in **MongoDB**.
A **Flask** REST API connects both to an HTML/CSS/JavaScript frontend with Admin, Doctor and Patient panels.

## 1. One-time setup (Windows)

1. **Install MongoDB Community Server** (free): https://www.mongodb.com/try/download/community
   Choose the MSI installer, keep "Complete", and keep "Install MongoDB as a Service" ticked.
   It then runs automatically on `localhost:27017`. The installer also offers MongoDB Compass,
   a free viewer you can open during the demo to show the collections.
2. Install Python 3.10 or newer, then open a terminal in this folder and run:
   ```
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and put your MySQL password in it (`MYSQL_PASSWORD=...`).
4. Create the databases and sample data:
   ```
   python setup_db.py
   ```
   This **resets** both databases to the sample state. It prints the demo logins at the end.
5. Start the app:
   ```
   python app.py
   ```
   Open http://127.0.0.1:5000

The left-bottom corner of the app shows "MySQL connected" and "MongoDB connected".
If MongoDB shows "in-memory fallback", MongoDB is not running. The app still works so you can test,
but data is lost when the app stops. Start the MongoDB service, run `python setup_db.py` again, then restart the app.

## 2. Demo logins

| Role | Username | Password |
|---|---|---|
| Admin | admin | admin123 |
| Doctor | dr.sharma, dr.mehta, dr.verma, dr.iyer, dr.malhotra | doctor123 |
| Patient | rohan, ananya, mohit, kavya, arjun, pooja, imran, neha | patient123 |

New patients can also register themselves from the login page.

## 3. What is where (matches the PPT and report)

| PPT / report item | Where in the project |
|---|---|
| MySQL tables: Patient, Doctor, Appointment, Bill, RoomBed (+ Staff) | `schema.sql` |
| Primary and foreign keys, normalization (3NF) | `schema.sql` |
| Indexing (patient name/phone, appointment doctor+time and date, bills) | `schema.sql`, "indexes" section |
| Triggers | `trg_bed_before_insert/update` (bed status follows patient), `trg_bill_audit` (logs payment changes) |
| Stored procedures | `sp_book_appointment` (transaction, row lock, conflict check), `sp_discharge_patient` |
| MongoDB collections: MedicalReports, Prescriptions, LabResults | `mongo_db.py` |
| MongoDB document validation | `VALIDATORS` in `mongo_db.py`, plus `validate()` in the backend |
| Flask REST APIs, one layer for both databases | `app.py` |
| Backend checks the patient reference across MySQL and MongoDB | `clinical_create` in `app.py` |
| Role-based access (Admin, Doctor, Patient) | `access(...)` decorator in `app.py` |
| Frontend dashboards | `static/index.html`, `static/style.css`, `static/app.js` |

Extras added beyond the report: a `Staff` table (the PPT lists staff records), a `Users` table for logins
(passwords are stored hashed), and a view `vw_appointment_details`.

## 4. Suggested demo flow (about 5 minutes)

1. **Register a patient** (login page, "Register as patient"): Flask API stores it in MySQL (PPT slide 5 flow).
2. **Admin**: dashboard shows the MySQL panel and the MongoDB panel side by side.
   Assign a bed to the new patient, and notice the bed turns "Occupied" by itself (trigger).
   Mark a bill as Paid and see the payment log fill in (trigger).
3. **Patient**: book an appointment. Then try booking the same doctor 10 minutes later: it is rejected (stored procedure).
4. **Doctor** (`dr.sharma`): add a medical report with custom extra fields, then a prescription and a lab result (MongoDB).
   Open "Patient history" to see all three together.
   Open Compass to show the same documents inside MongoDB.
5. **Patient**: log in and show that only their own reports, prescriptions and bills are visible.
6. **Admin**: delete a test patient. Their bed is freed and their MongoDB documents are removed too
   (the consistency problem the report describes between the two databases).

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| `Could not connect to MySQL` | Check `.env` (user and password) and that the MySQL service is running. |
| App says "MongoDB: in-memory fallback" | Start the MongoDB service (Windows: Services > MongoDB Server), re-run `python setup_db.py`, restart the app. |
| `pip install` fails on `cryptography` | Run `python -m pip install --upgrade pip`, then retry. |
| Port 5000 already in use | Change the port at the bottom of `app.py`. |

## 6. Limits (be upfront about these)

This is an academic prototype, as the report states. It uses a development server and a demo secret key,
and has no HTTPS, audit logging or backup automation. Performance of indexes was not benchmarked.
