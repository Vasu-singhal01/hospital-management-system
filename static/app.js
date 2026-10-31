'use strict';
/* Hospital Management System - frontend. Talks only to the Flask REST API. */
const state = { user: null };
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const age = dob => { const b = new Date(dob), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };
const when = s => { const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty body */ }
  if (r.status === 401 && state.user && path !== '/login') { state.user = null; showLogin(); throw new Error('Your session ended. Please sign in again.'); }
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 4200);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } finally { if (a[0] instanceof Element) a[0].classList.remove('loading'); } };

/* ---------------------------------------------------------- UI helpers */
const PILL = { Scheduled: 'info', Completed: 'ok', Cancelled: 'bad', Pending: 'warn', Partial: 'warn', Paid: 'ok', Available: 'ok', Occupied: 'warn', Normal: 'ok', High: 'bad', Low: 'warn' };
const pill = s => `<span class="pill ${PILL[s] || 'info'}">${esc(s)}</span>`;

function table(cols, rows, { empty = 'Nothing here yet.', actions } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}${actions ? '<th><span class="sr">Actions</span></th>' : ''}</tr></thead><tbody>` +
    rows.map(r => `<tr>${cols.map(c => `<td>${c.html ? c.html(r) : esc(c.get ? c.get(r) : r[c.key])}</td>`).join('')}${actions ? `<td class="acts">${actions(r)}</td>` : ''}</tr>`).join('') +
    '</tbody></table></div>';
}
function page(el, title, actions, body) {
  el.classList.add('loading');
  el.innerHTML = `<div class="pagehead"><h1>${esc(title)}</h1><div class="pageactions">${actions || ''}</div></div>${body}`;
  el.onclick = null;
}
const btn = (act, label, id, cls = 'link') => `<button class="${cls}" data-act="${act}"${id !== undefined ? ` data-id="${esc(id)}"` : ''}>${esc(label)}</button>`;

/* ---------------------------------------------------------- modal forms */
function fieldHTML(f, val) {
  const req = f.required ? 'required' : '';
  const cls = 'fld' + (f.full || f.type === 'textarea' || f.type === 'rows' ? ' full' : '');
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
  if (f.type === 'rows') return `<div class="${cls}" data-rows="${f.name}"><span>${esc(f.label)}</span>${hint}<div class="rowlist"></div><button type="button" class="btn ghost small" data-addrow>Add ${esc(f.rowLabel || 'row')}</button></div>`;
  let input;
  if (f.type === 'select') {
    input = `<select name="${f.name}" ${req}>${f.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(val ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" ${req} placeholder="${esc(f.placeholder || '')}">${esc(val ?? '')}</textarea>`;
  } else {
    input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(val ?? '')}" ${req} ${f.min ? `min="${f.min}"` : ''} ${f.max ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} placeholder="${esc(f.placeholder || '')}" ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
  }
  return `<label class="${cls}"><span>${esc(f.label)}</span>${input}${hint}</label>`;
}
function rowHTML(cols, vals = {}) {
  return `<div class="rowitem">${cols.map(c => c.type === 'select'
    ? `<select data-col="${c.name}" aria-label="${esc(c.label)}" style="flex:${c.flex || 1}">${c.options.map(o => `<option value="${esc(o)}" ${vals[c.name] === o ? 'selected' : ''}>${esc(o || c.label)}</option>`).join('')}</select>`
    : `<input data-col="${c.name}" placeholder="${esc(c.label)}" aria-label="${esc(c.label)}" value="${esc(vals[c.name] ?? '')}" style="flex:${c.flex || 1}" ${c.inputmode ? `inputmode="${c.inputmode}"` : ''}>`).join('')}<button type="button" class="iconbtn" data-delrow aria-label="Remove row">×</button></div>`;
}

