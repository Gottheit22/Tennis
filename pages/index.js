import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { LOGO_DATA_URL } from "../lib/logo";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const HOURLY_RATE = 36;

const fmtEUR = (n) => (n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const isoDate = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
function groupLabel(g) {
  if (g.one_off_date) {
    const [y, m, day] = g.one_off_date.split("-");
    return `${g.name} — ${day}.${m}.${y}, ${g.time}`;
  }
  return `${g.name} — ${WEEKDAYS[g.weekday]} ${g.time}`;
}

// Erzeugt clientseitig eine garantiert eindeutige ID, damit eine Rechnung nie ohne
// (oder mit doppelter) ID im lokalen Zustand landet, selbst wenn der Speichervorgang
// beim Zurücklesen aus der Datenbank einmal ins Leere läuft.
function newUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Offizielle bayerische Schulferien (Kultusministerium). Muss jährlich ergänzt werden,
// sobald neue Termine veröffentlicht sind: https://www.km.bayern.de/termine/ferien-und-feiertage
const BAVARIAN_HOLIDAYS = [
  ["2026-02-16", "2026-02-20"], // Faschingsferien 2026
  ["2026-03-30", "2026-04-10"], // Osterferien 2026
  ["2026-05-26", "2026-06-05"], // Pfingstferien 2026
  ["2026-08-01", "2026-09-14"], // Sommerferien 2026
  ["2026-11-02", "2026-11-06"], // Herbstferien 2026
  ["2026-12-24", "2027-01-08"], // Weihnachtsferien 2026/2027
  ["2027-02-08", "2027-02-12"], // Faschingsferien 2027
  ["2027-03-22", "2027-04-02"], // Osterferien 2027
  ["2027-05-18", "2027-05-28"], // Pfingstferien 2027
  ["2027-08-02", "2027-09-13"], // Sommerferien 2027
];
function isBavarianHoliday(dateIso) {
  return BAVARIAN_HOLIDAYS.some(([start, end]) => dateIso >= start && dateIso <= end);
}

function datesForMonth(year, monthIdx, weekday) {
  const dates = [];
  const d = new Date(year, monthIdx, 1);
  while (d.getMonth() === monthIdx) {
    const jsWd = (d.getDay() + 6) % 7;
    if (jsWd === weekday) dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Trainingstermine einer Gruppe in einem bestimmten Monat: bei wöchentlichen Gruppen
// alle passenden Wochentage, bei einmaligen Trainings (Schnuppertraining) nur der eine
// festgelegte Termin, sofern er in den abgefragten Monat fällt.
function sessionDates(group, year, monthIdx) {
  if (group.one_off_date) {
    const [y, m, day] = group.one_off_date.split("-").map(Number);
    if (y === year && m - 1 === monthIdx) return [new Date(year, monthIdx, day)];
    return [];
  }
  return datesForMonth(year, monthIdx, group.weekday);
}

export default function Home() {
  const [tab, setTab] = useState("training");
  const [ready, setReady] = useState(false);
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [attendance, setAttendance] = useState({}); // key: groupId__date -> {id, cancelled, present}
  const [invoices, setInvoices] = useState([]);
  const [biller, setBiller] = useState({ name: "", address: "", paymentInfo: "" });

  const [trainingGroupId, setTrainingGroupId] = useState(null);
  const [trainingYear, setTrainingYear] = useState(new Date().getFullYear());
  const [trainingMonth, setTrainingMonth] = useState(new Date().getMonth());

  const [invoiceGroupId, setInvoiceGroupId] = useState(null);
  const [invoiceFromYear, setInvoiceFromYear] = useState(new Date().getFullYear());
  const [invoiceFromMonth, setInvoiceFromMonth] = useState(new Date().getMonth());
  const [invoiceToYear, setInvoiceToYear] = useState(new Date().getFullYear());
  const [invoiceToMonth, setInvoiceToMonth] = useState(new Date().getMonth());
  const [currentInvoice, setCurrentInvoice] = useState(null);
  const [invoiceError, setInvoiceError] = useState(null);

  const loadAll = useCallback(async () => {
    const [g, s, sg, a, inv, b] = await Promise.all([
      supabase.from("groups").select("*").order("name"),
      supabase.from("students").select("*").order("name"),
      supabase.from("student_groups").select("*"),
      supabase.from("attendance").select("*"),
      supabase.from("invoices").select("*").order("generated_at", { ascending: false }),
      supabase.from("biller").select("*").eq("id", 1).maybeSingle(),
    ]);
    setGroups(g.data || []);
    const groupIdsByStudent = {};
    (sg.data || []).forEach((row) => {
      (groupIdsByStudent[row.student_id] ||= []).push(row.group_id);
    });
    setStudents((s.data || []).map((st) => ({ ...st, group_ids: groupIdsByStudent[st.id] || [] })));
    const attMap = {};
    (a.data || []).forEach((row) => {
      attMap[`${row.group_id}__${row.date}`] = row;
    });
    setAttendance(attMap);
    setInvoices(inv.data || []);
    if (b.data) setBiller({ name: b.data.name || "", address: b.data.address || "", paymentInfo: b.data.payment_info || "" });
    setReady(true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (!trainingGroupId && groups[0]) setTrainingGroupId(groups[0].id);
    if (!invoiceGroupId && groups[0]) setInvoiceGroupId(groups[0].id);
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Schüler ----
  const addStudent = async (name, groupIds, isSchoolchild, injured) => {
    if (!name.trim()) return;
    const { data } = await supabase.from("students").insert({ name: name.trim(), is_schoolchild: isSchoolchild, injured: !!injured }).select();
    const student = data && data[0];
    if (!student) return;
    if (groupIds.length > 0) {
      await supabase.from("student_groups").insert(groupIds.map((gid) => ({ student_id: student.id, group_id: gid })));
    }
    setStudents((prev) => [...prev, { ...student, group_ids: groupIds }].sort((x, y) => x.name.localeCompare(y.name)));
  };
  const delStudent = async (id) => {
    await supabase.from("students").delete().eq("id", id);
    setStudents((prev) => prev.filter((s) => s.id !== id));
  };
  const updateStudent = async (id, { name, is_schoolchild, groupIds, injured }) => {
    const { data } = await supabase.from("students").update({ name, is_schoolchild, injured: !!injured }).eq("id", id).select().maybeSingle();
    await supabase.from("student_groups").delete().eq("student_id", id);
    if (groupIds.length > 0) {
      await supabase.from("student_groups").insert(groupIds.map((gid) => ({ student_id: id, group_id: gid })));
    }
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...(data || { name, is_schoolchild, injured: !!injured }), group_ids: groupIds } : s)).sort((x, y) => x.name.localeCompare(y.name)));
  };
  const setInjured = async (id, injured) => {
    const { data } = await supabase.from("students").update({ injured }).eq("id", id).select().maybeSingle();
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...(data || { injured }) } : s)));
  };

  // ---- Gruppen ----
  const addGroup = async (name, weekday, time, duration, oneOffDate) => {
    if (!name.trim()) return;
    const { data } = await supabase.from("groups").insert({ name: name.trim(), weekday: oneOffDate ? null : weekday, time, duration, one_off_date: oneOffDate || null }).select();
    if (data) setGroups((prev) => [...prev, ...data].sort((x, y) => x.name.localeCompare(y.name)));
  };
  const delGroup = async (id) => {
    await supabase.from("groups").delete().eq("id", id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  };

  // ---- Training / Anwesenheit ----
  const upsertAttendance = async (groupId, dateIso, patch) => {
    const key = `${groupId}__${dateIso}`;
    const existing = attendance[key] || { cancelled: false, present: {}, moved_to: null, duration: null };
    const next = { ...existing, ...patch };
    const { data } = await supabase
      .from("attendance")
      .upsert({ id: existing.id, group_id: groupId, date: dateIso, cancelled: next.cancelled, present: next.present, moved_to: next.moved_to || null, duration: next.duration || null }, { onConflict: "group_id,date" })
      .select()
      .maybeSingle();
    setAttendance((prev) => ({ ...prev, [key]: data || { ...next, group_id: groupId, date: dateIso } }));
  };
  const toggleCancelled = (groupId, dateIso) => {
    const entry = attendance[`${groupId}__${dateIso}`] || { cancelled: false, present: {} };
    upsertAttendance(groupId, dateIso, { cancelled: !entry.cancelled });
  };
  const togglePresent = (groupId, dateIso, studentId) => {
    const entry = attendance[`${groupId}__${dateIso}`] || { cancelled: false, present: {} };
    const present = { ...entry.present, [studentId]: !entry.present[studentId] };
    upsertAttendance(groupId, dateIso, { present });
  };
  const setMovedDate = (groupId, dateIso, movedToIso) => {
    upsertAttendance(groupId, dateIso, { moved_to: movedToIso || null });
  };
  const setTrainingDuration = (groupId, dateIso, minutes) => {
    upsertAttendance(groupId, dateIso, { duration: minutes || null });
  };

  // ---- Rechnung ----
  const saveBiller = async (name, address, paymentInfo) => {
    setBiller({ name, address, paymentInfo });
    await supabase.from("biller").upsert({ id: 1, name, address, payment_info: paymentInfo });
  };

  const generateInvoice = async (groupId, fromYear, fromMonthIdx, toYear, toMonthIdx) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const groupStudents = students.filter((s) => (s.group_ids || []).includes(groupId));
    const billableStudents = groupStudents.filter((s) => !s.injured);
    const studentCount = billableStudents.length;
    const schoolchildCount = billableStudents.filter((s) => s.is_schoolchild).length;

    // Alle Monate im gewählten Zeitraum (inklusive) durchlaufen.
    const monthList = [];
    let cy = fromYear, cm = fromMonthIdx;
    while (cy < toYear || (cy === toYear && cm <= toMonthIdx)) {
      monthList.push({ year: cy, monthIdx: cm });
      cm++; if (cm > 11) { cm = 0; cy++; }
      if (monthList.length > 24) break; // Sicherheitsnetz
    }
    const monthKeySet = new Set(monthList.map(({ year, monthIdx }) => `${year}-${monthIdx}`));
    const monthKeyOf = (dateIso) => {
      const [y, m] = dateIso.split("-").map(Number);
      return `${y}-${m - 1}`;
    };

    const charges = {};
    billableStudents.forEach((s) => { charges[s.id] = []; });
    const dateEntries = [];
    let heldCount = 0;

    // Sitzungen sammeln: nach dem tatsächlichen (ggf. verschobenen) Datum zählen,
    // nicht nach dem ursprünglich generierten Wochentags-Datum.
    const sessions = [];
    monthList.forEach(({ year, monthIdx }) => {
      sessionDates(group, year, monthIdx).forEach((d) => {
        const originalDateIso = isoDate(d);
        const entry = attendance[`${groupId}__${originalDateIso}`] || { cancelled: false, present: {}, moved_to: null, duration: null };
        if (entry.cancelled) return;
        const effectiveIso = entry.moved_to || originalDateIso;
        if (!monthKeySet.has(monthKeyOf(effectiveIso))) return; // aus dem Zeitraum herausverschoben
        sessions.push({ originalDateIso, entry, effectiveIso });
      });
    });
    // Zusätzlich: Sitzungen, die aus einem Monat AUSSERHALB des gewählten Zeitraums
    // in den Zeitraum hinein verschoben wurden.
    Object.entries(attendance).forEach(([key, entry]) => {
      if (!key.startsWith(`${groupId}__`)) return;
      if (!entry || !entry.moved_to || entry.cancelled) return;
      const originalDateIso = key.slice(`${groupId}__`.length);
      if (monthKeySet.has(monthKeyOf(originalDateIso))) return; // schon oben verarbeitet
      if (!monthKeySet.has(monthKeyOf(entry.moved_to))) return; // nicht in diesen Zeitraum verschoben
      sessions.push({ originalDateIso, entry, effectiveIso: entry.moved_to });
    });

    sessions.forEach(({ originalDateIso, entry, effectiveIso }) => {
      const effectiveDuration = entry.duration || group.duration;
      const slotCost = HOURLY_RATE * (effectiveDuration / 60);
      const flatShare = studentCount > 0 ? slotCost / studentCount : 0;
      heldCount++;
      const holiday = isBavarianHoliday(effectiveIso);
      let note = "";
      if (holiday) {
        billableStudents.filter((s) => !s.is_schoolchild).forEach((s) => charges[s.id].push(flatShare));
        const attendingSchoolchildren = billableStudents.filter((s) => s.is_schoolchild && entry.present[s.id]);
        if (attendingSchoolchildren.length > 0) {
          const share = slotCost / attendingSchoolchildren.length;
          attendingSchoolchildren.forEach((s) => charges[s.id].push(share));
        }
        if (schoolchildCount > 0) {
          note = attendingSchoolchildren.length > 0 ? attendingSchoolchildren.map((s) => s.name).join(", ") : "niemand von den Schulkindern";
        }
      } else {
        billableStudents.forEach((s) => charges[s.id].push(flatShare));
      }
      if (entry.duration && entry.duration !== group.duration) {
        note = note ? `${note}; ${entry.duration} Min` : `${entry.duration} Min`;
      }
      const [ey, em] = effectiveIso.split("-").map(Number);
      dateEntries.push({ dateIso: effectiveIso, holiday, note, monthIdx: em - 1, year: ey, movedFromIso: entry.moved_to ? originalDateIso : null });
    });
    dateEntries.sort((a, b) => a.dateIso.localeCompare(b.dateIso));

    const studentsOut = billableStudents.map((s) => {
      const amounts = charges[s.id];
      const total = amounts.reduce((sum, a) => sum + a, 0);
      const order = [];
      const counts = new Map();
      amounts.forEach((a) => {
        const key = Math.round(a * 100);
        if (!counts.has(key)) { counts.set(key, 0); order.push(key); }
        counts.set(key, counts.get(key) + 1);
      });
      const formula = order.map((key) => {
        const amount = key / 100;
        const count = counts.get(key);
        return count > 1 ? `${fmtEUR(amount)} × ${count}` : fmtEUR(amount);
      }).join(" + ");
      return { id: s.id, name: s.name, total, formula: formula || fmtEUR(0), count: amounts.length };
    });
    // Verletzte Schüler werden transparent mit aufgeführt, aber nicht berechnet.
    const injuredOut = groupStudents.filter((s) => s.injured).map((s) => ({ id: s.id, name: s.name, total: 0, formula: "verletzt – nicht berechnet", count: 0, injured: true }));
    studentsOut.push(...injuredOut);
    const total = studentsOut.reduce((sum, s) => sum + s.total, 0);

    // Alle bestehenden Rechnungen dieser Gruppe, die sich mit dem gewählten Zeitraum
    // überschneiden (auch teilweise) — die werden durch die frisch berechnete Rechnung
    // ersetzt, damit nichts doppelt gezählt wird.
    const overlapping = invoices.filter((i) => i.group_id === groupId && invoiceOverlapsRange(i, fromYear, fromMonthIdx, toYear, toMonthIdx));
    // Bezahlt-Status pro Schüler aus allen betroffenen alten Rechnungen übernehmen.
    const oldPaidById = {};
    overlapping.forEach((inv) => (inv.students || []).forEach((s) => { if (s.paid) oldPaidById[s.id] = true; }));
    const studentsOutWithPaid = studentsOut.map((s) => (oldPaidById[s.id] ? { ...s, paid: true } : s));

    const record = {
      id: newUuid(),
      group_id: groupId,
      group_name: group.name,
      year: fromYear,
      month_idx: fromMonthIdx,
      to_year: toYear,
      to_month_idx: toMonthIdx,
      held_count: heldCount,
      student_count: studentCount,
      total,
      students: studentsOutWithPaid,
      dates: dateEntries,
      generated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("invoices").insert(record).select().maybeSingle();
    if (error) {
      console.error("Rechnung speichern fehlgeschlagen:", error);
      setInvoiceError(`Speichern fehlgeschlagen: ${error.message}`);
      return;
    }
    setInvoiceError(null);
    if (overlapping.length > 0) {
      await supabase.from("invoices").delete().in("id", overlapping.map((i) => i.id));
    }
    const invoice = data || record;
    const overlappingIds = new Set(overlapping.map((i) => i.id));
    setInvoices((prev) => [invoice, ...prev.filter((i) => !overlappingIds.has(i.id))]);
    setCurrentInvoice(invoice);
    downloadInvoicePdf(invoice, biller);
  };

  const togglePaid = async (invoiceId, lineIndex, paid) => {
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) return;
    const updatedStudents = (invoice.students || []).map((s, idx) => (idx === lineIndex ? { ...s, paid } : s));
    await supabase.from("invoices").update({ students: updatedStudents }).eq("id", invoiceId);
    setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, students: updatedStudents } : i)));
    setCurrentInvoice((prev) => (prev && prev.id === invoiceId ? { ...prev, students: updatedStudents } : prev));
  };

  if (!ready) return <div className="wrap"><Header /><div className="empty">Lade Daten …</div></div>;

  return (
    <div className="wrap">
      <Header />
      {tab === "training" && (
        <TrainingTab
          groups={groups} students={students} attendance={attendance}
          groupId={trainingGroupId} setGroupId={setTrainingGroupId}
          year={trainingYear} monthIdx={trainingMonth}
          setYear={setTrainingYear} setMonthIdx={setTrainingMonth}
          onToggleCancel={toggleCancelled} onTogglePresent={togglePresent} onSetMovedDate={setMovedDate} onSetDuration={setTrainingDuration}
        />
      )}
      {tab === "schueler" && (
        <StudentsTab students={students} groups={groups} onAdd={addStudent} onDelete={delStudent} onUpdate={updateStudent} onSetInjured={setInjured} />
      )}
      {tab === "gruppen" && (
        <GroupsTab groups={groups} students={students} onAdd={addGroup} onDelete={delGroup} />
      )}
      {tab === "rechnungen" && (
        <InvoicesTab
          groups={groups} biller={biller} onSaveBiller={saveBiller}
          groupId={invoiceGroupId} setGroupId={setInvoiceGroupId}
          fromYear={invoiceFromYear} fromMonthIdx={invoiceFromMonth}
          toYear={invoiceToYear} toMonthIdx={invoiceToMonth}
          setFromYear={setInvoiceFromYear} setFromMonthIdx={setInvoiceFromMonth}
          setToYear={setInvoiceToYear} setToMonthIdx={setInvoiceToMonth}
          onGenerate={generateInvoice}
          current={currentInvoice} setCurrent={setCurrentInvoice}
          invoices={invoices}
          onTogglePaid={togglePaid}
          errorMessage={invoiceError}
        />
      )}
      {tab === "offen" && <OpenPaymentsTab invoices={invoices} onTogglePaid={togglePaid} />}
      <Nav tab={tab} setTab={setTab} />
    </div>
  );
}

