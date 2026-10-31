-- =====================================================================
-- Hospital Management System - MySQL schema (structured data)
-- Covers: normalization (3NF), PK/FK, indexes, view, triggers,
--         stored procedures, transactions.
-- NOTE: running this file re-creates the database from scratch.
-- =====================================================================
DROP DATABASE IF EXISTS hospital_db;
CREATE DATABASE hospital_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hospital_db;

-- ---------------------------------------------------------------- tables
CREATE TABLE Patient (
    patient_id    INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    date_of_birth DATE         NOT NULL,
    gender        ENUM('Male','Female','Other') NOT NULL,
    phone         VARCHAR(15)  NOT NULL,
    address       VARCHAR(255),
    blood_group   VARCHAR(5),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Doctor (
    doctor_id        INT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    specialization   VARCHAR(80)  NOT NULL,
    phone            VARCHAR(15)  NOT NULL,
    email            VARCHAR(120) NOT NULL UNIQUE,
    consultation_fee DECIMAL(8,2) NOT NULL DEFAULT 500.00
) ENGINE=InnoDB;

CREATE TABLE Staff (
    staff_id   INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    role       VARCHAR(50)  NOT NULL,
    department VARCHAR(60),
    phone      VARCHAR(15),
    email      VARCHAR(120)
) ENGINE=InnoDB;

-- Login accounts. A user is an admin, or linked to exactly one doctor/patient.
CREATE TABLE Users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('admin','doctor','patient') NOT NULL,
    patient_id    INT NULL,
    doctor_id     INT NULL,
    CONSTRAINT fk_user_patient FOREIGN KEY (patient_id) REFERENCES Patient(patient_id) ON DELETE CASCADE,
    CONSTRAINT fk_user_doctor  FOREIGN KEY (doctor_id)  REFERENCES Doctor(doctor_id)  ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Appointment (
    appointment_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id     INT NOT NULL,
    doctor_id      INT NOT NULL,
    date_time      DATETIME NOT NULL,
    status         ENUM('Scheduled','Completed','Cancelled') NOT NULL DEFAULT 'Scheduled',
    reason         VARCHAR(255),
    CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES Patient(patient_id) ON DELETE CASCADE,
    CONSTRAINT fk_appt_doctor  FOREIGN KEY (doctor_id)  REFERENCES Doctor(doctor_id)  ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE Bill (
    bill_id        INT AUTO_INCREMENT PRIMARY KEY,
    patient_id     INT NOT NULL,
    description    VARCHAR(200) NOT NULL,
    amount         DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    payment_status ENUM('Pending','Partial','Paid') NOT NULL DEFAULT 'Pending',
    billed_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bill_patient FOREIGN KEY (patient_id) REFERENCES Patient(patient_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Filled automatically by trigger trg_bill_audit
CREATE TABLE BillAudit (
    audit_id   INT AUTO_INCREMENT PRIMARY KEY,
    bill_id    INT NOT NULL,
    old_status VARCHAR(10) NOT NULL,
    new_status VARCHAR(10) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE RoomBed (
    bed_id      INT AUTO_INCREMENT PRIMARY KEY,
    room_number VARCHAR(10) NOT NULL,
    ward        ENUM('General','Private','ICU') NOT NULL DEFAULT 'General',
    status      ENUM('Available','Occupied') NOT NULL DEFAULT 'Available',
    patient_id  INT NULL,
    UNIQUE KEY uq_bed_patient (patient_id),            -- one patient, one bed
    CONSTRAINT fk_bed_patient FOREIGN KEY (patient_id) REFERENCES Patient(patient_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- --------------------------------------------------------------- indexes
CREATE INDEX idx_patient_name      ON Patient(name);
CREATE INDEX idx_patient_phone     ON Patient(phone);
CREATE INDEX idx_appt_patient      ON Appointment(patient_id);
CREATE INDEX idx_appt_doctor_time  ON Appointment(doctor_id, date_time);
CREATE INDEX idx_appt_date         ON Appointment(date_time);
CREATE INDEX idx_bill_patient      ON Bill(patient_id);
CREATE INDEX idx_bill_status       ON Bill(payment_status);

-- ------------------------------------------------------------------ view
CREATE VIEW vw_appointment_details AS
SELECT a.appointment_id, a.patient_id, p.name AS patient_name,
       a.doctor_id, d.name AS doctor_name, d.specialization,
       a.date_time, a.status, a.reason
FROM Appointment a
JOIN Patient p ON p.patient_id = a.patient_id
JOIN Doctor  d ON d.doctor_id  = a.doctor_id;

-- ------------------------------------------- triggers and stored procedures
DELIMITER $$

-- Bed status always follows whether a patient is assigned.
CREATE TRIGGER trg_bed_before_insert BEFORE INSERT ON RoomBed
FOR EACH ROW
BEGIN
    SET NEW.status = IF(NEW.patient_id IS NULL, 'Available', 'Occupied');
END$$

CREATE TRIGGER trg_bed_before_update BEFORE UPDATE ON RoomBed
FOR EACH ROW
BEGIN
    SET NEW.status = IF(NEW.patient_id IS NULL, 'Available', 'Occupied');
END$$

-- Every payment status change is logged automatically.
CREATE TRIGGER trg_bill_audit AFTER UPDATE ON Bill
FOR EACH ROW
BEGIN
    IF OLD.payment_status <> NEW.payment_status THEN
        INSERT INTO BillAudit (bill_id, old_status, new_status)
        VALUES (OLD.bill_id, OLD.payment_status, NEW.payment_status);
    END IF;
END$$

-- Books an appointment inside a transaction. Locks the doctor row so two
-- bookings for the same doctor cannot be checked at the same moment, and
-- rejects slots within 30 minutes of an existing appointment.
CREATE PROCEDURE sp_book_appointment(
    IN p_patient INT, IN p_doctor INT, IN p_time DATETIME, IN p_reason VARCHAR(255))
BEGIN
    DECLARE v_doctor_exists INT DEFAULT 0;
    DECLARE v_conflicts     INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_time < NOW() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Appointment time must be in the future';
    END IF;

    START TRANSACTION;
    SELECT COUNT(*) INTO v_doctor_exists FROM Doctor WHERE doctor_id = p_doctor FOR UPDATE;
    IF v_doctor_exists = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Doctor does not exist';
    END IF;

    SELECT COUNT(*) INTO v_conflicts FROM Appointment
     WHERE doctor_id = p_doctor AND status <> 'Cancelled'
       AND date_time > p_time - INTERVAL 30 MINUTE
       AND date_time < p_time + INTERVAL 30 MINUTE;
    IF v_conflicts > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Doctor is not available at that time (30-minute slots). Choose another time';
    END IF;

    INSERT INTO Appointment (patient_id, doctor_id, date_time, reason)
    VALUES (p_patient, p_doctor, p_time, p_reason);
    COMMIT;
    SELECT LAST_INSERT_ID() AS appointment_id;
END$$

-- Releases the bed held by a patient and reports how many were freed.
CREATE PROCEDURE sp_discharge_patient(IN p_patient INT)
BEGIN
    UPDATE RoomBed SET patient_id = NULL WHERE patient_id = p_patient;
    SELECT ROW_COUNT() AS beds_released;
END$$

DELIMITER ;
