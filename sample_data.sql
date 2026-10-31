USE hospital_db;

INSERT INTO Doctor (name, specialization, phone, email, consultation_fee) VALUES
('Dr. Anil Sharma',   'Cardiology',       '9810000001', 'anil.sharma@hospital.test',   900),
('Dr. Priya Mehta',   'Pediatrics',       '9810000002', 'priya.mehta@hospital.test',   600),
('Dr. Rahul Verma',   'Orthopedics',      '9810000003', 'rahul.verma@hospital.test',   800),
('Dr. Sneha Iyer',    'Dermatology',      '9810000004', 'sneha.iyer@hospital.test',    700),
('Dr. Karan Malhotra','General Medicine', '9810000005', 'karan.malhotra@hospital.test',500);

INSERT INTO Patient (name, date_of_birth, gender, phone, address, blood_group) VALUES
('Rohan Gupta',  '1992-04-12', 'Male',   '9811100001', 'Sector 12, Noida',       'B+'),
('Ananya Singh', '1998-09-30', 'Female', '9811100002', 'Indirapuram, Ghaziabad', 'O+'),
('Mohit Kumar',  '1975-01-22', 'Male',   '9811100003', 'Alpha 2, Greater Noida', 'A+'),
('Kavya Nair',   '2015-06-05', 'Female', '9811100004', 'Sector 62, Noida',       'AB+'),
('Arjun Rao',    '1988-11-17', 'Male',   '9811100005', 'Knowledge Park, Greater Noida', 'O-'),
('Pooja Sharma', '1969-03-08', 'Female', '9811100006', 'Vaishali, Ghaziabad',    'B-'),
('Imran Khan',   '2001-12-25', 'Male',   '9811100007', 'Sector 50, Noida',       'A-'),
('Neha Bansal',  '1994-07-14', 'Female', '9811100008', 'Sector 137, Noida',      'AB-');

INSERT INTO Staff (name, role, department, phone, email) VALUES
('Sunita Devi',   'Head Nurse',     'Nursing',    '9812200001', 'sunita@hospital.test'),
('Manish Tyagi',  'Receptionist',   'Front desk', '9812200002', 'manish@hospital.test'),
('Farhan Ali',    'Lab Technician', 'Pathology',  '9812200003', 'farhan@hospital.test'),
('Ritu Chauhan',  'Pharmacist',     'Pharmacy',   '9812200004', 'ritu@hospital.test');

-- Beds: assigning a patient makes the trigger mark the bed Occupied
INSERT INTO RoomBed (room_number, ward, patient_id) VALUES
('101','General',NULL), ('101','General',3), ('102','General',NULL),
('201','Private',NULL), ('202','Private',6), ('203','Private',NULL),
('ICU-1','ICU',NULL),   ('ICU-2','ICU',NULL);

-- Appointments (dates are relative to the day the data is loaded)
INSERT INTO Appointment (patient_id, doctor_id, date_time, status, reason) VALUES
(1, 1, TIMESTAMP(CURDATE(),'10:00:00') - INTERVAL 5 DAY, 'Completed', 'Chest discomfort follow-up'),
(2, 4, TIMESTAMP(CURDATE(),'11:30:00') - INTERVAL 3 DAY, 'Completed', 'Skin allergy'),
(3, 3, TIMESTAMP(CURDATE(),'09:30:00') - INTERVAL 2 DAY, 'Completed', 'Knee pain'),
(4, 2, TIMESTAMP(CURDATE(),'16:00:00') - INTERVAL 1 DAY, 'Completed', 'Fever and cough'),
(1, 1, TIMESTAMP(CURDATE(),'10:30:00') + INTERVAL 1 DAY, 'Scheduled', 'ECG review'),
(5, 5, TIMESTAMP(CURDATE(),'12:00:00') + INTERVAL 1 DAY, 'Scheduled', 'General check-up'),
(6, 1, TIMESTAMP(CURDATE(),'15:00:00') + INTERVAL 2 DAY, 'Scheduled', 'Blood pressure review'),
(7, 3, TIMESTAMP(CURDATE(),'11:00:00') + INTERVAL 2 DAY, 'Scheduled', 'Sports injury'),
(8, 4, TIMESTAMP(CURDATE(),'14:00:00') + INTERVAL 3 DAY, 'Scheduled', 'Acne consultation'),
(2, 5, TIMESTAMP(CURDATE(),'17:00:00') + INTERVAL 4 DAY, 'Cancelled', 'Routine check-up');

INSERT INTO Bill (patient_id, description, amount, payment_status) VALUES
(1, 'Cardiology consultation',        900.00, 'Paid'),
(2, 'Dermatology consultation',       700.00, 'Paid'),
(3, 'Orthopedic consultation + X-ray',2300.00,'Pending'),
(3, 'General ward - 2 days',          6000.00,'Partial'),
(4, 'Pediatric consultation',         600.00, 'Paid'),
(6, 'Private room - 3 days',         12500.00,'Pending'),
(5, 'Lab tests package',              1800.00,'Pending');
