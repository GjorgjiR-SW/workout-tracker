import React, { useEffect, useMemo, useRef, useState } from "react";
import Dexie, { Table } from "dexie";
import { v4 as uuidv4 } from "uuid";
import {
  Dumbbell,
  Plus,
  Trash2,
  Save,
  Copy,
  Download,
  CheckCircle2,
  BarChart2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

// -----------------------------
// Types
// -----------------------------
type Unit = "kg" | "lb" | "bodyweight";

type Exercise = {
  id: string;
  name: string;
  category: string; // e.g., Squat, Press, Pull, Hinge, Accessory
  muscles: string[];
  unit: Unit; // default logging unit
  createdAt: number;
};

type Workout = {
  id: string;
  date: string; // ISO date
  name: string;
  notes?: string;
  createdAt: number;
};

type SetRow = {
  id: string;
  workoutId: string;
  exerciseId: string;
  order: number; // display order within workout
  // Plan (targets)
  type: "warmup" | "work";
  targetReps?: number | null;
  targetWeight?: number | null; // in kg unless unit=lb
  targetRPE?: number | null;
  tempo?: string | null; // e.g., 3-0-1-0
  restSec?: number | null;
  // Actuals
  actualReps?: number | null;
  actualWeight?: number | null;
  actualRPE?: number | null;
  notes?: string | null;
  createdAt: number;
};

// -----------------------------
// Dexie DB
// -----------------------------
class WorkoutDB extends Dexie {
  exercises!: Table<Exercise, string>;
  workouts!: Table<Workout, string>;
  sets!: Table<SetRow, string>;
  constructor() {
    super("workout-tracker-mvp");
    this.version(1).stores({
      exercises: "id, name, category, unit, createdAt",
      workouts: "id, date, createdAt",
      sets: "id, workoutId, exerciseId, order, createdAt",
    });
  }
}

const db = new WorkoutDB();

// Seed default exercises on first run
async function seedExercisesIfEmpty() {
  const count = await db.exercises.count();
  if (count > 0) return;
  const now = Date.now();
  const defaults: Exercise[] = [
    { id: uuidv4(), name: "Back Squat", category: "Squat", muscles: ["Quads", "Glutes", "Core"], unit: "kg", createdAt: now },
    { id: uuidv4(), name: "Bench Press", category: "Press", muscles: ["Chest", "Triceps", "Front Delts"], unit: "kg", createdAt: now },
    { id: uuidv4(), name: "Deadlift", category: "Hinge", muscles: ["Posterior Chain"], unit: "kg", createdAt: now },
    { id: uuidv4(), name: "Overhead Press", category: "Press", muscles: ["Delts", "Triceps", "Core"], unit: "kg", createdAt: now },
    { id: uuidv4(), name: "Barbell Row", category: "Pull", muscles: ["Lats", "Upper Back"], unit: "kg", createdAt: now },
    { id: uuidv4(), name: "Pull-up", category: "Pull", muscles: ["Lats", "Biceps"], unit: "bodyweight", createdAt: now },
    { id: uuidv4(), name: "Romanian Deadlift", category: "Hinge", muscles: ["Hamstrings", "Glutes"], unit: "kg", createdAt: now },
    { id: uuidv4(), name: "Bulgarian Split Squat", category: "Squat", muscles: ["Quads", "Glutes"], unit: "kg", createdAt: now },
  ];
  await db.exercises.bulkAdd(defaults);
}

// -----------------------------
// Utilities — Exercise Science
// -----------------------------
// Epley: 1RM = w * (1 + reps/30)
function epley1RM(weight: number, reps: number) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}
// Brzycki: 1RM = w * 36 / (37 - reps)
function brzycki1RM(weight: number, reps: number) {
  if (!weight || !reps || reps >= 37) return 0;
  return (weight * 36) / (37 - reps);
}

// Return best estimated 1RM for a collection of performed sets of the same exercise
function bestEst1RMForSets(sets: SetRow[]): number {
  let best = 0;
  for (const s of sets) {
    if (s.actualWeight && s.actualReps) {
      const e = epley1RM(s.actualWeight, s.actualReps);
      const b = brzycki1RM(s.actualWeight, s.actualReps);
      const mean = (e + b) / 2;
      if (mean > best) best = mean;
    }
  }
  return Number(best.toFixed(2));
}

