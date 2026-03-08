import { useState, useRef, useEffect } from "react";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getEfficiency(estimated, actual) {
  return Math.round(((estimated - actual) / estimated) * 100);
}
function formatMin(min) {
  if (!min && min !== 0) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function formatSeconds(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}
function todayKey() { return toDateKey(new Date()); }
function offsetKey(days) {
  const d = new Date(); d.setDate(d.getDate() + days); return toDateKey(d);
}

// Parse natural language date tokens from task name
// Returns { cleanName, dateKey } — dateKey null if no date found
function parseDateFromName(raw) {
  const lower = raw.toLowerCase().trim();
  const patterns = [
    { re: /\s*(today|tod)\s*$/i,     offset: 0 },
    { re: /\s*(tomorrow|tom)\s*$/i,  offset: 1 },
    { re: /\s*monday\s*$/i,    weekday: 1 },
    { re: /\s*tuesday\s*$/i,   weekday: 2 },
    { re: /\s*wednesday\s*$/i, weekday: 3 },
    { re: /\s*thursday\s*$/i,  weekday: 4 },
    { re: /\s*friday\s*$/i,    weekday: 5 },
    { re: /\s*saturday\s*$/i,  weekday: 6 },
    { re: /\s*sunday\s*$/i,    weekday: 0 },
  ];
  for (const p of patterns) {
    if (p.re.test(lower)) {
      const cleanName = raw.replace(p.re, "").trim();
      let dateKey;
      if (p.offset !== undefined) {
        dateKey = offsetKey(p.offset);
      } else {
        const today = new Date();
        const todayWd = today.getDay();
        let diff = p.weekday - todayWd;
        if (diff <= 0) diff += 7;
        const d = new Date(); d.setDate(d.getDate() + diff);
        dateKey = toDateKey(d);
      }
      return { cleanName, dateKey };
    }
  }
  // MM/DD or MM-DD
  const mdMatch = raw.match(/\s+(\d{1,2})[\/\-](\d{1,2})\s*$/);
  if (mdMatch) {
    const [, mo, dy] = mdMatch;
    const d = new Date();
    d.setMonth(parseInt(mo) - 1); d.setDate(parseInt(dy));
    return { cleanName: raw.replace(mdMatch[0], "").trim(), dateKey: toDateKey(d) };
  }
  return { cleanName: raw, dateKey: null };
}

function buildSuggestions(completed) {
  const groups = {};
  for (const t of completed) {
    const key = t.name.toLowerCase().trim();
    if (!groups[key]) groups[key] = { name: t.name, actuals: [] };
    groups[key].actuals.push(t.actual);
  }
  return Object.values(groups)
    .filter(g => g.actuals.length >= 3)
    .map(g => ({ name: g.name, avg: Math.round(g.actuals.reduce((a,b)=>a+b,0)/g.actuals.length) }));
}
function getMatches(query, suggestions) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return suggestions.filter(s => s.name.toLowerCase().includes(q)).slice(0, 5);
}

// ─────────────────────────────────────────────
// LOCAL STORAGE
// ─────────────────────────────────────────────

const LS_KEYS = { tasks: "tt_tasks", allCompleted: "tt_allCompleted", visibleCompleted: "tt_visibleCompleted", dayHistory: "tt_dayHistory", idCounter: "tt_idCounter" };

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────

const today = todayKey();
const SEED_TASKS = [
  { id: 1, name: "Review weekly metrics",  estimated: 20, dateKey: today },
  { id: 2, name: "Reply to client emails", estimated: 30, dateKey: today },
  { id: 3, name: "Update project roadmap", estimated: 45, dateKey: null  },
];
const SEED_VISIBLE = [
  { id: 7, name: "Write team standup notes", estimated: 15, actual: 10, dateKey: today },
  { id: 8, name: "Fix homepage layout bug",  estimated: 30, actual: 50, dateKey: today },
  { id: 9, name: "Prep Q2 budget summary",   estimated: 60, actual: 55, dateKey: today },
];
const SEED_HISTORY = [
  { id: 11, name: "Write team standup notes", estimated: 15, actual: 12, dateKey: today },
  { id: 12, name: "Write team standup notes", estimated: 15, actual: 11, dateKey: today },
  { id: 13, name: "Fix homepage layout bug",  estimated: 30, actual: 45, dateKey: today },
  { id: 14, name: "Fix homepage layout bug",  estimated: 30, actual: 48, dateKey: today },
  { id: 15, name: "Prep Q2 budget summary",   estimated: 60, actual: 58, dateKey: today },
  { id: 16, name: "Prep Q2 budget summary",   estimated: 60, actual: 52, dateKey: today },
];