function Header() {
  return (
    <div className="header">
      <div className="logo">●</div>
      <div>
        <div className="disp" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1 }}>AUFSCHLAG</div>
        <div className="tag" style={{ marginTop: 4 }}>Training &amp; Abrechnung</div>
      </div>
    </div>
  );
}

function Nav({ tab, setTab }) {
  const items = [["training", "Training"], ["schueler", "Schüler"], ["gruppen", "Gruppen"], ["rechnungen", "Rechnung"], ["offen", "Offen"]];
  return (
    <div className="nav"><div className="nav-inner">
      {items.map(([id, label]) => (
        <button key={id} className={`nav-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
      ))}
    </div></div>
  );
}

function GroupMultiSelect({ groups, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const summary = selected.length === 0 ? "— keine Gruppe —" : groups.filter((g) => selected.includes(g.id)).map((g) => g.name).join(", ");
  return (
    <div>
      <button type="button" className="row" onClick={() => setOpen((o) => !o)}
        style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", cursor: "pointer", width: "100%" }}>
        <span style={{ color: selected.length ? "var(--chalk)" : "var(--chalk-dim)" }}>{summary}</span>
        <span className="tag">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="col" style={{ gap: 6, marginTop: 6 }}>
          {groups.map((g) => {
            const on = selected.includes(g.id);
            return (
              <button key={g.id} type="button" className="row" onClick={() => onToggle(g.id)}
                style={{ background: on ? "rgba(215,242,44,0.1)" : "var(--surface2)", border: `1px solid ${on ? "var(--ball)" : "var(--line)"}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer", width: "100%" }}>
                <span style={{ color: on ? "var(--ball)" : "var(--chalk)" }}>{groupLabel(g)}</span>
                <span style={{ color: on ? "var(--ball)" : "var(--chalk-dim)" }}>{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StudentsTab({ students, groups, onAdd, onDelete, onUpdate, onSetInjured }) {
  const [name, setName] = useState("");
  const [groupIds, setGroupIds] = useState([]);
  const [isSchoolchild, setIsSchoolchild] = useState(true);
  const [injured, setInjured] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const toggleGroup = (gid) => {
    setGroupIds((prev) => (prev.includes(gid) ? prev.filter((id) => id !== gid) : [...prev, gid]));
  };

  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12, position: "sticky", top: 0, background: "var(--bg)", paddingTop: 4, zIndex: 5 }}>Schüler anlegen</div>
      <div className="card col" style={{ position: "sticky", top: 34, zIndex: 5, boxShadow: "0 8px 12px -6px rgba(0,0,0,0.4)" }}>
        <input placeholder="Name des Schülers" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="tag">Gruppen (mehrere möglich, z. B. Gruppentraining + Einzeltraining)</div>
        {groups.length === 0 ? <div className="tag" style={{ color: "var(--clay)" }}>Lege zuerst eine Gruppe an (Tab „Gruppen").</div> : (
          <GroupMultiSelect groups={groups} selected={groupIds} onToggle={toggleGroup} />
        )}
        <label className="row" style={{ cursor: "pointer" }}>
          <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Geht noch zur Schule (betrifft Ferienregelung)</span>
          <input type="checkbox" style={{ width: "auto" }} checked={isSchoolchild} onChange={(e) => setIsSchoolchild(e.target.checked)} />
        </label>
        <label className="row" style={{ cursor: "pointer" }}>
          <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Verletzt (wird bei der Abrechnung nicht berechnet)</span>
          <input type="checkbox" style={{ width: "auto" }} checked={injured} onChange={(e) => setInjured(e.target.checked)} />
        </label>
        <button className="btn-primary" onClick={() => { onAdd(name, groupIds, isSchoolchild, injured); setName(""); setGroupIds([]); setInjured(false); }}>+ Schüler hinzufügen</button>
      </div>
      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Alle Schüler ({students.length})</div>
      {students.length === 0 && <div className="empty">Noch keine Schüler angelegt.</div>}
      {students.map((s) =>
        editingId === s.id ? (
          <EditStudentCard key={s.id} student={s} groups={groups} onCancel={() => setEditingId(null)}
            onSave={(patch) => { onUpdate(s.id, patch); setEditingId(null); }} />
        ) : (
          <div key={s.id} className="card row" style={{ marginBottom: 8, opacity: s.injured ? 0.7 : 1 }}>
            <div>
              <div className="row" style={{ gap: 6, justifyContent: "flex-start" }}>
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                {s.injured && <span className="tag" style={{ color: "var(--clay)", border: "1px solid var(--clay)", borderRadius: 999, padding: "1px 7px" }}>verletzt</span>}
              </div>
              <div className="tag">
                {(s.group_ids || []).length > 0 ? s.group_ids.map((gid) => groups.find((g) => g.id === gid)?.name).filter(Boolean).join(", ") : "— keine Gruppe —"}
                {" · "}{s.is_schoolchild ? "Schüler" : "Kein Schüler"}
              </div>
            </div>
            <div className="gap2">
              <button className="icon-btn" style={{ color: s.injured ? "var(--paid-green)" : "var(--clay)", fontSize: 11, whiteSpace: "nowrap" }}
                onClick={() => onSetInjured(s.id, !s.injured)}>
                {s.injured ? "✓ gesund melden" : "verletzt"}
              </button>
              <button className="icon-btn" style={{ color: "var(--chalk-dim)" }} onClick={() => setEditingId(s.id)}>✎</button>
              <button className="icon-btn" onClick={() => onDelete(s.id)}>✕</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function EditStudentCard({ student, groups, onSave, onCancel }) {
  const [name, setName] = useState(student.name);
  const [groupIds, setGroupIds] = useState(student.group_ids || []);
  const [isSchoolchild, setIsSchoolchild] = useState(!!student.is_schoolchild);
  const [injured, setInjured] = useState(!!student.injured);
  const toggleGroup = (gid) => {
    setGroupIds((prev) => (prev.includes(gid) ? prev.filter((id) => id !== gid) : [...prev, gid]));
  };
  return (
    <div className="card col" style={{ marginBottom: 8, borderColor: "var(--ball)" }}>
      <input placeholder="Name des Schülers" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="tag">Gruppen (mehrere möglich)</div>
      <GroupMultiSelect groups={groups} selected={groupIds} onToggle={toggleGroup} />
      <label className="row" style={{ cursor: "pointer" }}>
        <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Geht noch zur Schule (betrifft Ferienregelung)</span>
        <input type="checkbox" style={{ width: "auto" }} checked={isSchoolchild} onChange={(e) => setIsSchoolchild(e.target.checked)} />
      </label>
      <label className="row" style={{ cursor: "pointer" }}>
        <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Verletzt (wird bei der Abrechnung nicht berechnet)</span>
        <input type="checkbox" style={{ width: "auto" }} checked={injured} onChange={(e) => setInjured(e.target.checked)} />
      </label>
      <div className="gap2">
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => onSave({ name: name.trim(), groupIds, is_schoolchild: isSchoolchild, injured })}>Speichern</button>
        <button className="btn-primary" style={{ flex: 1, background: "var(--surface2)", color: "var(--chalk)" }} onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

function GroupsTab({ groups, students, onAdd, onDelete }) {
  const [name, setName] = useState("");
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState("16:00");
  const [duration, setDuration] = useState(60);
  const [oneOff, setOneOff] = useState(false);
  const [oneOffDate, setOneOffDate] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Gruppe anlegen</div>
      <div className="card col">
        <input placeholder={oneOff ? "Bezeichnung (z. B. Schnuppertraining Familie Meyer)" : "Gruppenname (z. B. Kids Mittwoch)"} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="row" style={{ cursor: "pointer" }}>
          <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Einmaliges Training (z. B. Schnuppertraining)</span>
          <input type="checkbox" style={{ width: "auto" }} checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} />
        </label>
        <div className="gap2">
          {oneOff ? (
            <input type="date" value={oneOffDate} onChange={(e) => setOneOffDate(e.target.value)} style={{ flex: 2 }} />
          ) : (
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={{ flex: 2 }}>
              {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </select>
          )}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="gap2" style={{ alignItems: "center" }}>
          <input type="number" min="15" step="15" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          <span className="tag" style={{ whiteSpace: "nowrap" }}>Minuten Dauer</span>
        </div>
        <button className="btn-primary" disabled={oneOff && !oneOffDate}
          onClick={() => { onAdd(name, weekday, time, duration, oneOff ? oneOffDate : null); setName(""); setOneOffDate(""); setOneOff(false); }}>
          + {oneOff ? "Einmaliges Training" : "Gruppe"} anlegen
        </button>
      </div>
      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Alle Gruppen ({groups.length})</div>
      {groups.length === 0 && <div className="empty">Noch keine Gruppen angelegt.</div>}
      {groups.map((g) => {
        const members = students.filter((s) => (s.group_ids || []).includes(g.id));
        const expanded = expandedId === g.id;
        return (
          <div key={g.id} className="card" style={{ marginBottom: 8 }}>
            <button className="row" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }} onClick={() => setExpandedId(expanded ? null : g.id)}>
              <div>
                <div style={{ fontWeight: 500 }}>{g.name}</div>
                <div className="tag">{g.one_off_date ? `Einmalig, ${dateLabel(g.one_off_date)}` : WEEKDAYS[g.weekday]} · {g.time} Uhr · {g.duration} Min · {members.length} Schüler</div>
              </div>
              <span className="tag">{expanded ? "▲" : "▼"}</span>
            </button>
            {expanded && (
              <div style={{ marginTop: 10 }}>
                <div className="net-divider" style={{ margin: "0 0 10px" }} />
                {members.length === 0 ? <div className="tag">Keine Schüler in dieser Gruppe.</div> : (
                  <div className="col" style={{ gap: 4 }}>
                    {members.map((m) => <div key={m.id} style={{ fontSize: 14 }}>• {m.name}</div>)}
                  </div>
                )}
                <button className="icon-btn" style={{ marginTop: 10 }} onClick={() => onDelete(g.id)}>✕ Gruppe löschen</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TrainingTab({ groups, students, attendance, groupId, setGroupId, year, monthIdx, setYear, setMonthIdx, onToggleCancel, onTogglePresent, onSetMovedDate, onSetDuration }) {
  const [movingDate, setMovingDate] = useState(null);
  const [moveValue, setMoveValue] = useState("");
  const [editingDuration, setEditingDuration] = useState(null);
  const [durationValue, setDurationValue] = useState("");

  if (groups.length === 0) return <div className="empty">Lege zuerst eine Gruppe an (Tab „Gruppen").</div>;
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const groupStudents = students.filter((s) => (s.group_ids || []).includes(group.id));
  const dates = sessionDates(group, year, monthIdx);

  const shiftMonth = (delta) => {
    let m = monthIdx + delta, y = year;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    setMonthIdx(m); setYear(y);
  };

  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Trainingserfassung</div>
      <select value={group.id} onChange={(e) => setGroupId(e.target.value)} style={{ marginBottom: 12 }}>
        {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
      </select>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="card" style={{ padding: "8px 12px", cursor: "pointer" }} onClick={() => shiftMonth(-1)}>‹</button>
        <div className="disp">{MONTHS[monthIdx]} {year}</div>
        <button className="card" style={{ padding: "8px 12px", cursor: "pointer" }} onClick={() => shiftMonth(1)}>›</button>
      </div>
      <div className="tag" style={{ marginBottom: 12 }}>
        {group.one_off_date ? `Einmaliges Training, ${dateLabel(group.one_off_date)}` : `${WEEKDAYS[group.weekday]}, ${group.time} Uhr`} · {group.duration} Min (Standard) · {groupStudents.length} Schüler
      </div>
      {dates.length === 0 && <div className="empty">{group.one_off_date ? "Der Termin liegt nicht in diesem Monat — zum passenden Monat navigieren." : "Kein passender Wochentag in diesem Monat."}</div>}
      {dates.map((d) => {
        const dateIso = isoDate(d);
        const entry = attendance[`${group.id}__${dateIso}`] || { cancelled: false, present: {}, moved_to: null, duration: null };
        const effectiveIso = entry.moved_to || dateIso;
        const effectiveLabel = new Date(effectiveIso + "T00:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
        const isMoving = movingDate === dateIso;
        const isEditingDuration = editingDuration === dateIso;
        const effectiveDuration = entry.duration || group.duration;
        return (
          <div key={dateIso} className="card" style={{ marginBottom: 8, opacity: entry.cancelled ? 0.55 : 1 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 500 }}>
                {effectiveLabel}
                {entry.moved_to && <span className="tag" style={{ marginLeft: 6 }}>verschoben von {dateLabel(dateIso)}</span>}
              </div>
            </div>
            <div className="tag" style={{ marginBottom: 8 }}>
              {effectiveDuration} Min{entry.duration && entry.duration !== group.duration ? " (abweichend)" : ""}
            </div>
            <div className="gap2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
              <button className="tag" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--chalk-dim)" }}
                onClick={() => { setMovingDate(isMoving ? null : dateIso); setMoveValue(effectiveIso); setEditingDuration(null); }}>
                Datum ändern
              </button>
              <button className="tag" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--chalk-dim)" }}
                onClick={() => { setEditingDuration(isEditingDuration ? null : dateIso); setDurationValue(String(effectiveDuration)); setMovingDate(null); }}>
                Dauer ändern
              </button>
              <button className="tag" style={{ background: "none", border: "none", cursor: "pointer", color: entry.cancelled ? "var(--clay)" : "var(--chalk-dim)" }} onClick={() => onToggleCancel(group.id, dateIso)}>
                {entry.cancelled ? "Ausgefallen ✕ (wieder aktivieren)" : "Als ausgefallen markieren"}
              </button>
            </div>
            {isMoving && (
              <div className="gap2" style={{ marginBottom: 10, alignItems: "center" }}>
                <input type="date" value={moveValue} onChange={(e) => setMoveValue(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }} onClick={() => { onSetMovedDate(group.id, dateIso, moveValue === dateIso ? null : moveValue); setMovingDate(null); }}>OK</button>
                {entry.moved_to && (
                  <button className="btn-primary" style={{ width: "auto", padding: "8px 14px", background: "var(--surface2)", color: "var(--chalk)" }}
                    onClick={() => { onSetMovedDate(group.id, dateIso, null); setMovingDate(null); }}>
                    Zurücksetzen
                  </button>
                )}
              </div>
            )}
            {isEditingDuration && (
              <div className="gap2" style={{ marginBottom: 10, alignItems: "center" }}>
                <input type="number" min="15" step="15" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }}
                  onClick={() => { const v = Number(durationValue); onSetDuration(group.id, dateIso, v === group.duration ? null : v); setEditingDuration(null); }}>OK</button>
                {entry.duration && (
                  <button className="btn-primary" style={{ width: "auto", padding: "8px 14px", background: "var(--surface2)", color: "var(--chalk)" }}
                    onClick={() => { onSetDuration(group.id, dateIso, null); setEditingDuration(null); }}>
                    Zurücksetzen
                  </button>
                )}
              </div>
            )}
            {!entry.cancelled && (groupStudents.length ? (
              <div className="gap2" style={{ flexWrap: "wrap" }}>
                {groupStudents.map((s) => {
                  const present = !!entry.present[s.id];
                  return (
                    <button key={s.id} className={`pill ${present ? "on" : ""}`} onClick={() => onTogglePresent(group.id, dateIso, s.id)}>
                      {present ? "✓" : "✕"} {s.name}
                    </button>
                  );
                })}
              </div>
            ) : <div className="tag">Keine Schüler in dieser Gruppe.</div>)}
          </div>
        );
      })}
      <div className="tag" style={{ marginTop: 12 }}>Anwesenheit dient nur der Dokumentation und wirkt sich nicht auf die Rechnung aus. Ein verschobenes Datum wird für die Rechnung (inkl. Ferienprüfung) am neuen Termin gezählt.</div>
    </div>
  );
}

function InvoicesTab({ groups, biller, onSaveBiller, groupId, setGroupId, fromYear, fromMonthIdx, toYear, toMonthIdx, setFromYear, setFromMonthIdx, setToYear, setToMonthIdx, onGenerate, current, setCurrent, invoices, onTogglePaid, errorMessage }) {
  const [billerName, setBillerName] = useState(biller.name);
  const [billerAddress, setBillerAddress] = useState(biller.address);
  const [paymentInfo, setPaymentInfo] = useState(biller.paymentInfo);
  const [expandedPeriodId, setExpandedPeriodId] = useState(null);
  useEffect(() => { setBillerName(biller.name); setBillerAddress(biller.address); setPaymentInfo(biller.paymentInfo); }, [biller]);
  const persistBiller = () => onSaveBiller(billerName, billerAddress, paymentInfo);

  const activeGroupId = groupId || groups[0]?.id;
  const rangeInvalid = toYear < fromYear || (toYear === fromYear && toMonthIdx < fromMonthIdx);
  const groupInvoices = invoices.filter((i) => i.group_id === activeGroupId).sort((a, b) => monthNum(b.year, b.month_idx) - monthNum(a.year, a.month_idx));
  const willOverlap = !rangeInvalid && groupInvoices.some((i) => invoiceOverlapsRange(i, fromYear, fromMonthIdx, toYear, toMonthIdx));

  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Rechnung erstellen</div>
      <div className="card col" style={{ marginBottom: 12 }}>
        <input placeholder="Dein Name (für Grußformel)" value={billerName} onChange={(e) => setBillerName(e.target.value)} onBlur={persistBiller} />
        <input placeholder="Adresse (optional)" value={billerAddress} onChange={(e) => setBillerAddress(e.target.value)} onBlur={persistBiller} />
        <input placeholder="Zahlungsinfo (z. B. PayPal/IBAN)" value={paymentInfo} onChange={(e) => setPaymentInfo(e.target.value)} onBlur={persistBiller} />
      </div>
      <div className="card col">
        {groups.length === 0 ? <div className="tag">Keine Gruppen vorhanden</div> : (
          <select value={activeGroupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
          </select>
        )}
        {groupInvoices.length > 0 && (
          <div className="tag">
            Bereits abgerechnet für diese Gruppe: {groupInvoices.map((i) => periodLabel(i)).join(" · ")}
          </div>
        )}
        <div className="tag">Von</div>
        <div className="gap2">
          <select value={fromMonthIdx} onChange={(e) => setFromMonthIdx(Number(e.target.value))} style={{ flex: 2 }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <input type="number" value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))} style={{ flex: 1 }} />
        </div>
        <div className="tag">Bis (einschließlich)</div>
        <div className="gap2">
          <select value={toMonthIdx} onChange={(e) => setToMonthIdx(Number(e.target.value))} style={{ flex: 2 }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <input type="number" value={toYear} onChange={(e) => setToYear(Number(e.target.value))} style={{ flex: 1 }} />
        </div>
        {rangeInvalid && <div className="tag" style={{ color: "var(--clay)" }}>„Bis" darf nicht vor „Von" liegen.</div>}
        {willOverlap && <div className="tag" style={{ color: "var(--clay)" }}>Überschneidet sich mit einer bestehenden Rechnung – die wird beim Erstellen automatisch durch die neu berechnete ersetzt.</div>}
        {errorMessage && (
          <div className="tag" style={{ color: "var(--clay)", background: "rgba(193,85,46,0.15)", padding: "8px 10px", borderRadius: 8 }}>
            ⚠ {errorMessage}
          </div>
        )}
        <button className="btn-primary" disabled={groups.length === 0 || rangeInvalid} onClick={() => onGenerate(activeGroupId, fromYear, fromMonthIdx, toYear, toMonthIdx)}>⬇ PDF-Rechnung erstellen</button>
        <div className="tag">Für nur einen Monat einfach bei „Von" und „Bis" denselben Monat wählen. Erstellt eine gemeinsame PDF für die ganze Gruppe.</div>
      </div>

      {current && <InvoiceView invoice={current} biller={biller} onTogglePaid={onTogglePaid} />}

      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Übersicht nach Gruppe</div>
      {invoices.length === 0 && <div className="empty">Noch keine Rechnungen erstellt.</div>}
      {groups.map((g) => {
        const periods = invoices
          .filter((i) => i.group_id === g.id)
          .sort((a, b) => monthNum(a.year, a.month_idx) - monthNum(b.year, b.month_idx));
        if (periods.length === 0) return null;
        return (
          <div key={g.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>{g.name}</div>
            <div className="col" style={{ gap: 6 }}>
              {periods.map((inv) => {
                const unpaid = (inv.students || []).map((s, idx) => ({ ...s, idx })).filter((s) => !s.paid);
                const expanded = expandedPeriodId === inv.id;
                return (
                  <div key={inv.id} style={{ background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
                    <button className="row" style={{ background: "none", border: "none", cursor: "pointer", width: "100%", padding: 0 }}
                      onClick={() => setExpandedPeriodId(expanded ? null : inv.id)}>
                      <span style={{ fontSize: 14 }}>{periodLabel(inv)}</span>
                      <span className="tag" style={{ color: unpaid.length > 0 ? "var(--clay)" : "var(--paid-green)" }}>
                        {fmtEUR(inv.total)} · {unpaid.length > 0 ? `${unpaid.length} offen` : "bezahlt"}
                      </span>
                    </button>
                    {expanded && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                        {unpaid.length === 0 ? (
                          <div className="tag" style={{ color: "var(--paid-green)" }}>Alle Schüler haben bezahlt.</div>
                        ) : (
                          <div className="col" style={{ gap: 6 }}>
                            {unpaid.map((s) => (
                              <div key={s.idx} className="row">
                                <span style={{ fontSize: 13 }}>{s.name}</span>
                                <div className="gap2" style={{ alignItems: "center" }}>
                                  <span style={{ fontSize: 13, color: "var(--clay)" }}>{fmtEUR(s.total)}</span>
                                  <button className="pill" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => onTogglePaid(inv.id, s.idx, true)}>
                                    ✓ bezahlt
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <button className="tag" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--chalk-dim)", marginTop: 8 }} onClick={() => setCurrent(inv)}>
                          Volle Rechnung anzeigen →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Verlauf, chronologisch ({invoices.length})</div>
      {invoices.length === 0 && <div className="empty">Noch keine Rechnungen erstellt.</div>}
      {invoices.map((inv) => {
        const openCount = (inv.students || []).filter((s) => !s.paid).length;
        return (
          <button key={inv.id} className="card" style={{ textAlign: "left", width: "100%", marginBottom: 8, cursor: "pointer" }} onClick={() => setCurrent(inv)}>
            <div style={{ fontWeight: 500 }}>{inv.group_name} — {periodLabel(inv)}</div>
            <div className="tag">
              {inv.held_count} Trainings · Gesamt {fmtEUR(inv.total)}
              {" · "}
              <span style={{ color: openCount > 0 ? "var(--clay)" : "var(--paid-green)" }}>{openCount > 0 ? `${openCount} offen` : "alle bezahlt"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function periodLabel(inv) {
  const toY = inv.to_year ?? inv.year;
  const toM = inv.to_month_idx ?? inv.month_idx;
  if (toY === inv.year && toM === inv.month_idx) return `${MONTHS[inv.month_idx]} ${inv.year}`;
  return `${MONTHS[inv.month_idx]} ${inv.year} – ${MONTHS[toM]} ${toY}`;
}

function monthNum(year, monthIdx) { return year * 12 + monthIdx; }

// Prüft, ob sich der Zeitraum einer bestehenden Rechnung mit dem angefragten Zeitraum überschneidet.
function invoiceOverlapsRange(inv, fromYear, fromMonthIdx, toYear, toMonthIdx) {
  const invFrom = monthNum(inv.year, inv.month_idx);
  const invTo = monthNum(inv.to_year ?? inv.year, inv.to_month_idx ?? inv.month_idx);
  return invFrom <= monthNum(toYear, toMonthIdx) && monthNum(fromYear, fromMonthIdx) <= invTo;
}

function dateLabel(dateIso) {
  const [, m, d] = dateIso.split("-");
  return `${d}.${m}`;
}

function dateSuffix(d) {
  const parts = [];
  if (d.note) parts.push(d.note);
  if (d.movedFromIso) parts.push(`ursprünglich am: ${dateLabel(d.movedFromIso)}.`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

function InvoiceView({ invoice, biller, onTogglePaid }) {
  const dates = invoice.dates || [];
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="disp" style={{ fontSize: 16, marginBottom: 10 }}>{invoice.group_name} — {periodLabel(invoice)}</div>
      <div className="tag" style={{ marginBottom: 6 }}>Trainings ({dates.length}):</div>
      <div style={{ fontSize: 14, marginBottom: 10 }}>
        {dates.map((d) => (
          <div key={d.dateIso}>• {dateLabel(d.dateIso)}{dateSuffix(d)}</div>
        ))}
      </div>
      <div className="net-divider" style={{ margin: "10px 0" }} />
      {(invoice.students || []).map((s, idx) => (
        <div key={`${s.id}-${idx}`} className="row" style={{ margin: "6px 0" }}>
          <span>{s.name}: {s.formula}</span>
          <div className="gap2" style={{ alignItems: "center" }}>
            <span className="disp" style={{ whiteSpace: "nowrap" }}>= {fmtEUR(s.total)}</span>
            {onTogglePaid && (
              <button className="pill" style={{ fontSize: 11, padding: "4px 8px" }}
                onClick={() => onTogglePaid(invoice.id, idx, !s.paid)}>
                {s.paid ? "✓ bezahlt" : "offen"}
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="net-divider" style={{ margin: "10px 0" }} />
      <div className="row"><span className="disp" style={{ fontSize: 16 }}>Gesamt</span><span className="disp" style={{ fontSize: 18, color: "var(--ball)" }}>{fmtEUR(invoice.total)}</span></div>
      <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => downloadInvoicePdf(invoice, biller)}>⬇ PDF erneut herunterladen</button>
    </div>
  );
}

function OpenPaymentsTab({ invoices, onTogglePaid }) {
  const [expandedId, setExpandedId] = useState(null);
  const [expandedOverviewId, setExpandedOverviewId] = useState(null);

  const byStudent = new Map();
  invoices.forEach((inv) => {
    (inv.students || []).forEach((s, idx) => {
      if (s.paid) return;
      if (!byStudent.has(s.id)) byStudent.set(s.id, { id: s.id, name: s.name, total: 0, items: [] });
      const entry = byStudent.get(s.id);
      entry.total += s.total;
      entry.items.push({ invoiceId: inv.id, groupName: inv.group_name, period: periodLabel(inv), amount: s.total, lineIndex: idx });
    });
  });
  const openStudents = [...byStudent.values()].sort((a, b) => b.total - a.total);
  const grandTotal = openStudents.reduce((sum, s) => sum + s.total, 0);

  // Vollständige Übersicht: jeder Schüler über alle Rechnungen hinweg (bezahlt + offen).
  const overviewByStudent = new Map();
  invoices.forEach((inv) => {
    (inv.students || []).forEach((s, idx) => {
      if (!overviewByStudent.has(s.id)) overviewByStudent.set(s.id, { id: s.id, name: s.name, trainings: 0, cost: 0, paid: 0, items: [] });
      const entry = overviewByStudent.get(s.id);
      entry.trainings += s.count || 0;
      entry.cost += s.total;
      if (s.paid) entry.paid += s.total;
      entry.items.push({ invoiceId: inv.id, groupName: inv.group_name, period: periodLabel(inv), amount: s.total, trainings: s.count || 0, paid: !!s.paid, lineIndex: idx });
    });
  });
  const overviewStudents = [...overviewByStudent.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 4 }}>Offene Zahlungen</div>
      <div className="tag" style={{ marginBottom: 12 }}>Gesamt offen: <span style={{ color: "var(--clay)" }}>{fmtEUR(grandTotal)}</span></div>
      {openStudents.length === 0 && <div className="empty">Alles bezahlt. 🎾</div>}
      {openStudents.map((s) => {
        const expanded = expandedId === s.id;
        return (
          <div key={s.id} className="card" style={{ marginBottom: 8 }}>
            <button className="row" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }} onClick={() => setExpandedId(expanded ? null : s.id)}>
              <div>
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="tag">{s.items.length} offene Rechnung{s.items.length !== 1 ? "en" : ""}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="disp" style={{ color: "var(--clay)" }}>{fmtEUR(s.total)}</span>
                <span className="tag">{expanded ? "▲" : "▼"}</span>
              </div>
            </button>
            {expanded && (
              <div style={{ marginTop: 10 }}>
                <div className="net-divider" style={{ margin: "0 0 10px" }} />
                <div className="col" style={{ gap: 8 }}>
                  {s.items.map((it, idx) => (
                    <div key={idx} className="row">
                      <span style={{ fontSize: 14 }}>{it.groupName} — {it.period}</span>
                      <div className="gap2" style={{ alignItems: "center" }}>
                        <span className="disp" style={{ whiteSpace: "nowrap" }}>{fmtEUR(it.amount)}</span>
                        <button className="pill" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => onTogglePaid(it.invoiceId, it.lineIndex, true)}>
                          ✓ als bezahlt markieren
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 4 }}>Schüler-Übersicht</div>
      <div className="tag" style={{ marginBottom: 12 }}>Trainings, Kosten, bezahlt und offen — über alle Rechnungen hinweg (unabhängig von Anwesenheit, außer bei Ferientraining).</div>
      {overviewStudents.length === 0 && <div className="empty">Noch keine Rechnungen erstellt.</div>}
      {overviewStudents.map((s) => {
        const open = s.cost - s.paid;
        const expanded = expandedOverviewId === s.id;
        return (
          <div key={s.id} className="card" style={{ marginBottom: 8 }}>
            <button className="row" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }} onClick={() => setExpandedOverviewId(expanded ? null : s.id)}>
              <div>
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="tag">{s.trainings} Trainings · {fmtEUR(s.cost)} gesamt</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, color: "var(--paid-green)" }}>{fmtEUR(s.paid)} bezahlt</div>
                  <div style={{ fontSize: 13, color: open > 0.005 ? "var(--clay)" : "var(--paid-green)" }}>{fmtEUR(open)} offen</div>
                </div>
                <span className="tag">{expanded ? "▲" : "▼"}</span>
              </div>
            </button>
            {expanded && (
              <div style={{ marginTop: 10 }}>
                <div className="net-divider" style={{ margin: "0 0 10px" }} />
                <div className="col" style={{ gap: 8 }}>
                  {s.items.map((it, idx) => (
                    <div key={idx} className="row">
                      <span style={{ fontSize: 14 }}>{it.groupName} — {it.period} · {it.trainings} Trainings</span>
                      <div className="gap2" style={{ alignItems: "center" }}>
                        <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>{fmtEUR(it.amount)}</span>
                        <button className="pill" style={{ fontSize: 11, padding: "4px 8px", borderColor: it.paid ? "var(--paid-green)" : "var(--line)", color: it.paid ? "var(--paid-green)" : "var(--chalk-dim)" }}
                          onClick={() => onTogglePaid(it.invoiceId, it.lineIndex, !it.paid)}>
                          {it.paid ? "✓ bezahlt" : "offen"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

}

function downloadInvoicePdf(inv, biller) {
  import("jspdf").then(({ jsPDF }) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = 210;
    const center = pageWidth / 2;
    const dates = inv.dates || [];
    let y = 48;
    const isMultiMonth = periodLabel(inv).includes("–");

    const logoWidth = 70;
    const logoHeight = logoWidth * (249 / 500);
    doc.addImage(LOGO_DATA_URL, "PNG", pageWidth - 20 - logoWidth, 14, logoWidth, logoHeight);

    doc.setFont("helvetica", "normal"); doc.setFontSize(12);
    doc.text("Hallöchen,", 20, y); y += 12;

    const introText = isMultiMonth
      ? `im Zeitraum ${periodLabel(inv)} fanden ${dates.length} Trainingseinheiten statt, und zwar am`
      : `im Monat ${MONTHS[inv.month_idx]} ${inv.year} fanden ${dates.length} Trainingseinheiten statt, und zwar am`;
    doc.text(introText, 20, y, { maxWidth: 170 }); y += 8;

    let lastMonthKey = null;
    dates.forEach((d) => {
      const monthKey = `${d.year}-${d.monthIdx}`;
      if (isMultiMonth && monthKey !== lastMonthKey) {
        doc.setFont("helvetica", "bold");
        doc.text(`${MONTHS[d.monthIdx]} ${d.year}:`, 24, y); y += 7;
        doc.setFont("helvetica", "normal");
        lastMonthKey = monthKey;
      }
      const suffix = dateSuffix(d);
      doc.text(`•  ${dateLabel(d.dateIso)}${suffix}`, 26, y);
      y += 7;
    });
    doc.text("statt.", 20, y); y += 12;

    doc.text(`Es handelt sich um eine ${inv.student_count ?? (inv.students || []).length}er Gruppe.`, 20, y); y += 12;

    const costLine = isMultiMonth
      ? `Die Kosten für den Zeitraum ${periodLabel(inv)} belaufen sich auf:`
      : `Die Kosten für den Monat ${MONTHS[inv.month_idx]} belaufen sich auf:`;
    doc.text(costLine, 20, y); y += 12;

    doc.setFont("helvetica", "italic");
    (inv.students || []).forEach((s) => {
      const line = `${s.name}: ${s.formula} = ${fmtEUR(s.total)}`;
      doc.text(line, center, y, { align: "center" });
      y += 9;
    });
    doc.setFont("helvetica", "normal");
    y += 8;

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((biller?.paymentInfo || "").trim());
    const payLine = biller?.paymentInfo
      ? (isEmail
          ? `Bitte nehmt das Geld beim nächsten Training mit oder sendet es mir per PayPal an: ${biller.paymentInfo}`
          : `Bitte nehmt das Geld beim nächsten Training mit oder überweist es an: ${biller.paymentInfo}`)
      : "Bitte nehmt das Geld beim nächsten Training mit oder überweist es zeitnah.";
    doc.text(payLine, 20, y, { maxWidth: 170 }); y += 16;

    doc.text("Viele Grüße und ein Dankeschön", 20, y); y += 14;
    if (biller?.name) doc.text(biller.name, 20, y);

    const toM = inv.to_month_idx ?? inv.month_idx;
    const toY = inv.to_year ?? inv.year;
    const suffix = (toY === inv.year && toM === inv.month_idx) ? `${MONTHS[inv.month_idx]}_${inv.year}` : `${MONTHS[inv.month_idx]}${inv.year}-${MONTHS[toM]}${toY}`;
    doc.save(`Rechnung_${(inv.group_name || "").replace(/\s+/g, "_")}_${suffix}.pdf`);
  });
}