function totalVolume(sets: SetRow[]): number {
  return sets.reduce((acc, s) => acc + (s.actualWeight || 0) * (s.actualReps || 0), 0);
}

// -----------------------------
// Small UI helpers
// -----------------------------
const TabButton: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}> = ({ label, active, onClick, icon }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-2xl border text-sm flex items-center gap-2 transition-all ${
      active
        ? "bg-black text-white border-black shadow"
        : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
    }`}
  >
    {icon}
    <span className="font-medium">{label}</span>
  </button>
);

function formatDateInput(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoFromDateInput(value: string) {
  // treat as local date at 12:00 to avoid TZ off-by-one
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  return date.toISOString();
}

function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function groupBy<T, K extends string | number>(arr: T[], getKey: (x: T) => K): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const k = getKey(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}

// -----------------------------
// Main App
// -----------------------------
export default function App() {
  const [tab, setTab] = useState<"Plan" | "Log" | "History" | "Progress" | "Export">(
    "Plan"
  );
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [unit, setUnit] = useState<Unit>(() => (localStorage.getItem("unit") as Unit) || "kg");

  useEffect(() => {
    (async () => {
      await seedExercisesIfEmpty();
      const [exs, wos, sts] = await Promise.all([
        db.exercises.orderBy("createdAt").toArray(),
        db.workouts.orderBy("date").reverse().toArray(),
        db.sets.orderBy("createdAt").toArray(),
      ]);
      setExercises(exs);
      setWorkouts(wos);
      setSets(sts);
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem("unit", unit);
  }, [unit]);

  // ------- Derived lookups
  const setsByWorkout = useMemo(() => groupBy(sets, (s) => s.workoutId), [sets]);
  const byIdExercise = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);

  // ------- CRUD helpers
  async function refreshAll() {
    const [exs, wos, sts] = await Promise.all([
      db.exercises.orderBy("createdAt").toArray(),
      db.workouts.orderBy("date").reverse().toArray(),
      db.sets.orderBy("createdAt").toArray(),
    ]);
    setExercises(exs);
    setWorkouts(wos);
    setSets(sts);
  }

  async function addWorkout(name: string, date: string) {
    const w: Workout = {
      id: uuidv4(),
      name,
      date: isoFromDateInput(date),
      createdAt: Date.now(),
    };
    await db.workouts.add(w);
    await refreshAll();
  }

  async function deleteWorkout(workoutId: string) {
    await db.transaction("rw", db.workouts, db.sets, async () => {
      await db.sets.where("workoutId").equals(workoutId).delete();
      await db.workouts.delete(workoutId);
    });
    await refreshAll();
  }

  async function duplicateWorkout(workoutId: string) {
    const w = await db.workouts.get(workoutId);
    if (!w) return;
    const newId = uuidv4();
    const copy: Workout = {
      ...w,
      id: newId,
      name: `${w.name} (copy)` ,
      date: new Date().toISOString(),
      createdAt: Date.now(),
    };
    const setRows = await db.sets.where("workoutId").equals(workoutId).toArray();
    const copiedSets: SetRow[] = setRows.map((s) => ({
      ...s,
      id: uuidv4(),
      workoutId: newId,
      // clear actuals for new session
      actualReps: null,
      actualWeight: null,
      actualRPE: null,
      notes: null,
      createdAt: Date.now(),
    }));
    await db.transaction("rw", db.workouts, db.sets, async () => {
      await db.workouts.add(copy);
      await db.sets.bulkAdd(copiedSets);
    });
    await refreshAll();
  }

  async function addExerciseToWorkout(workoutId: string, exerciseId: string, count: number, reps: number, weight?: number, rpe?: number, type: "warmup" | "work" = "work") {
    const existing = await db.sets.where({ workoutId }).toArray();
    const baseOrder = existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 1;
    const now = Date.now();
    const rows: SetRow[] = Array.from({ length: count }).map((_, i) => ({
      id: uuidv4(),
      workoutId,
      exerciseId,
      order: baseOrder + i,
      type,
      targetReps: reps,
      targetWeight: weight ?? null,
      targetRPE: rpe ?? null,
      tempo: null,
      restSec: 90,
      actualReps: null,
      actualWeight: null,
      actualRPE: null,
      notes: null,
      createdAt: now + i,
    }));
    await db.sets.bulkAdd(rows);
    await refreshAll();
  }

  async function deleteSetRow(setId: string) {
    await db.sets.delete(setId);
    await refreshAll();
  }

  async function saveSetActuals(setId: string, patch: Partial<SetRow>) {
    await db.sets.update(setId, patch);
    await refreshAll();
  }

  // ------- CSV export
  function exportCSV() {
    const header = [
      "workout_id","workout_name","workout_date","exercise","set_order","type","target_reps","target_weight","target_rpe","actual_reps","actual_weight","actual_rpe","tempo","rest_sec","notes"
    ];
    const rows: string[][] = [];
    for (const s of sets) {
      const w = workouts.find((w) => w.id === s.workoutId);
      const ex = byIdExercise[s.exerciseId];
      rows.push([
        s.workoutId,
        w?.name || "",
        w ? shortDate(w.date) : "",
        ex?.name || "",
        String(s.order),
        s.type,
        s.targetReps?.toString() ?? "",
        s.targetWeight?.toString() ?? "",
        s.targetRPE?.toString() ?? "",
        s.actualReps?.toString() ?? "",
        s.actualWeight?.toString() ?? "",
        s.actualRPE?.toString() ?? "",
        s.tempo || "",
        s.restSec?.toString() || "",
        s.notes || "",
      ]);
    }
    const csv = [header, ...rows]
      .map((r) => r.map((c) => (c.includes(",") || c.includes("\n") ? `"${c.replaceAll('"', '""')}"` : c)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ------- Progress data
  const [progressExerciseId, setProgressExerciseId] = useState<string>("");
  const progressData = useMemo(() => {
    if (!progressExerciseId) return [] as { date: string; est1RM: number; volume: number }[];
    const data: { date: string; est1RM: number; volume: number }[] = [];
    for (const w of [...workouts].sort((a, b) => a.date.localeCompare(b.date))) {
      const s = (setsByWorkout[w.id] || []).filter((x) => x.exerciseId === progressExerciseId);
      if (s.length) {
        data.push({
          date: shortDate(w.date),
          est1RM: bestEst1RMForSets(s),
          volume: Number(totalVolume(s).toFixed(1)),
        });
      }
    }
    return data;
  }, [progressExerciseId, workouts, setsByWorkout]);

  // ------- Render
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-black text-white"><Dumbbell size={20} /></div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Workout Tracker — MVP</h1>
              <p className="text-xs text-neutral-500">Offline-first • Local-only • CSV export</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium">Units</label>
            <select
              className="border rounded-xl px-3 py-1 text-sm"
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              aria-label="Select units"
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
              <option value="bodyweight">bodyweight</option>
            </select>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-3 flex gap-2 flex-wrap">
          {(["Plan", "Log", "History", "Progress", "Export"] as const).map((t) => (
            <TabButton key={t} label={t} active={tab === t} onClick={() => setTab(t)} icon={t === "Progress" ? <BarChart2 size={16}/> : undefined} />
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "Plan" && (
          <PlanView
            exercises={exercises}
            workouts={workouts}
            setsByWorkout={setsByWorkout}
            onAddWorkout={addWorkout}
            onAddExerciseToWorkout={addExerciseToWorkout}
            onDeleteSet={deleteSetRow}
            byIdExercise={byIdExercise}
          />
        )}
        {tab === "Log" && (
          <LogView
            workouts={workouts}
            setsByWorkout={setsByWorkout}
            byIdExercise={byIdExercise}
            onSaveSet={saveSetActuals}
          />
        )}
        {tab === "History" && (
          <HistoryView
            workouts={workouts}
            setsByWorkout={setsByWorkout}
            byIdExercise={byIdExercise}
            onDeleteWorkout={deleteWorkout}
            onDuplicateWorkout={duplicateWorkout}
          />
        )}
        {tab === "Progress" && (
          <ProgressView
            exercises={exercises}
            progressExerciseId={progressExerciseId}
            setProgressExerciseId={setProgressExerciseId}
            progressData={progressData}
          />
        )}
        {tab === "Export" && (
          <ExportView onExport={exportCSV} />
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-12 text-xs text-neutral-500">
        <p>
          Training tips are informational only and not medical advice. Progress charts show estimated 1RM (Epley & Brzycki mean) and total volume per session.
        </p>
      </footer>
    </div>
  );
}

// -----------------------------
// Plan View
// -----------------------------
function PlanView({
  exercises,
  workouts,
  setsByWorkout,
  onAddWorkout,
  onAddExerciseToWorkout,
  onDeleteSet,
  byIdExercise,
}: {
  exercises: Exercise[];
  workouts: Workout[];
  setsByWorkout: Record<string, SetRow[]>;
  onAddWorkout: (name: string, date: string) => Promise<void>;
  onAddExerciseToWorkout: (
    workoutId: string,
    exerciseId: string,
    count: number,
    reps: number,
    weight?: number,
    rpe?: number,
    type?: "warmup" | "work"
  ) => Promise<void>;
  onDeleteSet: (setId: string) => Promise<void>;
  byIdExercise: Record<string, Exercise>;
}) {
  const [name, setName] = useState("Full Body");
  const [date, setDate] = useState(formatDateInput());
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string>(workouts[0]?.id || "");
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>("");
  const [count, setCount] = useState(3);
  const [reps, setReps] = useState(5);
  const [weight, setWeight] = useState<number | "">("");
  const [rpe, setRpe] = useState<number | "">("");
  const [type, setType] = useState<"warmup" | "work">("work");

  useEffect(() => {
    setSelectedWorkoutId(workouts[0]?.id || "");
  }, [workouts.length]);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Create workout */}
      <div className="bg-white rounded-2xl p-4 border">
        <h2 className="text-base font-semibold mb-3">Create a workout</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Name</label>
            <input className="border rounded-xl px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Date</label>
            <input type="date" className="border rounded-xl px-3 py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 bg-black text-white rounded-xl px-4 py-2 h-10"
            onClick={() => onAddWorkout(name.trim() || "Workout", date)}
          >
            <Plus size={16}/> Create
          </button>
        </div>
      </div>

      {/* Add exercises */}
      <div className="bg-white rounded-2xl p-4 border">
        <h2 className="text-base font-semibold mb-3">Add exercises to a workout</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Workout</label>
            <select className="border rounded-xl px-3 py-2" value={selectedWorkoutId} onChange={(e) => setSelectedWorkoutId(e.target.value)}>
              {workouts.map((w) => (
                <option key={w.id} value={w.id}>
                  {shortDate(w.date)} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Exercise</label>
            <select className="border rounded-xl px-3 py-2" value={selectedExerciseId} onChange={(e) => setSelectedExerciseId(e.target.value)}>
              <option value="">Select...</option>
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.category})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Sets</label>
            <input type="number" min={1} className="border rounded-xl px-3 py-2" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Target reps</label>
            <input type="number" min={1} className="border rounded-xl px-3 py-2" value={reps} onChange={(e) => setReps(Number(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Target weight</label>
            <input
              type="number"
              step="0.5"
              className="border rounded-xl px-3 py-2"
              value={weight as any}
              onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="optional"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Target RPE</label>
            <input
              type="number"
              step="0.5"
              className="border rounded-xl px-3 py-2"
              value={rpe as any}
              onChange={(e) => setRpe(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="optional"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-neutral-500">Type</label>
            <select className="border rounded-xl px-3 py-2" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="work">Work</option>
              <option value="warmup">Warm-up</option>
            </select>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 bg-black text-white rounded-xl px-4 py-2 h-10 disabled:opacity-50"
            disabled={!selectedWorkoutId || !selectedExerciseId}
            onClick={() => onAddExerciseToWorkout(selectedWorkoutId, selectedExerciseId, count, reps, weight === "" ? undefined : Number(weight), rpe === "" ? undefined : Number(rpe), type)}
          >
            <Plus size={16}/> Add to workout
          </button>
        </div>
      </div>

      {/* Current workout details */}
      <div className="md:col-span-2 bg-white rounded-2xl p-4 border">
        <h2 className="text-base font-semibold mb-3">Planned sets</h2>
        {!selectedWorkoutId ? (
          <p className="text-sm text-neutral-500">Create and select a workout to view its sets.</p>
        ) : (
          <WorkoutTable
            sets={(setsByWorkout[selectedWorkoutId] || []).sort((a, b) => a.order - b.order)}
            byIdExercise={byIdExercise}
            onDeleteSet={onDeleteSet}
            editableTargets
          />
        )}
      </div>
    </div>
  );
}

function WorkoutTable({
  sets,
  byIdExercise,
  onDeleteSet,
  onSaveSet,
  editableTargets,
}: {
  sets: SetRow[];
  byIdExercise: Record<string, Exercise>;
  onDeleteSet?: (setId: string) => Promise<void>;
  onSaveSet?: (setId: string, patch: Partial<SetRow>) => Promise<void>;
  editableTargets?: boolean;
}) {
  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="py-2 pr-4">#</th>
            <th className="py-2 pr-4">Exercise</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2 pr-4">Target</th>
            <th className="py-2 pr-4">Actual</th>
            <th className="py-2 pr-4">RPE</th>
            <th className="py-2 pr-4">Rest</th>
            <th className="py-2 pr-4">Notes</th>
            {onDeleteSet ? <th className="py-2 pr-4">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {sets.map((s, idx) => (
            <tr key={s.id} className="border-t">
              <td className="py-2 pr-4 align-top">{idx + 1}</td>
              <td className="py-2 pr-4 align-top">
                <div className="font-medium">{byIdExercise[s.exerciseId]?.name || "?"}</div>
                <div className="text-xs text-neutral-500">{byIdExercise[s.exerciseId]?.category}</div>
              </td>
              <td className="py-2 pr-4 align-top">
                <span className="px-2 py-1 rounded-full border text-xs">{s.type}</span>
              </td>
              <td className="py-2 pr-4 align-top">
                <div className="flex items-center gap-2 flex-wrap">
                  {editableTargets ? (
                    <>
                      <input
                        type="number"
                        className="border rounded-lg px-2 py-1 w-16"
                        value={s.targetReps ?? 0}
                        onChange={(e) => onSaveSet && onSaveSet(s.id, { targetReps: Number(e.target.value) })}
                      />
                      <span>reps @</span>
                      <input
                        type="number"
                        step="0.5"
                        className="border rounded-lg px-2 py-1 w-20"
                        value={s.targetWeight ?? 0}
                        onChange={(e) => onSaveSet && onSaveSet(s.id, { targetWeight: Number(e.target.value) })}
                      />
                      <span>kg</span>
                      <span className="text-neutral-400">/</span>
                      <input
                        type="number"
                        step="0.5"
                        className="border rounded-lg px-2 py-1 w-16"
                        value={s.targetRPE ?? 0}
                        onChange={(e) => onSaveSet && onSaveSet(s.id, { targetRPE: Number(e.target.value) })}
                      />
                      <span>RPE</span>
                    </>
                  ) : (
                    <>
                      <span className="px-2 py-1 rounded-lg bg-neutral-100">{s.targetReps ?? "-"} reps</span>
                      <span className="px-2 py-1 rounded-lg bg-neutral-100">{s.targetWeight ?? "-"} kg</span>
                      <span className="px-2 py-1 rounded-lg bg-neutral-100">RPE {s.targetRPE ?? "-"}</span>
                    </>
                  )}
                </div>
              </td>
              <td className="py-2 pr-4 align-top">
                {onSaveSet ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="number"
                      className="border rounded-lg px-2 py-1 w-16"
                      value={s.actualReps ?? 0}
                      onChange={(e) => onSaveSet(s.id, { actualReps: Number(e.target.value) })}
                    />
                    <span>reps @</span>
                    <input
                      type="number"
                      step="0.5"
                      className="border rounded-lg px-2 py-1 w-20"
                      value={s.actualWeight ?? 0}
                      onChange={(e) => onSaveSet(s.id, { actualWeight: Number(e.target.value) })}
                    />
                    <span>kg</span>
                  </div>
                ) : (
                  <>
                    <span className="px-2 py-1 rounded-lg bg-neutral-100">{s.actualReps ?? "-"} reps</span>
                    <span className="px-2 py-1 rounded-lg bg-neutral-100">{s.actualWeight ?? "-"} kg</span>
                  </>
                )}
              </td>
              <td className="py-2 pr-4 align-top">
                {onSaveSet ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      className="border rounded-lg px-2 py-1 w-16"
                      value={s.actualRPE ?? 0}
                      onChange={(e) => onSaveSet(s.id, { actualRPE: Number(e.target.value) })}
                    />
                    <span>RPE</span>
                  </div>
                ) : (
                  <span className="px-2 py-1 rounded-lg bg-neutral-100">{s.actualRPE ?? "-"}</span>
                )}
              </td>
              <td className="py-2 pr-4 align-top">
                {onSaveSet ? (
                  <input
                    type="number"
                    className="border rounded-lg px-2 py-1 w-20"
                    value={s.restSec ?? 90}
                    onChange={(e) => onSaveSet(s.id, { restSec: Number(e.target.value) })}
                  />
                ) : (
                  <span className="px-2 py-1 rounded-lg bg-neutral-100">{s.restSec ?? 90}s</span>
                )}
              </td>
              <td className="py-2 pr-4 align-top">
                {onSaveSet ? (
                  <input
                    className="border rounded-lg px-2 py-1 w-48"
                    value={s.notes ?? ""}
                    onChange={(e) => onSaveSet(s.id, { notes: e.target.value })}
                  />
                ) : (
                  <span className="text-neutral-600">{s.notes || ""}</span>
                )}
              </td>
              {onDeleteSet ? (
                <td className="py-2 pr-4 align-top">
                  <button className="p-2 rounded-lg border hover:bg-neutral-50" onClick={() => onDeleteSet(s.id)} aria-label="Delete set">
                    <Trash2 size={16} />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {sets.length === 0 && (
        <p className="text-sm text-neutral-500 py-6">No sets yet. Add some above.</p>
      )}
    </div>
  );
}

// -----------------------------
// Log View
// -----------------------------
function LogView({
  workouts,
  setsByWorkout,
  byIdExercise,
  onSaveSet,
}: {
  workouts: Workout[];
  setsByWorkout: Record<string, SetRow[]>;
  byIdExercise: Record<string, Exercise>;
  onSaveSet: (setId: string, patch: Partial<SetRow>) => Promise<void>;
}) {
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string>(
    workouts.find((w) => new Date(w.date).toDateString() === new Date().toDateString())?.id || workouts[0]?.id || ""
  );

  useEffect(() => {
    if (!selectedWorkoutId && workouts[0]) setSelectedWorkoutId(workouts[0].id);
  }, [workouts.length]);

  const grouped = useMemo(() => groupBy((setsByWorkout[selectedWorkoutId] || []).sort((a,b)=>a.order-b.order), (s) => s.exerciseId), [selectedWorkoutId, setsByWorkout]);

  return (
    <div className="bg-white rounded-2xl p-4 border">
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">Workout</label>
          <select className="border rounded-xl px-3 py-2" value={selectedWorkoutId} onChange={(e) => setSelectedWorkoutId(e.target.value)}>
            {workouts.map((w) => (
              <option key={w.id} value={w.id}>
                {shortDate(w.date)} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs text-neutral-500">Fast logging: type numbers and hit Tab ↹</div>
      </div>

      {Object.entries(grouped).length === 0 && (
        <p className="text-sm text-neutral-500">No planned sets for this workout. Add them in the Plan tab.</p>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([exerciseId, setRows]) => (
          <div key={exerciseId} className="border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-semibold">{byIdExercise[exerciseId]?.name}</div>
                <div className="text-xs text-neutral-500">{byIdExercise[exerciseId]?.category} • {byIdExercise[exerciseId]?.muscles.join(", ")}</div>
              </div>
            </div>
            <WorkoutTable
              sets={setRows}
              byIdExercise={byIdExercise}
              onSaveSet={onSaveSet}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------
// History View
// -----------------------------
function HistoryView({
  workouts,
  setsByWorkout,
  byIdExercise,
  onDeleteWorkout,
  onDuplicateWorkout,
}: {
  workouts: Workout[];
  setsByWorkout: Record<string, SetRow[]>;
  byIdExercise: Record<string, Exercise>;
  onDeleteWorkout: (workoutId: string) => Promise<void>;
  onDuplicateWorkout: (workoutId: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      {workouts.length === 0 && (
        <p className="text-sm text-neutral-500">No workouts yet. Create one in the Plan tab.</p>
      )}
      {workouts.map((w) => {
        const rows = (setsByWorkout[w.id] || []).sort((a,b)=>a.order-b.order);
        const groups = groupBy(rows, (s) => s.exerciseId);
        const volume = totalVolume(rows);
        const est1RMByExercise = Object.entries(groups).map(([exId, s]) => ({
          name: byIdExercise[exId]?.name || "?",
          est: bestEst1RMForSets(s),
        }));
        return (
          <div key={w.id} className="bg-white border rounded-2xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-neutral-500">{shortDate(w.date)}</div>
                <h3 className="text-base font-semibold">{w.name}</h3>
                {w.notes && <p className="text-sm text-neutral-700 mt-1">{w.notes}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-xl border hover:bg-neutral-50" onClick={() => onDuplicateWorkout(w.id)} aria-label="Duplicate workout">
                  <Copy size={16} />
                </button>
                <button className="p-2 rounded-xl border hover:bg-red-50" onClick={() => onDeleteWorkout(w.id)} aria-label="Delete workout">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="mt-3 text-sm text-neutral-600">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="px-2 py-1 rounded-full bg-neutral-100">Total volume: <b>{volume.toFixed(1)} kg·reps</b></span>
                {est1RMByExercise.map((x) => (
                  <span key={x.name} className="px-2 py-1 rounded-full bg-neutral-100">{x.name}: est 1RM <b>{x.est || "-"}</b> kg</span>
                ))}
              </div>
            </div>

            {/* Per-exercise tables */}
            <div className="mt-4 grid md:grid-cols-2 gap-4">
              {Object.entries(groups).map(([exId, s]) => (
                <div key={exId} className="border rounded-xl p-3">
                  <div className="font-medium mb-2">{byIdExercise[exId]?.name}</div>
                  <WorkoutTable sets={s} byIdExercise={byIdExercise} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------
// Progress View
// -----------------------------
function ProgressView({
  exercises,
  progressExerciseId,
  setProgressExerciseId,
  progressData,
}: {
  exercises: Exercise[];
  progressExerciseId: string;
  setProgressExerciseId: (id: string) => void;
  progressData: { date: string; est1RM: number; volume: number }[];
}) {
  const hasData = progressData.length > 0;
  return (
    <div className="bg-white rounded-2xl p-4 border">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end mb-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs text-neutral-500">Exercise</label>
          <select
            className="border rounded-xl px-3 py-2"
            value={progressExerciseId}
            onChange={(e) => setProgressExerciseId(e.target.value)}
          >
            <option value="">Select exercise…</option>
            {exercises.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.category})</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-neutral-500">
          Chart shows per-session estimated 1RM (Epley/Brzycki mean) and total volume.
        </div>
      </div>

      {!hasData ? (
        <p className="text-sm text-neutral-500">No data yet for this exercise.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={progressData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" angle={-20} textAnchor="end" height={50} />
                <YAxis yAxisId="left" />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="est1RM" name="Est 1RM (kg)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={progressData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" angle={-20} textAnchor="end" height={50} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="volume" name="Volume (kg·reps)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------
// Export View
// -----------------------------
function ExportView({ onExport }: { onExport: () => void }) {
  return (
    <div className="bg-white rounded-2xl p-6 border flex flex-col items-start gap-3">
      <h2 className="text-base font-semibold">Export your data</h2>
      <p className="text-sm text-neutral-600 max-w-prose">
        Download a CSV with all workouts and sets (targets and actuals). You can open it in Excel, Numbers, or import it elsewhere.
      </p>
      <button className="inline-flex items-center gap-2 bg-black text-white rounded-xl px-4 py-2" onClick={onExport}>
        <Download size={16} /> Download CSV
      </button>
    </div>
  );
}