// Build seeded day history (last 7 days with fake data)
function buildSeedDayHistory() {
  const hist = {};
  const labels = ["Great day", "Slow morning", "On track", "Crushed it", "Mixed bag", "Behind", "Today"];
  for (let i = 6; i >= 0; i--) {
    const key = offsetKey(-i);
    if (i === 0) {
      // today seeded from visible
      const totalEst = SEED_VISIBLE.reduce((s,t)=>s+t.estimated,0);
      const totalAct = SEED_VISIBLE.reduce((s,t)=>s+t.actual,0);
      hist[key] = { totalEst, totalAct, count: SEED_VISIBLE.length };
    } else {
      // fake data for past days
      const fakeEff = [18, -12, 5, 30, -8, 22][6 - i] || 0;
      const totalEst = 120;
      const totalAct = Math.round(totalEst * (1 - fakeEff / 100));
      hist[key] = { totalEst, totalAct, count: 3 };
    }
  }
  return hist;
}

// ─────────────────────────────────────────────
// EFFICIENCY WEEK BAR
// ─────────────────────────────────────────────

function WeekBar({ dayHistory, streak }) {
  const days = [];
  const DAY_ABBR = ["S","M","T","W","Th","F","S"];
  // Build oldest-to-newest (i=6 is 6 days ago, i=0 is today) so today ends up rightmost
  for (let i = 6; i >= 0; i--) {
    const key = offsetKey(-i);
    const d = new Date(); d.setDate(d.getDate() - i);
    const abbr = i === 0 ? "Tod" : DAY_ABBR[d.getDay()];
    const hist = dayHistory[key];
    let color = "#3a3530";
    let eff = null;
    if (hist && hist.count > 0) {
      eff = Math.round(((hist.totalEst - hist.totalAct) / hist.totalEst) * 100);
      color = eff >= 0 ? "#4ade80" : "#f87171";
    }
    const isToday = i === 0;
    days.push({ key, abbr, color, eff, isToday });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4 }}>
        {days.map(d => (
          <div key={d.key}
            style={{
              width: 36, height: 36, borderRadius: 8, background: d.color,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              border: d.isToday ? "2px solid #f59e0b" : "2px solid transparent",
              cursor: "default",
            }}
          >
            <span style={{ fontSize: d.isToday ? 9 : 10, fontWeight: 700, color: d.color === "#3a3530" ? "#6b6460" : "#fff" }}>{d.abbr}</span>
            {d.eff !== null && <span style={{ fontSize: 8, fontWeight: 600, color: "#fff", lineHeight: 1 }}>{d.eff > 0 ? "+" : ""}{d.eff}%</span>}
          </div>
        ))}
      </div>
      {streak > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff8ee", border: "1px solid #fde68a", borderRadius: 20, padding: "4px 12px" }}>
          <span style={{ fontSize: 16 }}>🔥</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#b45309" }}>{streak} day streak</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TASK CARD (shared between list + board)
// ─────────────────────────────────────────────

function TaskCard({ task, timerState, elapsed, onStartTimer, onPauseTimer, onResumeTimer, onEndTimer, onComplete, onDelete, onEdit, compact = false }) {
  const [editing, setEditing]       = useState(false);
  const [editName, setEditName]     = useState(task.name);
  const [editMin, setEditMin]       = useState(String(task.estimated));
  const [logging, setLogging]       = useState(false);
  const [logMinutes, setLogMinutes] = useState("");
  const editMinRef = useRef();
  const logRef     = useRef();

  const isRunning = timerState === "running";
  const isPaused  = timerState === "paused";
  const isActive  = isRunning || isPaused;
  const overEst   = isActive && elapsed > task.estimated * 60;

  function saveEdit() {
    const n = editName.trim(), m = parseInt(editMin);
    if (!n || !m || m <= 0) return;
    onEdit(task.id, n, m);
    setEditing(false);
  }
  function cancelEdit() { setEditName(task.name); setEditMin(String(task.estimated)); setEditing(false); }

  function handleLog() {
    const m = parseInt(logMinutes);
    if (!m || m <= 0) return;
    onComplete(task.id, m);
    setLogging(false);
    setLogMinutes("");
  }

  if (editing) return (
    <div style={{ background: "#fff", border: "1px solid #b35c00", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 0 0 3px rgba(179,92,0,0.1)" }}>
      <input autoFocus type="text" value={editName} onChange={e => setEditName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") editMinRef.current?.focus(); if (e.key === "Escape") cancelEdit(); }}
        style={{ border: "1px solid #ddd9d0", borderRadius: 7, padding: "6px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#1a1814" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <input ref={editMinRef} type="number" inputMode="numeric" pattern="[0-9]*" min="1" value={editMin}
          onChange={e => setEditMin(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
          style={{ flex: 1, border: "1px solid #ddd9d0", borderRadius: 7, padding: "6px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#1a1814" }} />
        <button onClick={saveEdit} style={{ background: "#1a1814", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Save</button>
        <button onClick={cancelEdit} style={{ background: "none", color: "#a09880", border: "1px solid #ddd9d0", borderRadius: 7, padding: "6px 10px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
      </div>
    </div>
  );

  return (
    <div style={{
      background: isRunning ? "#f0fdf4" : isPaused ? "#fffbeb" : "#fff",
      border: isRunning ? "1.5px solid #4ade80" : isPaused ? "1.5px solid #fbbf24" : "1.5px solid #ede9e1",
      borderRadius: 10, padding: compact ? "10px 12px" : "12px 14px",
      display: "flex", flexDirection: "column", gap: 6,
      transition: "box-shadow 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.07)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isRunning && <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", letterSpacing: "0.06em", textTransform: "uppercase", animation: "pulse 1.4s ease-in-out infinite" }}>Live</span>}
        {isPaused  && <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309", letterSpacing: "0.06em", textTransform: "uppercase" }}>Paused</span>}
        <span style={{ flex: 1, fontSize: compact ? 13 : 14, color: "#1a1814", fontWeight: 500, lineHeight: 1.3 }}>{task.name}</span>
        {isActive && (
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "Georgia, serif", color: overEst ? "#ef4444" : "#1a1814", flexShrink: 0 }}>
            {formatSeconds(elapsed)}
          </span>
        )}
        {!isActive && <button onClick={() => { setEditing(true); setLogging(false); }} style={{ background: "#f4f0e8", border: "none", borderRadius: 7, cursor: "pointer", color: "#888", fontSize: 13, padding: "5px 9px", lineHeight: 1, flexShrink: 0, fontWeight: 600 }} title="Edit">✎</button>}
        <button onClick={() => onDelete(task.id)} style={{ background: "#fde8e8", border: "none", borderRadius: 7, cursor: "pointer", color: "#c0392b", fontSize: 13, padding: "5px 9px", lineHeight: 1, flexShrink: 0, fontWeight: 700 }} title="Delete">✕</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#a09880", background: "#f4f0e8", borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>
          est. {formatMin(task.estimated)}
        </span>
        {task.dateKey && (
          <span style={{ fontSize: 11, color: "#6b8cba", background: "#eef4ff", borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>
            {task.dateKey === todayKey() ? "Today" : task.dateKey === offsetKey(1) ? "Tomorrow" : task.dateKey}
          </span>
        )}
      </div>

      {/* Timer controls */}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        {!isActive && !logging && (
          <button onClick={() => onStartTimer(task)} style={{ flex: 1, background: "#f4f0e8", border: "none", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#555", letterSpacing: "0.03em" }}>Start Timer</button>
        )}
        {isRunning && (
          <button onClick={() => onPauseTimer(task.id)} style={{ flex: 1, background: "#fef3c7", border: "none", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#b45309", letterSpacing: "0.03em" }}>Pause</button>
        )}
        {isPaused && (
          <button onClick={() => onResumeTimer(task)} style={{ flex: 1, background: "#dcfce7", border: "none", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#166534", letterSpacing: "0.03em" }}>Resume</button>
        )}
        {isActive && (
          <button onClick={() => onEndTimer(task.id)} style={{ flex: 1, background: "#1a1814", color: "#fff", border: "none", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: "0.03em" }}>Done</button>
        )}
      </div>

      {/* Manual log row */}
      {!isActive && (
        logging ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
            <input
              ref={logRef} autoFocus
              type="number" inputMode="numeric" pattern="[0-9]*" min="1"
              placeholder="How many minutes did it take?"
              value={logMinutes} onChange={e => setLogMinutes(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleLog(); if (e.key === "Escape") { setLogging(false); setLogMinutes(""); } }}
              style={{ flex: 1, border: "1px solid #e2ddd6", borderRadius: 7, padding: "5px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: "#1a1814" }}
            />
            <button onClick={handleLog} style={{ background: "#1a1814", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Log</button>
            <button onClick={() => { setLogging(false); setLogMinutes(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#a09880", fontSize: 12, fontFamily: "inherit" }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setLogging(true)} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#b0a898", fontSize: 11, fontFamily: "inherit",
            textAlign: "left", padding: "0", textDecoration: "underline",
            textDecorationStyle: "dotted", textUnderlineOffset: "3px",
          }}>
            Forgot to start timer? Log manually
          </button>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// COMPLETED ROW
// ─────────────────────────────────────────────

function CompletedRow({ task, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const [editEst, setEditEst]   = useState(String(task.estimated));
  const [editAct, setEditAct]   = useState(String(task.actual));
  const estRef = useRef();
  const actRef = useRef();

  const pct   = getEfficiency(task.estimated, task.actual);
  const sign  = pct > 0 ? "+" : "";
  const color = pct > 0 ? "#1a5c8a" : pct === 0 ? "#2d6a4f" : "#7a7a7a";
  const bg    = pct > 0 ? "#daeeff"  : pct === 0 ? "#d8f3dc"  : "#f0f0ee";

  function saveEdit() {
    const n = editName.trim(), e = parseInt(editEst), a = parseInt(editAct);
    if (!n || !e || !a || e <= 0 || a <= 0) return;
    onEdit(task.id, n, e, a);
    setEditing(false);
  }
  function cancelEdit() {
    setEditName(task.name); setEditEst(String(task.estimated)); setEditAct(String(task.actual));
    setEditing(false);
  }

  if (editing) return (
    <div style={{ background: "#fff", border: "1px solid #b35c00", borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 0 0 3px rgba(179,92,0,0.08)" }}>
      <input autoFocus type="text" value={editName} onChange={e => setEditName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") estRef.current?.focus(); if (e.key === "Escape") cancelEdit(); }}
        style={{ border: "1px solid #e2ddd6", borderRadius: 7, padding: "6px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#1a1814" }}
        placeholder="Task name"
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input ref={estRef} type="number" inputMode="numeric" pattern="[0-9]*" min="1" value={editEst}
          onChange={e => setEditEst(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") actRef.current?.focus(); if (e.key === "Escape") cancelEdit(); }}
          style={{ flex: 1, border: "1px solid #e2ddd6", borderRadius: 7, padding: "6px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#1a1814" }}
          placeholder="Est. min"
        />
        <input ref={actRef} type="number" inputMode="numeric" pattern="[0-9]*" min="1" value={editAct}
          onChange={e => setEditAct(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
          style={{ flex: 1, border: "1px solid #e2ddd6", borderRadius: 7, padding: "6px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#1a1814" }}
          placeholder="Actual min"
        />
        <button onClick={saveEdit} style={{ background: "#1a1814", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Save</button>
        <button onClick={cancelEdit} style={{ background: "none", color: "#a09880", border: "1px solid #e2ddd6", borderRadius: 7, padding: "6px 10px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
      </div>
    </div>
  );

  return (
    <div style={{ background: "#fafaf8", border: "1px solid #ede9e1", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ color: "#4ade80", fontWeight: 900, flexShrink: 0 }}>✓</span>
      <span style={{ flex: 1, fontSize: 13, color: "#888", textDecoration: "line-through", minWidth: 80 }}>{task.name}</span>
      <span style={{ background: bg, color, borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>{sign}{pct}%</span>
      <span style={{ fontSize: 11, color: "#a09880" }}>{formatMin(task.actual)}</span>
      <button onClick={() => setEditing(true)} style={{ background: "#f4f0e8", border: "none", borderRadius: 7, cursor: "pointer", color: "#888", fontSize: 13, padding: "5px 9px", lineHeight: 1, fontWeight: 600 }} title="Edit">✎</button>
      <button onClick={() => onDelete(task.id)} style={{ background: "#fde8e8", border: "none", borderRadius: 7, cursor: "pointer", color: "#c0392b", fontSize: 13, padding: "5px 9px", lineHeight: 1, fontWeight: 700 }} title="Delete">✕</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCORE SUMMARY
// ─────────────────────────────────────────────

function ScoreSummary({ completed }) {
  if (!completed.length) return null;
  const totalEst = completed.reduce((s,t) => s+t.estimated, 0);
  const totalAct = completed.reduce((s,t) => s+t.actual,    0);
  const effPct   = Math.round(((totalEst - totalAct) / totalEst) * 100);
  const sign     = effPct > 0 ? "+" : "";
  const effColor = effPct > 0 ? "#16a34a" : effPct < 0 ? "#dc2626" : "#1a1814";
  return (
    <div style={{ background: "#f8f6f1", border: "1px solid #e8e4db", borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap" }}>
      {[
        { label: "Done",      value: completed.length },
        { label: "Estimated", value: formatMin(totalEst) },
        { label: "Actual",    value: formatMin(totalAct) },
        { label: "Efficiency",value: `${sign}${effPct}%`, color: effColor },
      ].map(s => (
        <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#a09880", fontWeight: 600 }}>{s.label}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: s.color || "#1a1814", fontFamily: "Georgia, serif" }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// CONFIRM DIALOG
// ─────────────────────────────────────────────

function ConfirmDialog({ runningTaskName, newTaskName, onPause, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "28px", maxWidth: 380, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#1a1814" }}>Switch tasks?</p>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>
          <strong>"{runningTaskName}"</strong> is running. Pause it and start <strong>"{newTaskName}"</strong>?
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "none", border: "1px solid #e2ddd6", borderRadius: 8, padding: "8px 16px", fontSize: 14, cursor: "pointer", fontFamily: "inherit", color: "#666" }}>Cancel</button>
          <button onClick={onPause}  style={{ background: "#1a1814", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Pause &amp; Switch</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FLOATING BAR
// ─────────────────────────────────────────────

function FloatingBar({ task, elapsed, isRunning, onPause, onResume, onEnd }) {
  if (!task) return null;
  const overEst = elapsed > task.estimated * 60;
  return (
    <div style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      background: "#1a1814", color: "#fff", borderRadius: 16,
      padding: "12px 18px", display: "flex", alignItems: "center", gap: 12,
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)", zIndex: 500,
      minWidth: 280, maxWidth: "calc(100vw - 40px)",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: isRunning ? "#4ade80" : "#fbbf24", flexShrink: 0, animation: isRunning ? "pulse 1.4s ease-in-out infinite" : "none", display: "inline-block" }} />
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</span>
      <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "Georgia, serif", color: overEst ? "#f87171" : "#fff", flexShrink: 0 }}>{formatSeconds(elapsed)}</span>
      <span style={{ fontSize: 11, color: "#6b6b6b", flexShrink: 0 }}>/ {formatMin(task.estimated)}</span>
      {isRunning
        ? <button onClick={onPause}  style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", padding: "5px 12px", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em" }}>Pause</button>
        : <button onClick={onResume} style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", padding: "5px 12px", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em" }}>Resume</button>
      }
      <button onClick={onEnd} style={{ background: "#16a34a", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", padding: "5px 14px", fontSize: 12, fontWeight: 700, letterSpacing: "0.03em" }}>Done</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// ADD TASK FORM
// ─────────────────────────────────────────────

function AddTaskForm({ onAdd, suggestions }) {
  const [name, setName]       = useState("");
  const [minutes, setMinutes] = useState("");
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActive] = useState(-1);
  const [datePreview, setDatePreview] = useState(null);
  const nameRef    = useRef();
  const minutesRef = useRef();
  const dropRef    = useRef();

  const matches = getMatches(name, suggestions);

  useEffect(() => {
    const { dateKey, cleanName } = parseDateFromName(name);
    setDatePreview(dateKey ? { dateKey, cleanName } : null);
  }, [name]);

  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target) && nameRef.current && !nameRef.current.contains(e.target))
        setShowSug(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function applySuggestion(s) {
    setName(s.name); setMinutes(String(s.avg));
    setShowSug(false); setActive(-1);
    setTimeout(() => minutesRef.current?.focus(), 50);
  }

  function handleAdd() {
    const { cleanName, dateKey } = parseDateFromName(name);
    const n = cleanName.trim(), m = parseInt(minutes);
    if (!n || !m || m <= 0) return;
    onAdd(n, m, dateKey);
    setName(""); setMinutes(""); setShowSug(false); setActive(-1);
    nameRef.current?.focus();
  }

  const dateLabelMap = { [todayKey()]: "Today", [offsetKey(1)]: "Tomorrow" };
  const dateLabel = datePreview ? (dateLabelMap[datePreview.dateKey] || datePreview.dateKey) : null;

  return (
    <div style={{ background: "#fff", border: "1px solid #e8e4db", borderRadius: 14, padding: "16px", marginBottom: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 180px", position: "relative" }}>
          <input ref={nameRef} type="text" placeholder='Task name — type "today", "tomorrow", or a weekday' value={name}
            onChange={e => { setName(e.target.value); setShowSug(true); setActive(-1); }}
            onFocus={() => setShowSug(true)}
            onKeyDown={e => {
              if (showSug && matches.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i+1, matches.length-1)); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); setActive(i => Math.max(i-1, -1)); return; }
                if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); applySuggestion(matches[activeIdx]); return; }
                if (e.key === "Escape") { setShowSug(false); return; }
              }
              if (e.key === "Enter" && name.trim()) { e.preventDefault(); minutesRef.current?.focus(); }
            }}
            style={{ width: "100%", border: "1px solid #e2ddd6", borderRadius: 9, padding: "9px 12px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#1a1814", transition: "border-color 0.15s, box-shadow 0.15s" }}
          />
          {datePreview && (
            <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "#eef4ff", color: "#3b6cb7", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, pointerEvents: "none" }}>
              📅 {dateLabel}
            </div>
          )}
          {showSug && matches.length > 0 && (
            <div ref={dropRef} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e8e4db", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", zIndex: 200, overflow: "hidden" }}>
              {matches.map((s, i) => (
                <div key={s.name} onMouseDown={() => applySuggestion(s)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 14px", cursor: "pointer", fontSize: 14, background: i === activeIdx ? "#f4f0e8" : "#fff", borderBottom: i < matches.length-1 ? "1px solid #f0ece4" : "none" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f4f0e8"}
                  onMouseLeave={e => e.currentTarget.style.background = i === activeIdx ? "#f4f0e8" : "#fff"}
                >
                  <span style={{ color: "#1a1814", fontWeight: 500 }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: "#a09880", background: "#f4f0e8", borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>avg {formatMin(s.avg)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <input ref={minutesRef} type="number" inputMode="numeric" pattern="[0-9]*" placeholder="Min" min="1" value={minutes}
          onChange={e => setMinutes(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()}
          style={{ flex: "0 0 80px", border: "1px solid #e2ddd6", borderRadius: 9, padding: "9px 12px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#1a1814", transition: "border-color 0.15s, box-shadow 0.15s" }}
        />
        <button onClick={handleAdd}
          style={{ background: "#1a1814", color: "#fff", border: "none", borderRadius: 9, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0, transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#b35c00"}
          onMouseLeave={e => e.currentTarget.style.background = "#1a1814"}
        >+ Add</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// BOARD VIEW
// ─────────────────────────────────────────────

function BoardView({ tasks, timers, onStartTimer, onPauseTimer, onResumeTimer, onEndTimer, onComplete, onDelete, onEdit }) {
  const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const cols = [];

  // Unassigned column
  cols.push({ key: "none", label: "Unassigned", tasks: tasks.filter(t => !t.dateKey) });

  // Next 7 days
  for (let i = 0; i < 7; i++) {
    const key = offsetKey(i);
    const d = new Date(); d.setDate(d.getDate() + i);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : DAY_NAMES[d.getDay()];
    cols.push({ key, label, tasks: tasks.filter(t => t.dateKey === key) });
  }

  return (
    <div style={{ overflowX: "auto", paddingBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, minWidth: "max-content" }}>
        {cols.map(col => (
          <div key={col.key} style={{ width: 220, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: col.key === todayKey() ? "#1a1814" : "#a09880", textTransform: "uppercase", letterSpacing: "0.07em" }}>{col.label}</span>
              <span style={{ fontSize: 11, background: "#f4f0e8", color: "#a09880", borderRadius: 10, padding: "1px 7px", fontWeight: 600 }}>{col.tasks.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 80, background: "#f8f6f2", borderRadius: 10, padding: 8 }}>
              {col.tasks.length === 0 && (
                <div style={{ textAlign: "center", color: "#ccc", fontSize: 12, padding: "16px 0" }}>Empty</div>
              )}
              {col.tasks.map(task => {
                const t = timers[task.id];
                return (
                  <TaskCard key={task.id} task={task}
                    timerState={t?.state || null} elapsed={t?.elapsed || 0}
                    onStartTimer={onStartTimer} onPauseTimer={onPauseTimer}
                    onResumeTimer={onResumeTimer} onEndTimer={onEndTimer}
                    onComplete={onComplete} onDelete={onDelete} onEdit={onEdit} compact
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LIST VIEW (original task + completed view)
// ─────────────────────────────────────────────

function ListView({ tasks, timers, visibleCompleted, totalEstimated, onStartTimer, onPauseTimer, onResumeTimer, onEndTimer, onComplete, onDelete, onEdit, onDeleteCompleted, onEditCompleted }) {
  return (
    <>
      {tasks.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #ede9e1" }}>
          <span style={{ fontSize: 12, color: "#a09880", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>To Do ({tasks.length})</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: totalEstimated > 480 ? "#dc2626" : "#555" }}>
            {formatMin(totalEstimated)} queued{totalEstimated > 480 && " ⚠️"}
          </span>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {tasks.length === 0 && visibleCompleted.length === 0 && (
          <div style={{ textAlign: "center", color: "#c9c3b5", padding: "40px 0", fontSize: 14 }}>Add a task above to get started</div>
        )}
        {tasks.map(task => {
          const t = timers[task.id];
          return (
            <TaskCard key={task.id} task={task}
              timerState={t?.state || null} elapsed={t?.elapsed || 0}
              onStartTimer={onStartTimer} onPauseTimer={onPauseTimer}
              onResumeTimer={onResumeTimer} onEndTimer={onEndTimer}
              onComplete={onComplete} onDelete={onDelete} onEdit={onEdit}
            />
          );
        })}
      </div>
      {visibleCompleted.length > 0 && (
        <>
          <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #ede9e1" }}>
            <span style={{ fontSize: 12, color: "#a09880", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>Completed ({visibleCompleted.length})</span>
          </div>
          <ScoreSummary completed={visibleCompleted} />
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {visibleCompleted.map(task => <CompletedRow key={task.id} task={task} onDelete={onDeleteCompleted} onEdit={onEditCompleted} />)}
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────

let _idCounter = lsGet(LS_KEYS.idCounter, 20);

export default function App() {
  const [tab, setTab] = useState("list");

  const [tasks, setTasks] = useState(() => lsGet(LS_KEYS.tasks, SEED_TASKS));
  const [allCompleted,     setAllCompleted]     = useState(() => lsGet(LS_KEYS.allCompleted,     [...SEED_VISIBLE, ...SEED_HISTORY]));
  const [visibleCompleted, setVisibleCompleted] = useState(() => lsGet(LS_KEYS.visibleCompleted, SEED_VISIBLE));
  const [dayHistory,       setDayHistory]       = useState(() => lsGet(LS_KEYS.dayHistory,       buildSeedDayHistory()));

  const [timers,        setTimers]        = useState({});
  const [confirmSwitch, setConfirmSwitch] = useState(null);

  // Persist on change
  useEffect(() => { lsSet(LS_KEYS.tasks,            tasks);            }, [tasks]);
  useEffect(() => { lsSet(LS_KEYS.allCompleted,     allCompleted);     }, [allCompleted]);
  useEffect(() => { lsSet(LS_KEYS.visibleCompleted, visibleCompleted); }, [visibleCompleted]);
  useEffect(() => { lsSet(LS_KEYS.dayHistory,       dayHistory);       }, [dayHistory]);

  // Timer tick
  useEffect(() => {
    const tick = setInterval(() => {
      setTimers(prev => {
        let changed = false;
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          if (next[id].state === "running") {
            const now = Date.now();
            next[id] = { ...next[id], elapsed: next[id].elapsed + Math.round((now - next[id].startedAt) / 1000), startedAt: now };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const suggestionIndex = buildSuggestions(allCompleted);
  const totalEstimated  = tasks.reduce((s, t) => s + t.estimated, 0);

  // Streak calculation
  const streak = (() => {
    let s = 0;
    let d = new Date();
    // If today has no data, start checking from yesterday
    const todHistEntry = dayHistory[toDateKey(d)];
    const todayHasData = todHistEntry && todHistEntry.count > 0;
    if (!todayHasData) d.setDate(d.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      const key = toDateKey(d);
      const h = dayHistory[key];
      if (!h || h.count === 0) { d.setDate(d.getDate() - 1); continue; } // skip no-task days
      const eff = (h.totalEst - h.totalAct) / h.totalEst;
      if (eff >= 0) { s++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return s;
  })();

  // Timer helpers
  const runningEntry = Object.entries(timers).find(([, v]) => v.state === "running");
  const runningId    = runningEntry ? Number(runningEntry[0]) : null;
  const runningTask  = runningId ? tasks.find(t => t.id === runningId) : null;

  function startTimer(task) {
    if (runningId && runningId !== task.id) { setConfirmSwitch({ fromId: runningId, fromName: runningTask?.name || "", toTask: task }); return; }
    setTimers(prev => ({ ...prev, [task.id]: { state: "running", elapsed: prev[task.id]?.elapsed || 0, startedAt: Date.now() } }));
  }
  function pauseTimer(taskId) {
    setTimers(prev => {
      if (!prev[taskId]) return prev;
      const elapsed = prev[taskId].elapsed + Math.round((Date.now() - prev[taskId].startedAt) / 1000);
      return { ...prev, [taskId]: { state: "paused", elapsed, startedAt: null } };
    });
  }
  function resumeTimer(task) {
    if (runningId && runningId !== task.id) { setConfirmSwitch({ fromId: runningId, fromName: runningTask?.name || "", toTask: task }); return; }
    setTimers(prev => ({ ...prev, [task.id]: { ...prev[task.id], state: "running", startedAt: Date.now() } }));
  }
  function endTimer(taskId) {
    const t = timers[taskId];
    if (!t) return;
    let elapsed = t.elapsed;
    if (t.state === "running") elapsed += Math.round((Date.now() - t.startedAt) / 1000);
    const mins = Math.max(1, Math.round(elapsed / 60));
    completeTask(taskId, mins);
    setTimers(prev => { const n = { ...prev }; delete n[taskId]; return n; });
  }
  function handleConfirmSwitch() {
    const { fromId, toTask } = confirmSwitch;
    pauseTimer(fromId);
    setConfirmSwitch(null);
    setTimeout(() => setTimers(prev => ({ ...prev, [toTask.id]: { state: "running", elapsed: prev[toTask.id]?.elapsed || 0, startedAt: Date.now() } })), 50);
  }

  function addTask(name, estimated, dateKey) {
    const id = _idCounter++;
    lsSet(LS_KEYS.idCounter, _idCounter);
    setTasks(prev => [...prev, { id, name, estimated, dateKey }]);
  }
  function completeTask(id, actual) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const entry = { ...task, actual };
    setTasks(prev => prev.filter(t => t.id !== id));
    setAllCompleted(prev => [...prev, entry]);
    setVisibleCompleted(prev => [...prev, entry]);
    // Always credit efficiency to the day the task was actually completed
    const key = todayKey();
    setDayHistory(prev => {
      const existing = prev[key] || { totalEst: 0, totalAct: 0, count: 0 };
      return { ...prev, [key]: { totalEst: existing.totalEst + task.estimated, totalAct: existing.totalAct + actual, count: existing.count + 1 } };
    });
  }
  function editTask(id, name, estimated) { setTasks(prev => prev.map(t => t.id === id ? { ...t, name, estimated } : t)); }
  function deleteTask(id) { setTimers(prev => { const n = { ...prev }; delete n[id]; return n; }); setTasks(prev => prev.filter(t => t.id !== id)); }
  function deleteCompleted(id) { setVisibleCompleted(prev => prev.filter(t => t.id !== id)); }
  function editCompleted(id, name, estimated, actual) {
    setVisibleCompleted(prev => prev.map(t => t.id === id ? { ...t, name, estimated, actual } : t));
    setAllCompleted(prev => prev.map(t => t.id === id ? { ...t, name, estimated, actual } : t));
  }

  // Keep Tod block in sync whenever visibleCompleted changes
  useEffect(() => {
    const key = todayKey();
    const todayTasks = visibleCompleted.filter(t => (t.dateKey || key) === key || !t.dateKey);
    if (todayTasks.length === 0) return;
    const totalEst = todayTasks.reduce((s, t) => s + t.estimated, 0);
    const totalAct = todayTasks.reduce((s, t) => s + t.actual, 0);
    setDayHistory(prev => ({ ...prev, [key]: { totalEst, totalAct, count: todayTasks.length } }));
  }, [visibleCompleted]);

  // Active floating bar task
  const activeEntry = runningEntry || Object.entries(timers).find(([, v]) => v.state === "paused");
  const activeTask  = activeEntry ? tasks.find(t => t.id === Number(activeEntry[0])) : null;
  const activeTimer = activeEntry ? activeEntry[1] : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f7f5f1", fontFamily: "'DM Sans', 'Helvetica Neue', Helvetica, sans-serif", paddingBottom: 100 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');
        * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        input:focus { border-color: #b35c00 !important; box-shadow: 0 0 0 3px rgba(179,92,0,0.08) !important; outline: none !important; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>

      {/* Header */}
      <div style={{ background: "#1a1814", color: "#fff", padding: "0 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 20, paddingBottom: 12, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "Georgia, serif", letterSpacing: "-0.3px" }}>TimeTasker</h1>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b6b6b" }}>Estimate. Track. Improve.</p>
            </div>
            <WeekBar dayHistory={dayHistory} streak={streak} />
          </div>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #2e2a26" }}>
            {[["list", "Tasks"], ["board", "Week"]].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                color: tab === key ? "#fff" : "#6b6b6b", fontWeight: tab === key ? 700 : 500,
                fontSize: 14, padding: "10px 20px",
                borderBottom: tab === key ? "2px solid #f59e0b" : "2px solid transparent",
                transition: "color 0.15s",
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 24px 0" }}>
        <AddTaskForm onAdd={addTask} suggestions={suggestionIndex} />

        {tab === "list" && (
          <ListView
            tasks={tasks} timers={timers} visibleCompleted={visibleCompleted} totalEstimated={totalEstimated}
            onStartTimer={startTimer} onPauseTimer={pauseTimer} onResumeTimer={resumeTimer} onEndTimer={endTimer}
            onComplete={completeTask} onDelete={deleteTask} onEdit={editTask} onDeleteCompleted={deleteCompleted} onEditCompleted={editCompleted}
          />
        )}
        {tab === "board" && (
          <BoardView
            tasks={tasks} timers={timers}
            onStartTimer={startTimer} onPauseTimer={pauseTimer} onResumeTimer={resumeTimer} onEndTimer={endTimer}
            onComplete={completeTask} onDelete={deleteTask} onEdit={editTask}
          />
        )}
      </div>

      {/* Floating bar */}
      {activeTask && activeTimer && (
        <FloatingBar task={activeTask} elapsed={activeTimer.elapsed} isRunning={activeTimer.state === "running"}
          onPause={() => pauseTimer(activeTask.id)} onResume={() => resumeTimer(activeTask)} onEnd={() => endTimer(activeTask.id)}
        />
      )}

      {/* Confirm switch */}
      {confirmSwitch && (
        <ConfirmDialog runningTaskName={confirmSwitch.fromName} newTaskName={confirmSwitch.toTask.name}
          onPause={handleConfirmSwitch} onCancel={() => setConfirmSwitch(null)} />
      )}
    </div>
  );
}
