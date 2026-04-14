import { MongoClient, Collection } from "mongodb";
import { Player } from "../types/player";

export type MatchConfig = {
  day: string;
  hour: string;
  place: string;
};

type PlayerListDocument = {
  _id: string;
  players: Player[];
  matchConfig: MatchConfig;
  lastResetDate?: string;
  updatedAt: Date;
};

let players: Player[] = [];

const DEFAULT_MATCH_CONFIG: MatchConfig = {
  day: "Domingo",
  hour: "20",
  place: "Club Florida",
};

let matchConfig: MatchConfig = { ...DEFAULT_MATCH_CONFIG };
let lastResetDate: string | undefined;

let collection: Collection<PlayerListDocument> | null = null;

const STORAGE_KEY = "global";

const normalizeManualNameForMatch = (name: string) => name.trim().toLowerCase();

const persist = async () => {
  if (!collection) return;

  await collection.updateOne(
    { _id: STORAGE_KEY },
    {
      $set: {
        players,
        matchConfig,
        lastResetDate,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
};

export const initPlayerStore = async () => {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.warn("⚠️ MONGODB_URI no definido");
    return;
  }

  const dbName = process.env.MONGODB_DB_NAME || "voley-bot";
  const collName = process.env.MONGODB_COLLECTION || "players";

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db(dbName);
  collection = db.collection<PlayerListDocument>(collName);

  const doc = await collection.findOne({ _id: STORAGE_KEY });

  if (doc) {
    players = doc.players || [];
    matchConfig = doc.matchConfig || DEFAULT_MATCH_CONFIG;
    lastResetDate = doc.lastResetDate || undefined;
  }

  console.log(
    `📥 MongoDB conectado; lista cargada (${players.length} jugadores).`,
  );
};

// =========================
// 🔁 RESET AUTOMÁTICO
// =========================

const WEEK_DAYS = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const shouldReset = (): boolean => {
  if (!matchConfig.day) return false;

  const today = new Date();
  const todayIndex = today.getDay();

  const matchDayIndex = WEEK_DAYS.indexOf(matchConfig.day.toLowerCase());

  if (matchDayIndex === -1) return false;

  const todayStr = today.toISOString().split("T")[0];

  if (lastResetDate === todayStr) return false;

  return todayIndex === matchDayIndex;
};

export const maybeAutoReset = async () => {
  if (!shouldReset()) return;

  players = [];
  lastResetDate = new Date().toISOString().split("T")[0];

  await persist();

  console.log("🔁 Lista reiniciada automáticamente");
};

// =========================
// ➕ ADD PLAYER
// =========================

export const addPlayer = async (player: Player) => {
  const normalizedNewName = normalizeManualNameForMatch(player.name);

  const exists = players.some(
    (p) =>
      p.id === player.id ||
      normalizeManualNameForMatch(p.name) === normalizedNewName,
  );

  if (exists) {
    return { error: "Ese jugador ya está anotado" };
  }

  players.push({ ...player, source: "member" });
  await persist();

  return { players };
};

export const addManualPlayer = async (name: string) => {
  const normalizedNewName = normalizeManualNameForMatch(name);

  const exists = players.some(
    (p) => normalizeManualNameForMatch(p.name) === normalizedNewName,
  );

  if (exists) {
    return { error: "Ese jugador ya está anotado" };
  }

  players.push({
    name,
    source: "manual",
  });

  await persist();

  return { players };
};

// =========================
// ❌ REMOVE
// =========================

export const removePlayer = async (id: string) => {
  const index = players.findIndex((p) => p.id === id);

  if (index === -1) {
    return { error: "No estás en la lista" };
  }

  players.splice(index, 1);
  await persist();

  return { players };
};

export const removePlayerByName = async (name: string) => {
  const normalized = normalizeManualNameForMatch(name);

  const index = players.findIndex(
    (p) => normalizeManualNameForMatch(p.name) === normalized,
  );

  if (index === -1) {
    return { error: "No está en la lista" };
  }

  players.splice(index, 1);
  await persist();

  return { players };
};

// =========================
// 📋 GETTERS
// =========================

export const getPlayers = async () => players;

export const getMatchConfig = () => matchConfig;

// =========================
// ⚙️ CONFIG
// =========================

export const updateMatchConfigField = async (
  field: keyof MatchConfig,
  value: string,
) => {
  matchConfig[field] = value;
  await persist();
  return matchConfig;
};

export const resetMatchConfig = async () => {
  matchConfig = { ...DEFAULT_MATCH_CONFIG };
  await persist();
  return matchConfig;
};

// =========================
// 🧹 RESET LISTA
// =========================

export const resetPlayers = async () => {
  players = [];
  await persist();
};
