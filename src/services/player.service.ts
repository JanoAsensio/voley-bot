import { MongoClient, Collection } from "mongodb";
import { Player } from "../types/player";
import { isValidLength } from "../utils/buildMessage";

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

const getLocalDateKey = (date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

class PersistenceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    if (cause !== undefined) (this as any).cause = cause;
  }
}

const persist = async () => {
  if (!collection) return;

  try {
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
  } catch (err) {
    throw new PersistenceError(
      "No se pudo persistir el estado en MongoDB.",
      err,
    );
  }
};

export const initPlayerStore = async () => {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    const msg =
      "⚠️ MONGODB_URI no definido. El bot funcionará sin persistencia (memoria volátil).";
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `${msg} En producción se requiere persistencia; configura MONGODB_URI en Railway.`,
      );
    }
    console.warn(msg);
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
  const resetDayIndex = (matchDayIndex + 1) % 7;

  const todayStr = getLocalDateKey(today);

  if (lastResetDate === todayStr) return false;

  return todayIndex === resetDayIndex;
};

export const maybeAutoReset = async () => {
  if (!shouldReset()) return;

  const prevPlayers = players;
  const prevLastResetDate = lastResetDate;

  players = [];
  lastResetDate = getLocalDateKey();

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    lastResetDate = prevLastResetDate;
    throw err;
  }

  console.log("🔁 Lista reiniciada automáticamente");
};

export const addPlayer = async (player: Player) => {
  const normalizedNewName = normalizeManualNameForMatch(player.name);

  const exists = players.some(
    (p) =>
      p.id === player.id ||
      normalizeManualNameForMatch(p.name) === normalizedNewName,
  );

  if (exists) {
    return { error: "Ya estás anotado" };
  }

  const prevPlayers = players;
  players = [...players, { ...player, source: "member" }];

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    throw err;
  }

  return { players };
};

export const addManualPlayer = async (name: string) => {
  const clean = name.trim();
  if (clean.length < 0) {
    return { error: "El nombre debe tener al menos 1 caracter." };
  }
  if (!isValidLength(clean)) {
    return { error: "El nombre no puede superar los 20 caracteres." };
  }

  const normalizedNewName = normalizeManualNameForMatch(clean);

  const exists = players.some(
    (p) => normalizeManualNameForMatch(p.name) === normalizedNewName,
  );

  if (exists) {
    return { error: "Ese jugador ya está anotado" };
  }

  const prevPlayers = players;
  players = [
    ...players,
    {
      name: clean,
      source: "manual",
    },
  ];

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    throw err;
  }

  return { players };
};

export const removePlayer = async (id: string) => {
  const index = players.findIndex((p) => p.id === id);

  if (index === -1) {
    return { error: "No estás en la lista" };
  }

  const prevPlayers = players;
  players = players.filter((p) => p.id !== id);

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    throw err;
  }

  return { players };
};

export const removePlayerByIdOrName = async (
  id: string,
  fallbackName: string,
) => {
  // 1) Intentar por id (caso jugador agregado con `estoy`)
  const byIdIndex = players.findIndex((p) => p.id === id);

  if (byIdIndex !== -1) {
    const prevPlayers = players;
    players = players.filter((p) => p.id !== id);

    try {
      await persist();
    } catch (err) {
      players = prevPlayers;
      throw err;
    }

    return { players };
  }

  // 2) Si no existe por id, intentar por nombre normalizado (caso `estoy: nombre`)
  const clean = fallbackName.trim();
  if (clean.length < 0) {
    return { error: "Nombre inválido. Ej: `salgo: Juan`." };
  }

  const normalized = normalizeManualNameForMatch(clean);

  const hasByName = players.some(
    (p) => normalizeManualNameForMatch(p.name) === normalized,
  );

  if (!hasByName) {
    return { error: "No estás en la lista" };
  }

  const prevPlayers = players;
  players = players.filter(
    (p) => normalizeManualNameForMatch(p.name) !== normalized,
  );

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    throw err;
  }

  return { players };
};

export const removePlayerByName = async (name: string) => {
  const clean = name.trim();
  if (clean.length < 2) {
    return { error: "Nombre inválido. Ej: `salgo: Juan`." };
  }
  const normalized = normalizeManualNameForMatch(clean);

  const index = players.findIndex(
    (p) => normalizeManualNameForMatch(p.name) === normalized,
  );

  if (index === -1) {
    return { error: "Ese jugador no está en la lista" };
  }

  const prevPlayers = players;
  players = players.filter(
    (p) => normalizeManualNameForMatch(p.name) !== normalized,
  );

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    throw err;
  }

  return { players };
};

export const getPlayers = async () => players;

export const getMatchConfig = () => matchConfig;

export const updateMatchConfigField = async (
  field: keyof MatchConfig,
  value: string,
) => {
  const prevConfig = matchConfig;
  matchConfig = { ...matchConfig, [field]: value };

  try {
    await persist();
  } catch (err) {
    matchConfig = prevConfig;
    throw err;
  }
  return matchConfig;
};

export const resetMatchConfig = async () => {
  const prevConfig = matchConfig;
  matchConfig = { ...DEFAULT_MATCH_CONFIG };

  try {
    await persist();
  } catch (err) {
    matchConfig = prevConfig;
    throw err;
  }
  return matchConfig;
};

export const resetPlayers = async () => {
  const prevPlayers = players;
  players = [];

  try {
    await persist();
  } catch (err) {
    players = prevPlayers;
    throw err;
  }
};
