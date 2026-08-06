import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const HOURLY_RATE = 36;

const fmtEUR = (n) => (n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const isoDate = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
function groupLabel(g) {
  return `${g.name} — ${WEEKDAYS[g.weekday]} ${g.time}`;
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

export default function Home() {
  const [tab, setTab] = useState("training");
  const [ready, setReady] = useState(false);
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [attendance, setAttendance] = useState({}); // key: groupId__date -> {id, cancelled, present}
  const [invoices, setInvoices] = useState([]);
  const [biller, setBiller] = useState({ name: "", address: "" });

  const [trainingGroupId, setTrainingGroupId] = useState(null);
  const [trainingYear, setTrainingYear] = useState(new Date().getFullYear());
  const [trainingMonth, setTrainingMonth] = useState(new Date().getMonth());

  const [invoiceGroupId, setInvoiceGroupId] = useState(null);
  const [invoiceYear, setInvoiceYear] = useState(new Date().getFullYear());
  const [invoiceMonth, setInvoiceMonth] = useState(new Date().getMonth());
  const [currentInvoice, setCurrentInvoice] = useState(null);

  const loadAll = useCallback(async () => {
    const [g, s, a, inv, b] = await Promise.all([
      supabase.from("groups").select("*").order("name"),
      supabase.from("students").select("*").order("name"),
      supabase.from("attendance").select("*"),
      supabase.from("invoices").select("*").order("generated_at", { ascending: false }),
      supabase.from("biller").select("*").eq("id", 1).maybeSingle(),
    ]);
    setGroups(g.data || []);
    setStudents(s.data || []);
    const attMap = {};
    (a.data || []).forEach((row) => {
      attMap[`${row.group_id}__${row.date}`] = row;
    });
    setAttendance(attMap);
    setInvoices(inv.data || []);
    if (b.data) setBiller({ name: b.data.name || "", address: b.data.address || "" });
    setReady(true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (!trainingGroupId && groups[0]) setTrainingGroupId(groups[0].id);
    if (!invoiceGroupId && groups[0]) setInvoiceGroupId(groups[0].id);
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Schüler ----
  const addStudent = async (name, groupId, isSchoolchild) => {
    if (!name.trim()) return;
    const { data } = await supabase.from("students").insert({ name: name.trim(), group_id: groupId || null, is_schoolchild: isSchoolchild }).select();
    if (data) setStudents((prev) => [...prev, ...data].sort((x, y) => x.name.localeCompare(y.name)));
  };
  const delStudent = async (id) => {
    await supabase.from("students").delete().eq("id", id);
    setStudents((prev) => prev.filter((s) => s.id !== id));
  };
  const updateStudent = async (id, patch) => {
    const { data } = await supabase.from("students").update(patch).eq("id", id).select().maybeSingle();
    setStudents((prev) => prev.map((s) => (s.id === id ? (data || { ...s, ...patch }) : s)).sort((x, y) => x.name.localeCompare(y.name)));
  };

  // ---- Gruppen ----
  const addGroup = async (name, weekday, time, duration) => {
    if (!name.trim()) return;
    const { data } = await supabase.from("groups").insert({ name: name.trim(), weekday, time, duration }).select();
    if (data) setGroups((prev) => [...prev, ...data].sort((x, y) => x.name.localeCompare(y.name)));
  };
  const delGroup = async (id) => {
    await supabase.from("groups").delete().eq("id", id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  };

  // ---- Training / Anwesenheit ----
  const upsertAttendance = async (groupId, dateIso, patch) => {
    const key = `${groupId}__${dateIso}`;
    const existing = attendance[key] || { cancelled: false, present: {} };
    const next = { ...existing, ...patch };
    const { data } = await supabase
      .from("attendance")
      .upsert({ id: existing.id, group_id: groupId, date: dateIso, cancelled: next.cancelled, present: next.present }, { onConflict: "group_id,date" })
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

  // ---- Rechnung ----
  const saveBiller = async (name, address) => {
    setBiller({ name, address });
    await supabase.from("biller").upsert({ id: 1, name, address });
  };

  const generateInvoice = async (groupId, year, monthIdx) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const dates = datesForMonth(year, monthIdx, group.weekday);
    const groupStudents = students.filter((s) => s.group_id === groupId);
    const studentCount = groupStudents.length;
    const slotCost = HOURLY_RATE * (group.duration / 60);
    const flatShare = studentCount > 0 ? slotCost / studentCount : 0;

    const totals = {};
    const regularCounts = {};
    const holidayBilledCounts = {};
    groupStudents.forEach((s) => { totals[s.id] = 0; regularCounts[s.id] = 0; holidayBilledCounts[s.id] = 0; });
    let heldCount = 0;
    let holidayCount = 0;

    dates.forEach((d) => {
      const dateIso = isoDate(d);
      const entry = attendance[`${groupId}__${dateIso}`] || { cancelled: false, present: {} };
      if (entry.cancelled) return;
      heldCount++;
      if (isBavarianHoliday(dateIso)) {
        holidayCount++;
        // Nicht-Schulkinder zahlen weiterhin den normalen Pauschalanteil.
        groupStudents.filter((s) => !s.is_schoolchild).forEach((s) => { totals[s.id] += flatShare; regularCounts[s.id] += 1; });
        // Schulkinder teilen sich die Kosten nur unter den tatsächlich Anwesenden.
        const attendingSchoolchildren = groupStudents.filter((s) => s.is_schoolchild && entry.present[s.id]);
        if (attendingSchoolchildren.length > 0) {
          const share = slotCost / attendingSchoolchildren.length;
          attendingSchoolchildren.forEach((s) => { totals[s.id] += share; holidayBilledCounts[s.id] += 1; });
        }
      } else {
        groupStudents.forEach((s) => { totals[s.id] += flatShare; regularCounts[s.id] += 1; });
      }
    });

    const studentsOut = groupStudents.map((s) => ({
      id: s.id,
      name: s.name,
      total: totals[s.id],
      regular_count: regularCounts[s.id],
      holiday_billed_count: holidayBilledCounts[s.id],
      holiday_missed_count: holidayCount - holidayBilledCounts[s.id],
    }));
    const total = studentsOut.reduce((sum, s) => sum + s.total, 0);

    const record = {
      group_id: groupId,
      group_name: group.name,
      year,
      month_idx: monthIdx,
      held_count: heldCount,
      holiday_count: holidayCount,
      price_per_training_per_student: flatShare,
      total,
      students: studentsOut,
    };
    const { data } = await supabase.from("invoices").insert(record).select().maybeSingle();
    const invoice = data || { ...record, generated_at: new Date().toISOString() };
    setInvoices((prev) => [invoice, ...prev]);
    setCurrentInvoice(invoice);
    downloadInvoicePdf(invoice, biller);
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
          onToggleCancel={toggleCancelled} onTogglePresent={togglePresent}
        />
      )}
      {tab === "schueler" && (
        <StudentsTab students={students} groups={groups} onAdd={addStudent} onDelete={delStudent} onUpdate={updateStudent} />
      )}
      {tab === "gruppen" && (
        <GroupsTab groups={groups} students={students} onAdd={addGroup} onDelete={delGroup} />
      )}
      {tab === "rechnungen" && (
        <InvoicesTab
          groups={groups} biller={biller} onSaveBiller={saveBiller}
          groupId={invoiceGroupId} setGroupId={setInvoiceGroupId}
          year={invoiceYear} monthIdx={invoiceMonth}
          setYear={setInvoiceYear} setMonthIdx={setInvoiceMonth}
          onGenerate={generateInvoice}
          current={currentInvoice} setCurrent={setCurrentInvoice}
          invoices={invoices}
        />
      )}
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
  const items = [["training", "Training"], ["schueler", "Schüler"], ["gruppen", "Gruppen"], ["rechnungen", "Rechnung"]];
  return (
    <div className="nav"><div className="nav-inner">
      {items.map(([id, label]) => (
        <button key={id} className={`nav-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
      ))}
    </div></div>
  );
}

function StudentsTab({ students, groups, onAdd, onDelete, onUpdate }) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [isSchoolchild, setIsSchoolchild] = useState(true);
  const [editingId, setEditingId] = useState(null);

  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Schüler anlegen</div>
      <div className="card col">
        <input placeholder="Name des Schülers" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">— keine Gruppe —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
        </select>
        <label className="row" style={{ cursor: "pointer" }}>
          <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Geht noch zur Schule (betrifft Ferienregelung)</span>
          <input type="checkbox" style={{ width: "auto" }} checked={isSchoolchild} onChange={(e) => setIsSchoolchild(e.target.checked)} />
        </label>
        <button className="btn-primary" onClick={() => { onAdd(name, groupId, isSchoolchild); setName(""); }}>+ Schüler hinzufügen</button>
        {groups.length === 0 && <div className="tag" style={{ color: "var(--clay)" }}>Lege zuerst eine Gruppe an (Tab „Gruppen").</div>}
      </div>
      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Alle Schüler ({students.length})</div>
      {students.length === 0 && <div className="empty">Noch keine Schüler angelegt.</div>}
      {students.map((s) =>
        editingId === s.id ? (
          <EditStudentCard key={s.id} student={s} groups={groups} onCancel={() => setEditingId(null)}
            onSave={(patch) => { onUpdate(s.id, patch); setEditingId(null); }} />
        ) : (
          <div key={s.id} className="card row" style={{ marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 500 }}>{s.name}</div>
              <div className="tag">{(groups.find((g) => g.id === s.group_id)?.name) || "— keine Gruppe —"} · {s.is_schoolchild ? "Schüler" : "Kein Schüler"}</div>
            </div>
            <div className="gap2">
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
  const [groupId, setGroupId] = useState(student.group_id || "");
  const [isSchoolchild, setIsSchoolchild] = useState(!!student.is_schoolchild);
  return (
    <div className="card col" style={{ marginBottom: 8, borderColor: "var(--ball)" }}>
      <input placeholder="Name des Schülers" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        <option value="">— keine Gruppe —</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
      </select>
      <label className="row" style={{ cursor: "pointer" }}>
        <span className="tag" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0 }}>Geht noch zur Schule (betrifft Ferienregelung)</span>
        <input type="checkbox" style={{ width: "auto" }} checked={isSchoolchild} onChange={(e) => setIsSchoolchild(e.target.checked)} />
      </label>
      <div className="gap2">
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => onSave({ name: name.trim(), group_id: groupId || null, is_schoolchild: isSchoolchild })}>Speichern</button>
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
  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Gruppe anlegen</div>
      <div className="card col">
        <input placeholder="Gruppenname (z. B. Kids Mittwoch)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="gap2">
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={{ flex: 2 }}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="gap2" style={{ alignItems: "center" }}>
          <input type="number" min="15" step="15" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          <span className="tag" style={{ whiteSpace: "nowrap" }}>Minuten Dauer</span>
        </div>
        <button className="btn-primary" onClick={() => { onAdd(name, weekday, time, duration); setName(""); }}>+ Gruppe anlegen</button>
      </div>
      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Alle Gruppen ({groups.length})</div>
      {groups.length === 0 && <div className="empty">Noch keine Gruppen angelegt.</div>}
      {groups.map((g) => {
        const count = students.filter((s) => s.group_id === g.id).length;
        return (
          <div key={g.id} className="card row" style={{ marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 500 }}>{g.name}</div>
              <div className="tag">{WEEKDAYS[g.weekday]} · {g.time} Uhr · {g.duration} Min · {count} Schüler</div>
            </div>
            <button className="icon-btn" onClick={() => onDelete(g.id)}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

function TrainingTab({ groups, students, attendance, groupId, setGroupId, year, monthIdx, setYear, setMonthIdx, onToggleCancel, onTogglePresent }) {
  if (groups.length === 0) return <div className="empty">Lege zuerst eine Gruppe an (Tab „Gruppen").</div>;
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const groupStudents = students.filter((s) => s.group_id === group.id);
  const dates = datesForMonth(year, monthIdx, group.weekday);

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
      <div className="tag" style={{ marginBottom: 12 }}>{WEEKDAYS[group.weekday]}, {group.time} Uhr · {group.duration} Min · {groupStudents.length} Schüler</div>
      {dates.length === 0 && <div className="empty">Kein passender Wochentag in diesem Monat.</div>}
      {dates.map((d) => {
        const dateIso = isoDate(d);
        const entry = attendance[`${group.id}__${dateIso}`] || { cancelled: false, present: {} };
        const dateLabel = d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
        return (
          <div key={dateIso} className="card" style={{ marginBottom: 8, opacity: entry.cancelled ? 0.55 : 1 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 500 }}>{dateLabel}</div>
              <button className="tag" style={{ background: "none", border: "none", cursor: "pointer", color: entry.cancelled ? "var(--clay)" : "var(--chalk-dim)" }} onClick={() => onToggleCancel(group.id, dateIso)}>
                {entry.cancelled ? "Ausgefallen ✕ (wieder aktivieren)" : "Als ausgefallen markieren"}
              </button>
            </div>
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
      <div className="tag" style={{ marginTop: 12 }}>Anwesenheit dient nur der Dokumentation und wirkt sich nicht auf die Rechnung aus.</div>
    </div>
  );
}

function InvoicesTab({ groups, biller, onSaveBiller, groupId, setGroupId, year, monthIdx, setYear, setMonthIdx, onGenerate, current, setCurrent, invoices }) {
  const [billerName, setBillerName] = useState(biller.name);
  const [billerAddress, setBillerAddress] = useState(biller.address);
  useEffect(() => { setBillerName(biller.name); setBillerAddress(biller.address); }, [biller]);

  const activeGroupId = groupId || groups[0]?.id;

  return (
    <div>
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Rechnung erstellen</div>
      <div className="card col" style={{ marginBottom: 12 }}>
        <input placeholder="Dein Name / Firma (für Rechnungskopf)" value={billerName} onChange={(e) => setBillerName(e.target.value)} onBlur={() => onSaveBiller(billerName, billerAddress)} />
        <input placeholder="Adresse (optional)" value={billerAddress} onChange={(e) => setBillerAddress(e.target.value)} onBlur={() => onSaveBiller(billerName, billerAddress)} />
      </div>
      <div className="card col">
        {groups.length === 0 ? <div className="tag">Keine Gruppen vorhanden</div> : (
          <select value={activeGroupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
          </select>
        )}
        <div className="gap2">
          <select value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))} style={{ flex: 2 }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ flex: 1 }} />
        </div>
        <button className="btn-primary" disabled={groups.length === 0} onClick={() => onGenerate(activeGroupId, year, monthIdx)}>⬇ PDF-Rechnung erstellen</button>
        <div className="tag">Erstellt eine PDF mit je einer Seite pro Schüler und lädt sie direkt herunter.</div>
      </div>

      {current && <InvoiceView invoice={current} biller={biller} />}

      <div className="net-divider" />
      <div className="disp" style={{ fontSize: 18, marginBottom: 12 }}>Verlauf ({invoices.length})</div>
      {invoices.length === 0 && <div className="empty">Noch keine Rechnungen erstellt.</div>}
      {invoices.map((inv) => (
        <button key={inv.id} className="card" style={{ textAlign: "left", width: "100%", marginBottom: 8, cursor: "pointer" }} onClick={() => setCurrent(inv)}>
          <div style={{ fontWeight: 500 }}>{inv.group_name} — {MONTHS[inv.month_idx]} {inv.year}</div>
          <div className="tag">{inv.held_count} Trainings · Gesamt {fmtEUR(inv.total)}</div>
        </button>
      ))}
    </div>
  );
}

function studentBreakdownText(s, flatShare) {
  const parts = [`${s.regular_count}x regulär (${fmtEUR(flatShare)})`];
  if (s.holiday_billed_count > 0) parts.push(`${s.holiday_billed_count}x Ferien besucht`);
  if (s.holiday_missed_count > 0) parts.push(`${s.holiday_missed_count}x Ferien nicht da (nicht berechnet)`);
  return parts.join(" · ");
}

function InvoiceView({ invoice, biller }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="disp" style={{ fontSize: 16, marginBottom: 2 }}>{invoice.group_name} — {MONTHS[invoice.month_idx]} {invoice.year}</div>
      <div className="tag" style={{ marginBottom: 10 }}>
        {invoice.held_count} stattgefundene Trainings
        {invoice.holiday_count > 0 && <> · davon {invoice.holiday_count} in den Ferien (abweichende Abrechnung)</>}
      </div>
      <div className="net-divider" style={{ margin: "10px 0" }} />
      {(invoice.students || []).map((s) => (
        <div key={s.id} style={{ margin: "8px 0" }}>
          <div className="row">
            <span>{s.name}</span>
            <span className="disp">{fmtEUR(s.total)}</span>
          </div>
          <div className="tag" style={{ fontSize: 10, marginTop: 2 }}>{studentBreakdownText(s, invoice.price_per_training_per_student)}</div>
        </div>
      ))}
      <div className="net-divider" style={{ margin: "10px 0" }} />
      <div className="row"><span className="disp" style={{ fontSize: 16 }}>Gesamt</span><span className="disp" style={{ fontSize: 18, color: "var(--ball)" }}>{fmtEUR(invoice.total)}</span></div>
      <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => downloadInvoicePdf(invoice, biller)}>⬇ PDF erneut herunterladen</button>
    </div>
  );
}

function downloadInvoicePdf(inv, biller) {
  import("jspdf").then(({ jsPDF }) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const students = (inv.students && inv.students.length) ? inv.students : [{ name: "—" }];
    students.forEach((s, idx) => {
      if (idx > 0) doc.addPage();
      let y = 20;
      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("RECHNUNG", 20, y); y += 12;

      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      if (biller?.name) { doc.text(biller.name, 20, y); y += 5; }
      if (biller?.address) { doc.text(biller.address, 20, y); y += 5; }
      y += 6;

      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text("An:", 20, y);
      doc.setFont("helvetica", "normal");
      doc.text(s.name, 32, y); y += 10;

      const monthIdx = inv.month_idx ?? inv.monthIdx;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text(`Rechnungsnummer: ${inv.year}${String(monthIdx + 1).padStart(2, "0")}-${(inv.group_name || "").replace(/\s+/g, "").slice(0, 6).toUpperCase()}-${idx + 1}`, 20, y); y += 6;
      doc.text(`Rechnungsdatum: ${new Date(inv.generated_at || Date.now()).toLocaleDateString("de-DE")}`, 20, y); y += 6;
      doc.text(`Leistungszeitraum: ${MONTHS[monthIdx]} ${inv.year}`, 20, y); y += 10;

      doc.setDrawColor(180); doc.line(20, y, 190, y); y += 8;
      doc.setFont("helvetica", "bold");
      doc.text("Leistung", 20, y); doc.text("Anzahl", 120, y); doc.text("Betrag", 170, y); y += 6;
      doc.setDrawColor(180); doc.line(20, y, 190, y); y += 8;

      doc.setFont("helvetica", "normal");
      doc.text(`Tennistraining, Gruppe „${inv.group_name}"`, 20, y);
      doc.text(String((s.regular_count || 0) + (s.holiday_billed_count || 0)), 122, y);
      doc.text(fmtEUR(s.total), 170, y);
      y += 6;
      doc.setFontSize(9); doc.setTextColor(120);
      const parts = [`${s.regular_count || 0}x regulär (${fmtEUR(inv.price_per_training_per_student)})`];
      if (s.holiday_billed_count > 0) parts.push(`${s.holiday_billed_count}x Ferien besucht`);
      if (s.holiday_missed_count > 0) parts.push(`${s.holiday_missed_count}x Ferien nicht da (nicht berechnet)`);
      doc.text(parts.join(" / "), 20, y);
      doc.setFontSize(10); doc.setTextColor(0);
      y += 10;

      doc.setDrawColor(180); doc.line(20, y, 190, y); y += 10;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text("Gesamtbetrag", 20, y);
      doc.text(fmtEUR(s.total), 170, y);
      y += 20;

      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
      doc.text("Bitte überweisen Sie den Betrag innerhalb von 14 Tagen.", 20, y);
    });
    const monthIdx = inv.month_idx ?? inv.monthIdx;
    doc.save(`Rechnung_${(inv.group_name || "").replace(/\s+/g, "_")}_${MONTHS[monthIdx]}_${inv.year}.pdf`);
  });
}