function openForm({ title, fields, initial = {}, submit = 'Save', onSubmit }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `<form class="mform"><h2>${esc(title)}</h2><div class="fields">${fields.map(f => fieldHTML(f, initial[f.name])).join('')}</div>
    <p class="formerr" role="alert" hidden></p><div class="mactions"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn" type="submit">${esc(submit)}</button></div></form>`;
  document.body.append(dlg);
  const form = $('form', dlg), err = $('.formerr', dlg);
  fields.filter(f => f.type === 'rows').forEach(f => {
    const list = $(`[data-rows="${f.name}"] .rowlist`, form);
    const init = initial[f.name] && initial[f.name].length ? initial[f.name] : Array.from({ length: f.minRows || 1 }, () => ({}));
    init.forEach(v => list.insertAdjacentHTML('beforeend', rowHTML(f.columns, v)));
  });
  form.addEventListener('click', e => {
    if (e.target.closest('[data-cancel]')) dlg.close();
    const add = e.target.closest('[data-addrow]');
    if (add) { const f = fields.find(x => x.name === add.parentElement.dataset.rows); $('.rowlist', add.parentElement).insertAdjacentHTML('beforeend', rowHTML(f.columns)); }
    const del = e.target.closest('[data-delrow]');
    if (del && del.closest('.rowlist').children.length > 1) del.closest('.rowitem').remove();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = {};
    fields.forEach(f => {
      if (f.type === 'rows') data[f.name] = [...form.querySelectorAll(`[data-rows="${f.name}"] .rowitem`)].map(r => Object.fromEntries([...r.querySelectorAll('[data-col]')].map(i => [i.dataset.col, i.value.trim()])));
      else data[f.name] = form.elements[f.name].value.trim();
    });
    const b = $('[type=submit]', form); b.disabled = true; err.hidden = true;
    try { await onSubmit(data); dlg.close(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; }
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/* ------------------------------------------------------- generic CRUD */
const BLOOD = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(b => [b, b || 'Not known']);
const patientFields = isNew => [
  { name: 'name', label: 'Full name', required: true },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date', required: true, max: today() },
  { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'], required: true },
  { name: 'phone', label: 'Phone', required: true, placeholder: '10-digit number' },
  { name: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD },
  { name: 'address', label: 'Address' },
  ...(isNew ? [{ name: 'username', label: 'Login username', hint: 'Optional. Lets this patient sign in.' }, { name: 'password', label: 'Login password', type: 'password', hint: 'At least 6 characters.' }] : []),
];

function crudView(o) {
  return guard(async el => {
    let rows = [], q = '';
    const rowActions = r => (o.rowActions ? o.rowActions(r) : '') + (o.readonly ? '' : btn('edit', 'Edit', r[o.idKey]) + btn('del', 'Delete', r[o.idKey], 'link danger'));
    const draw = () => { $('#tbl').innerHTML = table(o.cols, rows, { empty: o.empty, actions: o.readonly && !o.rowActions ? null : rowActions }); };
    const load = async () => { rows = await api(o.path + (q ? `?q=${encodeURIComponent(q)}` : '')); draw(); };
    page(el, o.title, o.readonly ? '' : btn('add', 'Add ' + o.single, undefined, 'btn'),
      `${o.searchable ? '<div class="toolbar"><input id="search" type="search" placeholder="Search by name, phone or ID" aria-label="Search patients"></div>' : ''}<div id="tbl"></div>`);
    await load();
    if (o.searchable) { let t; $('#search').addEventListener('input', e => { clearTimeout(t); t = setTimeout(guard(async () => { q = e.target.value.trim(); await load(); }), 250); }); }
    el.onclick = guard(async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id, row = rows.find(r => String(r[o.idKey]) === id);
      if (b.dataset.act === 'add') openForm({ title: 'Add ' + o.single, fields: o.fields(true), submit: 'Add ' + o.single, onSubmit: async d => { await api(o.path, 'POST', d); toast(o.single[0].toUpperCase() + o.single.slice(1) + ' added'); await load(); } });
      if (b.dataset.act === 'edit') openForm({ title: 'Edit ' + o.single, fields: o.fields(false), initial: row, onSubmit: async d => { await api(`${o.path}/${id}`, 'PUT', d); toast('Changes saved'); await load(); } });
      if (b.dataset.act === 'del' && confirm(o.confirmDelete ? o.confirmDelete(row) : `Delete this ${o.single}?`)) { const r = await api(`${o.path}/${id}`, 'DELETE'); toast(o.single[0].toUpperCase() + o.single.slice(1) + ' deleted' + (r.clinical_documents_removed ? ` (${r.clinical_documents_removed} clinical documents removed from MongoDB)` : '')); await load(); }
    });
  });
}

const patientCols = [
  { label: 'ID', key: 'patient_id' }, { label: 'Name', html: r => `<strong>${esc(r.name)}</strong>` },
  { label: 'Age', get: r => age(r.date_of_birth) }, { label: 'Gender', key: 'gender' },
  { label: 'Phone', key: 'phone' }, { label: 'Blood', get: r => r.blood_group || '' }, { label: 'Address', get: r => r.address || '' },
];
const vPatientsAdmin = crudView({
  title: 'Patients', single: 'patient', path: '/patients', idKey: 'patient_id', cols: patientCols, fields: patientFields, searchable: true,
  empty: 'No patients match. Add a patient to get started.',
  confirmDelete: r => `Delete ${r.name}? Their bed is released and their clinical documents in MongoDB are removed too.`,
});
const vPatientsDoctor = crudView({
  title: 'Patients', single: 'patient', path: '/patients', idKey: 'patient_id', cols: patientCols, fields: patientFields, searchable: true, readonly: true,
  rowActions: r => `<a class="link" href="#/history/${r.patient_id}">View history</a>`,
});
const vDoctors = crudView({
  title: 'Doctors', single: 'doctor', path: '/doctors', idKey: 'doctor_id',
  cols: [{ label: 'ID', key: 'doctor_id' }, { label: 'Name', html: r => `<strong>${esc(r.name)}</strong>` }, { label: 'Specialization', key: 'specialization' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' }, { label: 'Fee', get: r => inr(r.consultation_fee) }],
  fields: isNew => [
    { name: 'name', label: 'Full name', required: true }, { name: 'specialization', label: 'Specialization', required: true },
    { name: 'phone', label: 'Phone', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'consultation_fee', label: 'Consultation fee (₹)', type: 'number', min: 0, step: '0.01' },
    ...(isNew ? [{ name: 'username', label: 'Login username', hint: 'Optional. Lets this doctor sign in.' }, { name: 'password', label: 'Login password', type: 'password', hint: 'At least 6 characters.' }] : [])],
  confirmDelete: r => `Delete ${r.name}? This is blocked if the doctor still has appointments.`,
});
const vStaff = crudView({
  title: 'Staff', single: 'staff member', path: '/staff', idKey: 'staff_id',
  cols: [{ label: 'ID', key: 'staff_id' }, { label: 'Name', html: r => `<strong>${esc(r.name)}</strong>` }, { label: 'Role', key: 'role' }, { label: 'Department', get: r => r.department || '' }, { label: 'Phone', get: r => r.phone || '' }, { label: 'Email', get: r => r.email || '' }],
  fields: () => [{ name: 'name', label: 'Full name', required: true }, { name: 'role', label: 'Role', required: true, placeholder: 'Nurse, Receptionist...' }, { name: 'department', label: 'Department' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' }],
});

/* ---------------------------------------------------------- dashboard */
const vDashboard = guard(async el => {
  const [s, audit] = await Promise.all([api('/stats'), api('/bills/audit')]);
  const m = s.mysql, d = s.mongo;
  const num = (v, l) => `<div class="num"><strong>${v}</strong><span>${esc(l)}</span></div>`;
  page(el, 'Dashboard', '', `
    <div class="stores">
      <section class="panel store"><h2>MySQL: structured records</h2><p class="sub">Tables with keys and relationships</p>
        <div class="nums">${num(m.patients, 'Patients')}${num(m.doctors, 'Doctors')}${num(m.staff, 'Staff')}${num(m.appointments_today, 'Appointments today')}${num(m.beds_occupied + ' of ' + m.beds_total, 'Beds occupied')}${num(inr(m.outstanding), 'Bills outstanding')}</div></section>
      <section class="panel store mongo"><h2>MongoDB: clinical documents</h2><p class="sub">${esc(d.mode)}. Fields vary by document type</p>
        <div class="nums">${num(d.reports, 'Medical reports')}${num(d.prescriptions, 'Prescriptions')}${num(d.labs, 'Lab results')}</div></section>
    </div>
    <h2 class="section">Upcoming appointments</h2><p class="hint">The next five scheduled visits.</p>
    ${table([{ label: 'When', get: r => when(r.date_time) }, { label: 'Patient', key: 'patient_name' }, { label: 'Doctor', key: 'doctor_name' }, { label: 'Status', html: r => pill(r.status) }], s.upcoming, { empty: 'No upcoming appointments.' })}
    <h2 class="section">Recent payment status changes</h2><p class="hint">Recorded automatically by a database trigger whenever a bill status changes.</p>
    ${table([{ label: 'Bill', key: 'bill_id' }, { label: 'From', html: r => pill(r.old_status) }, { label: 'To', html: r => pill(r.new_status) }, { label: 'When', get: r => when(r.changed_at) }], audit, { empty: 'No status changes yet. Mark a bill as paid to see the trigger log it.' })}`);
});

/* ------------------------------------------------------- appointments */
const vAppointments = guard(async el => {
  const role = state.user.role;
  let rows = [], status = '';
  const load = async () => { rows = await api('/appointments' + (status ? `?status=${status}` : '')); draw(); };
  const draw = () => {
    $('#tbl').innerHTML = table([
      { label: 'When', get: r => when(r.date_time) },
      { label: 'Patient', html: r => role === 'doctor' ? `<a href="#/history/${r.patient_id}">${esc(r.patient_name)}</a>` : esc(r.patient_name) },
      ...(role === 'patient' ? [{ label: 'Doctor', html: r => `${esc(r.doctor_name)}<br><span class="muted">${esc(r.specialization)}</span>` }] : role === 'admin' ? [{ label: 'Doctor', get: r => r.doctor_name }] : []),
      { label: 'Reason', get: r => r.reason || '' }, { label: 'Status', html: r => pill(r.status) }], rows, {
      empty: 'No appointments to show.',
      actions: r => (r.status === 'Scheduled' ? (role !== 'patient' ? btn('Completed', 'Mark completed', r.appointment_id) : '') + btn('Cancelled', 'Cancel', r.appointment_id, 'link danger') : '') + (role === 'admin' ? btn('del', 'Delete', r.appointment_id, 'link danger') : ''),
    });
  };
  const canBook = role !== 'doctor';
  page(el, role === 'doctor' ? 'My appointments' : 'Appointments', canBook ? btn('book', 'Book appointment', undefined, 'btn') : '',
    `<div class="toolbar"><label>Show <select id="flt" aria-label="Filter by status"><option value="">All appointments</option><option>Scheduled</option><option>Completed</option><option>Cancelled</option></select></label></div><div id="tbl"></div>`);
  await load();
  $('#flt').onchange = guard(async e => { status = e.target.value; await load(); });
  el.onclick = guard(async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'book') {
      const [doctors, patients] = await Promise.all([api('/doctors'), role === 'admin' ? api('/patients') : []]);
      openForm({
        title: 'Book appointment', submit: 'Book appointment',
        fields: [...(role === 'admin' ? [{ name: 'patient_id', label: 'Patient', type: 'select', required: true, options: patients.map(p => [p.patient_id, `${p.name} (#${p.patient_id})`]) }] : []),
          { name: 'doctor_id', label: 'Doctor', type: 'select', required: true, options: doctors.map(d => [d.doctor_id, `${d.name} (${d.specialization})`]) },
          { name: 'date_time', label: 'Date and time', type: 'datetime-local', required: true, min: nowLocal() },
          { name: 'reason', label: 'Reason for visit', hint: 'Doctors take one patient per 30-minute slot.' }],
        onSubmit: async d => { await api('/appointments', 'POST', d); toast('Appointment booked'); await load(); },
      });
    } else if (act === 'del') { if (confirm('Delete this appointment?')) { await api('/appointments/' + id, 'DELETE'); toast('Appointment deleted'); await load(); } }
    else if (act !== 'Cancelled' || confirm('Cancel this appointment?')) { await api('/appointments/' + id, 'PUT', { status: act }); toast(act === 'Completed' ? 'Marked as completed' : 'Appointment cancelled'); await load(); }
  });
});

/* ------------------------------------------------------------- billing */
const vBillingAdmin = guard(async el => {
  let rows = [];
  const load = async () => {
    rows = await api('/bills'); const audit = await api('/bills/audit');
    const paid = rows.filter(b => b.payment_status === 'Paid').reduce((a, b) => a + b.amount, 0), due = rows.filter(b => b.payment_status !== 'Paid').reduce((a, b) => a + b.amount, 0);
    $('#tbl').innerHTML = `<p class="hint">Collected ${inr(paid)}. Outstanding ${inr(due)}.</p>` + table([
      { label: 'Bill', key: 'bill_id' }, { label: 'Patient', key: 'patient_name' }, { label: 'Description', key: 'description' },
      { label: 'Amount', get: r => inr(r.amount) }, { label: 'Status', html: r => pill(r.payment_status) }, { label: 'Billed', get: r => when(r.billed_at) }], rows,
      { empty: 'No bills yet.', actions: r => btn('edit', 'Edit', r.bill_id) + btn('del', 'Delete', r.bill_id, 'link danger') }) +
      `<h2 class="section">Payment status log</h2><p class="hint">Written automatically by a database trigger.</p>` +
      table([{ label: 'Bill', key: 'bill_id' }, { label: 'From', html: r => pill(r.old_status) }, { label: 'To', html: r => pill(r.new_status) }, { label: 'When', get: r => when(r.changed_at) }], audit, { empty: 'No status changes yet.' });
  };
  page(el, 'Billing', btn('add', 'Add bill', undefined, 'btn'), '<div id="tbl"></div>');
  await load();
  const statusField = { name: 'payment_status', label: 'Payment status', type: 'select', options: ['Pending', 'Partial', 'Paid'] };
  el.onclick = guard(async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id, row = rows.find(r => String(r.bill_id) === id);
    if (b.dataset.act === 'add') {
      const patients = await api('/patients');
      openForm({ title: 'Add bill', submit: 'Add bill', fields: [{ name: 'patient_id', label: 'Patient', type: 'select', required: true, options: patients.map(p => [p.patient_id, `${p.name} (#${p.patient_id})`]) }, { name: 'description', label: 'Description', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '0.01', required: true }, statusField], onSubmit: async d => { await api('/bills', 'POST', d); toast('Bill added'); await load(); } });
    }
    if (b.dataset.act === 'edit') openForm({ title: 'Edit bill', fields: [{ name: 'description', label: 'Description', required: true, full: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '0.01', required: true }, statusField], initial: row, onSubmit: async d => { await api('/bills/' + id, 'PUT', d); toast('Bill updated'); await load(); } });
    if (b.dataset.act === 'del' && confirm('Delete this bill?')) { await api('/bills/' + id, 'DELETE'); toast('Bill deleted'); await load(); }
  });
});

const vBillingPatient = guard(async el => {
  const rows = await api('/bills');
  const due = rows.filter(b => b.payment_status !== 'Paid').reduce((a, b) => a + b.amount, 0);
  page(el, 'Bills', '', `<p class="hint">Outstanding balance: <strong>${inr(due)}</strong></p>` + table([
    { label: 'Description', key: 'description' }, { label: 'Amount', get: r => inr(r.amount) }, { label: 'Status', html: r => pill(r.payment_status) }, { label: 'Billed', get: r => when(r.billed_at) }], rows,
    { empty: 'You have no bills.', actions: r => r.payment_status === 'Paid' ? '' : btn('pay', 'Pay now', r.bill_id, 'btn small') }));
  el.onclick = guard(async e => {
    const b = e.target.closest('[data-act=pay]'); if (!b || !confirm('Pay this bill now? (demo payment)')) return;
    await api(`/bills/${b.dataset.id}/pay`, 'POST'); toast('Payment recorded'); await vBillingPatient(el);
  });
});

/* ---------------------------------------------------------- rooms/beds */
const vBeds = guard(async el => {
  let rows = [];
  const load = async () => {
    rows = await api('/beds'); const occ = rows.filter(r => r.status === 'Occupied').length;
    $('#tbl').innerHTML = `<p class="hint">${occ} of ${rows.length} beds occupied. Bed status updates automatically through a database trigger.</p>` + table([
      { label: 'Room', key: 'room_number' }, { label: 'Ward', key: 'ward' }, { label: 'Status', html: r => pill(r.status) }, { label: 'Patient', get: r => r.patient_name || '' }], rows, {
      actions: r => (r.status === 'Available' ? btn('assign', 'Assign patient', r.bed_id) : btn('release', 'Release', r.bed_id)) + btn('del', 'Delete', r.bed_id, 'link danger') });
  };
  page(el, 'Rooms and beds', btn('add', 'Add bed', undefined, 'btn'), '<div id="tbl"></div>');
  await load();
  el.onclick = guard(async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'add') openForm({ title: 'Add bed', submit: 'Add bed', fields: [{ name: 'room_number', label: 'Room number', required: true }, { name: 'ward', label: 'Ward', type: 'select', options: ['General', 'Private', 'ICU'] }], onSubmit: async d => { await api('/beds', 'POST', d); toast('Bed added'); await load(); } });
    if (b.dataset.act === 'assign') {
      const patients = await api('/patients');
      openForm({ title: 'Assign patient to bed', submit: 'Assign', fields: [{ name: 'patient_id', label: 'Patient', type: 'select', required: true, options: patients.map(p => [p.patient_id, `${p.name} (#${p.patient_id})`]) }], onSubmit: async d => { await api('/beds/' + id, 'PUT', d); toast('Patient assigned'); await load(); } });
    }
    if (b.dataset.act === 'release' && confirm('Release this bed?')) { await api('/beds/' + id, 'PUT', { patient_id: null }); toast('Bed released'); await load(); }
    if (b.dataset.act === 'del' && confirm('Delete this bed?')) { await api('/beds/' + id, 'DELETE'); toast('Bed deleted'); await load(); }
  });
});

/* ------------------------------------------------- clinical documents */
const KINDS = {
  reports: { title: 'Medical reports', single: 'medical report', cls: '', label: 'Medical report' },
  prescriptions: { title: 'Prescriptions', single: 'prescription', cls: 'rx', label: 'Prescription' },
  labs: { title: 'Lab results', single: 'lab result', cls: 'lab', label: 'Lab result' },
};
const KIND_OF = { MedicalReport: 'reports', Prescription: 'prescriptions', LabResult: 'labs' };

function docCard(d, showPatient) {
  const k = KINDS[KIND_OF[d.doc_type]];
  let body = '', title = '';
  if (d.doc_type === 'MedicalReport') {
    title = d.report_type;
    body = `<p><strong>Diagnosis:</strong> ${esc(d.diagnosis)}</p>${d.findings ? `<p>${esc(d.findings)}</p>` : ''}` +
      (d.details ? `<dl>${Object.entries(d.details).map(([a, b]) => `<dt>${esc(a.replace(/_/g, ' '))}</dt><dd>${esc(b)}</dd>`).join('')}</dl>` : '');
  } else if (d.doc_type === 'Prescription') {
    title = 'Prescription';
    body = table([{ label: 'Medicine', key: 'name' }, { label: 'Dosage', key: 'dosage' }, { label: 'Frequency', key: 'frequency' }, { label: 'Days', get: r => r.duration_days ?? '' }], d.medicines) + (d.notes ? `<p>${esc(d.notes)}</p>` : '');
  } else {
    title = d.test_name;
    body = table([{ label: 'Parameter', key: 'parameter' }, { label: 'Result', get: r => `${r.value} ${r.unit || ''}` }, { label: 'Reference', get: r => r.reference_range || '' }, { label: 'Flag', html: r => r.flag ? pill(r.flag) : '' }], d.results);
  }
  return `<article class="doc ${k.cls}"><header><div><span class="kind">${k.label}</span><strong>${esc(title)}</strong><div class="meta"><span>${esc(d.record_date)}</span><span>Dr. ${esc(String(d.doctor_name).replace(/^Dr\.\s*/, ''))}</span></div></div>${showPatient ? `<span class="pill info">${esc(d.patient_name)}</span>` : ''}</header>${body}</article>`;
}

function clinicalFields(kind, patients, pid) {
  const patientSel = { name: 'patient_id', label: 'Patient', type: 'select', required: true, options: [['', 'Choose a patient'], ...patients.map(p => [p.patient_id, `${p.name} (#${p.patient_id})`])] };
  const date = { name: 'record_date', label: 'Date', type: 'date', max: today() };
  patientSel.default = pid;
  if (kind === 'reports') return [patientSel, date, { name: 'report_type', label: 'Report type', required: true, placeholder: 'X-Ray, Consultation, MRI...' }, { name: 'diagnosis', label: 'Diagnosis', required: true, full: true }, { name: 'findings', label: 'Findings', type: 'textarea' },
    { name: 'details', label: 'Extra fields', type: 'rows', rowLabel: 'field', hint: 'Add any fields this report needs. Different reports can have different fields.', columns: [{ name: 'key', label: 'Field name' }, { name: 'value', label: 'Value', flex: 2 }], minRows: 1 }];
  if (kind === 'prescriptions') return [patientSel, date, { name: 'medicines', label: 'Medicines', type: 'rows', rowLabel: 'medicine', columns: [{ name: 'name', label: 'Medicine', flex: 2 }, { name: 'dosage', label: 'Dosage' }, { name: 'frequency', label: 'Frequency' }, { name: 'duration_days', label: 'Days', inputmode: 'numeric', flex: .6 }], minRows: 1 }, { name: 'notes', label: 'Notes', type: 'textarea' }];
  return [patientSel, date, { name: 'test_name', label: 'Test name', required: true, full: true, placeholder: 'Complete Blood Count' },
    { name: 'results', label: 'Results', type: 'rows', rowLabel: 'result', columns: [{ name: 'parameter', label: 'Parameter', flex: 1.4 }, { name: 'value', label: 'Value', flex: .8 }, { name: 'unit', label: 'Unit', flex: .7 }, { name: 'reference_range', label: 'Range', flex: .9 }, { name: 'flag', label: 'Flag', type: 'select', options: ['', 'Normal', 'High', 'Low'], flex: .8 }], minRows: 1 }];
}

function clinicalView(kind) {
  return guard(async el => {
    const k = KINDS[kind], isDoc = state.user.role === 'doctor';
    const patients = isDoc ? await api('/patients') : [];
    let pid = '';
    page(el, k.title, isDoc ? btn('add', 'Add ' + k.single, undefined, 'btn') : '',
      `${isDoc ? `<div class="toolbar"><label>Patient <select id="psel"><option value="">My recent entries</option>${patients.map(p => `<option value="${p.patient_id}">${esc(p.name)} (#${p.patient_id})</option>`).join('')}</select></label></div>` : ''}<div id="docs"></div>`);
    const load = async () => {
      const docs = await api(`/clinical/${kind}` + (pid ? `?patient_id=${pid}` : ''));
      $('#docs').innerHTML = docs.length ? docs.map(d => docCard(d, isDoc)).join('')
        : `<div class="empty">${isDoc ? (pid ? 'No records for this patient yet.' : 'You have not written any yet. Choose a patient or add one.') : 'No records yet.'}</div>`;
    };
    await load();
    if (!isDoc) return;
    $('#psel').onchange = guard(async e => { pid = e.target.value; await load(); });
    el.onclick = guard(async e => {
      if (!e.target.closest('[data-act=add]')) return;
      openForm({ title: 'Add ' + k.single, submit: 'Save ' + k.single, fields: clinicalFields(kind, patients, pid), initial: { patient_id: pid, record_date: today() },
        onSubmit: async d => { await api('/clinical/' + kind, 'POST', d); toast(k.label + ' saved'); pid = d.patient_id; $('#psel').value = pid; await load(); } });
    });
  });
}

/* ------------------------------------------------------ patient history */
const vHistory = guard(async (el, arg) => {
  const patients = await api('/patients');
  const pid = arg || '';
  page(el, 'Patient history', '', `<div class="toolbar"><label>Patient <select id="psel"><option value="">Choose a patient</option>${patients.map(p => `<option value="${p.patient_id}" ${String(p.patient_id) === pid ? 'selected' : ''}>${esc(p.name)} (#${p.patient_id})</option>`).join('')}</select></label></div><div id="docs"></div>`);
  $('#psel').onchange = e => { location.hash = '#/history/' + e.target.value; };
  if (!pid) { $('#docs').innerHTML = '<div class="empty">Choose a patient to see their reports, prescriptions and lab results together.</div>'; return; }
  const [p, items] = await Promise.all([api('/patients/' + pid), api(`/patients/${pid}/history`)]);
  $('#docs').innerHTML = `<section class="panel"><h2>${esc(p.name)}</h2><p class="sub">${age(p.date_of_birth)} years, ${esc(p.gender)}${p.blood_group ? ', blood group ' + esc(p.blood_group) : ''}. Phone ${esc(p.phone)}.${p.bed ? ' Admitted in room ' + esc(p.bed.room_number) + '.' : ''}</p></section><div style="height:1.25rem"></div>` +
    (items.length ? items.map(d => docCard(d, false)).join('') : '<div class="empty">No clinical records for this patient yet.</div>');
});

/* ------------------------------------------------------------- profile */
const vProfile = guard(async el => {
  const [p, appts] = await Promise.all([api('/patients/' + state.user.patient_id), api('/appointments?status=Scheduled')]);
  const next = appts.filter(a => new Date(a.date_time.replace(' ', 'T')) > new Date()).reverse()[0];
  page(el, 'My profile', btn('edit', 'Update contact details', undefined, 'btn'), `
    <section class="panel"><h2>${esc(p.name)}</h2><p class="sub">Patient #${p.patient_id}</p>
      <div class="nums"><div class="num"><strong>${age(p.date_of_birth)}</strong><span>Years old</span></div><div class="num"><strong>${esc(p.gender)}</strong><span>Gender</span></div><div class="num"><strong>${esc(p.blood_group || 'Not known')}</strong><span>Blood group</span></div></div>
      <p style="margin-top:1rem">Phone: ${esc(p.phone)}<br>Address: ${esc(p.address || 'Not added')}</p></section>
    <section class="panel"><h2>Next appointment</h2><p>${next ? `${esc(when(next.date_time))} with ${esc(next.doctor_name)} (${esc(next.specialization)})` : 'No upcoming appointment. Book one from the Appointments page.'}</p>
      ${p.bed ? `<p>You are admitted in room ${esc(p.bed.room_number)} (${esc(p.bed.ward)} ward).</p>` : ''}</section>`);
  el.onclick = guard(async e => {
    if (!e.target.closest('[data-act=edit]')) return;
    openForm({ title: 'Update contact details', fields: [{ name: 'phone', label: 'Phone', required: true }, { name: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD }, { name: 'address', label: 'Address', full: true }], initial: p,
      onSubmit: async d => { await api('/patients/' + p.patient_id, 'PUT', d); toast('Details updated'); await vProfile(el); } });
  });
});

/* ---------------------------------------------------- navigation/session */
const NAV = {
  admin: [['dashboard', 'Dashboard'], ['patients', 'Patients'], ['doctors', 'Doctors'], ['staff', 'Staff'], ['appointments', 'Appointments'], ['billing', 'Billing'], ['beds', 'Rooms and beds']],
  doctor: [['appointments', 'My appointments'], ['patients', 'Patients'], ['prescriptions', 'Prescriptions'], ['reports', 'Medical reports'], ['labs', 'Lab results'], ['history', 'Patient history']],
  patient: [['profile', 'My profile'], ['appointments', 'Appointments'], ['prescriptions', 'Prescriptions'], ['reports', 'Medical reports'], ['labs', 'Lab results'], ['billing', 'Bills']],
};
const VIEWS = {
  admin: { dashboard: vDashboard, patients: vPatientsAdmin, doctors: vDoctors, staff: vStaff, appointments: vAppointments, billing: vBillingAdmin, beds: vBeds },
  doctor: { appointments: vAppointments, patients: vPatientsDoctor, prescriptions: clinicalView('prescriptions'), reports: clinicalView('reports'), labs: clinicalView('labs'), history: vHistory },
  patient: { profile: vProfile, appointments: vAppointments, prescriptions: clinicalView('prescriptions'), reports: clinicalView('reports'), labs: clinicalView('labs'), billing: vBillingPatient },
};

async function doRoute() {
  if (!state.user) return;
  const role = state.user.role, [name, arg] = location.hash.replace(/^#\//, '').split('/');
  const key = VIEWS[role][name] ? name : NAV[role][0][0];
  $('#nav').innerHTML = NAV[role].map(([k, l]) => `<a href="#/${k}" ${k === key ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('');
  const main = $('#main'); main.innerHTML = '<p class="muted">Loading...</p>';
  await VIEWS[role][key](main, arg);
}
/* Renders never overlap: each waits for the previous one, and rapid clicks skip to the latest page. */
let routeSeq = 0, routing = Promise.resolve();
function route() { const seq = ++routeSeq; routing = routing.then(() => (seq === routeSeq ? doRoute() : null)).catch(() => {}); }
window.addEventListener('hashchange', route);

function healthChips(h) {
  return `<span class="${h.mysql ? '' : 'bad'}">MySQL ${h.mysql ? 'connected' : 'not reachable'}</span><span class="${h.mongo === 'MongoDB' ? '' : 'warn'}">${h.mongo === 'MongoDB' ? 'MongoDB connected' : 'MongoDB: ' + esc(h.mongo.toLowerCase())}</span>`;
}
async function refreshHealth(target) {
  try { target.innerHTML = healthChips(await api('/health')); } catch (e) { target.innerHTML = '<span class="bad">Server not reachable</span>'; }
}

function showLogin() {
  $('#shell').hidden = true; $('#login').hidden = false;
  refreshHealth($('#loginHealth'));
}
function showApp() {
  $('#login').hidden = true; $('#shell').hidden = false;
  $('#whoName').textContent = state.user.name; $('#whoRole').textContent = state.user.role;
  refreshHealth($('#sideHealth'));
  if (!location.hash) location.hash = '#/' + NAV[state.user.role][0][0];
  route();
}

/* login / register */
const regFields = [...patientFields(false), { name: 'username', label: 'Choose a username', required: true }, { name: 'password', label: 'Choose a password', type: 'password', required: true, hint: 'At least 6 characters.' }];
$('#regForm').innerHTML = `<div class="fields">${regFields.map(f => fieldHTML(f)).join('')}</div><p class="formerr" id="regErr" role="alert" hidden></p><button class="btn wide" type="submit">Create account</button>`;
function setTab(reg) {
  $('#tabIn').setAttribute('aria-selected', !reg); $('#tabReg').setAttribute('aria-selected', reg);
  $('#loginForm').hidden = reg; $('#regForm').hidden = !reg;
}
$('#tabIn').onclick = () => setTab(false); $('#tabReg').onclick = () => setTab(true);
document.querySelectorAll('.chip').forEach(c => c.onclick = () => { const f = $('#loginForm'); f.username.value = c.dataset.u; f.password.value = c.dataset.p; });

async function signIn(username, password) {
  state.user = await api('/login', 'POST', { username, password });
  location.hash = ''; showApp();
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target, err = $('#loginErr'); err.hidden = true;
  try { await signIn(f.username.value, f.password.value); f.reset(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#regForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target, err = $('#regErr'); err.hidden = true;
  const data = Object.fromEntries(regFields.map(x => [x.name, f.elements[x.name].value.trim()]));
  try { await api('/register', 'POST', data); await signIn(data.username, data.password); toast('Account created. Welcome!'); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#logout').onclick = async () => { await api('/logout', 'POST'); state.user = null; location.hash = ''; showLogin(); };

(async function init() {
  try { state.user = (await api('/me')).user; } catch (e) { state.user = null; }
  state.user ? showApp() : showLogin();
})();
