import {
  addPlayer,
  addManualPlayer,
  removePlayer,
  getPlayers,
  getMatchConfig,
  resetMatchConfig,
  updateMatchConfigField,
  resetPlayers,
  removePlayerByName,
  maybeAutoReset,
} from "../services/player.service";
import {
  buildMatchTitle,
  buildConfigMessage,
  buildListMessage,
} from "../utils/buildMessage";

/**
 * JID del grupo en .env: termina en @g.us (ej. 120363...@g.us).
 * Para filtrar mensajes usa getGroupChatId: en mensajes propios el grupo está en `to`, no en `from`.
 */
const ALLOWED_GROUP_IDS = (process.env.GROUP_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const COMMANDS = [
  "estoy",
  "salgo",
  "lista",
  "config",
  "partido",
  "limpiar lista",
];

const DEBUG = process.env.BOT_DEBUG === "1" || process.env.BOT_DEBUG === "true";

const isAllowedGroup = (chatId: string) => ALLOWED_GROUP_IDS.includes(chatId);

/**
 * JID del chat del mensaje. WhatsApp expone el chat de grupo de forma fiable en `id.remote`
 * (@g.us); `from`/`to` a veces no coinciden con GROUP_ID si la sesión o el cliente cambian.
 */
const getGroupChatId = (msg: any): string => {
  const remote = msg.id?.remote;
  if (typeof remote === "string" && remote.endsWith("@g.us")) {
    return remote;
  }
  return msg.fromMe ? msg.to : msg.from;
};

/**
 * En grupos, mensajes propios a veces no traen `author` y `from` no sirve para getContact().
 * El id del usuario conectado está en client.info.wid tras el evento `ready`.
 */

const getSenderId = (msg: any): string | undefined => {
  // En grupos, SIEMPRE usar author
  if (msg.author) return msg.author;

  // Mensajes propios
  if (msg.fromMe) {
    return msg.client?.info?.wid?._serialized;
  }

  // fallback (por seguridad)
  return msg.from;
};

const normalizeUserId = (id: string): string => {
  return id
    .split(":")[0] // elimina dispositivo
    .replace(/@.*/, ""); // elimina dominio (@c.us, etc)
};

const getSenderDisplayName = async (
  msg: any,
  senderId: string,
): Promise<string> => {
  if (msg.fromMe && msg.client?.info?.pushname) {
    return msg.client.info.pushname;
  }
  const contact = await msg.client.getContactById(senderId);
  return contact.pushname || contact.number;
};

const DAYS = [
  "lunes",
  "martes",
  "miercoles",
  "miércoles",
  "jueves",
  "viernes",
  "sabado",
  "sábado",
  "domingo",
];

const normalizeDay = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  if (!DAYS.includes(normalized)) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const normalizeHour = (value: string): string | null => {
  const clean = value.trim().toLowerCase().replace(/h$/, "");
  if (!/^\d{1,2}(:\d{2})?$/.test(clean)) return null;
  const [hourPart, minutePart] = clean.split(":");
  const hour = Number(hourPart);
  const minute = minutePart ? Number(minutePart) : 0;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return clean;
};

export const handleMessage = async (msg: any) => {
  try {
    await maybeAutoReset();
    const rawText = msg.body?.trim();

    if (!rawText) return;

    const lowerText = rawText.toLowerCase();
    let command = "";
    let manualName: string | undefined;
    let partidoField: "dia" | "hora" | "lugar" | undefined;

    if (
      lowerText === "config" ||
      lowerText === "lista" ||
      lowerText === "partido" ||
      lowerText === "limpiar lista"
    ) {
      command = lowerText;
    } else {
      const commandMatch = rawText.match(/^(estoy|salgo)(?::\s*(.+))?$/i);
      if (commandMatch) {
        command = commandMatch[1].toLowerCase();
        manualName = commandMatch[2]?.trim();
      } else {
        const matchConfigCommand = rawText.match(
          /^partido\s+(dia|hora|lugar)\s*:\s*(.+)$/i,
        );
        if (matchConfigCommand) {
          command = "partido_update";
          manualName = matchConfigCommand[2]?.trim();
          partidoField = matchConfigCommand[1].toLowerCase() as
            | "dia"
            | "hora"
            | "lugar";
        }

        if (/^partido\s+reset$/i.test(rawText)) {
          command = "partido_reset";
        }

        if (!command) return;
      }
    }

    if (ALLOWED_GROUP_IDS.length === 0) {
      console.error(
        "❌ Falta GROUP_ID en .env (JID del grupo, ej. 120363...@g.us). Comandos ignorados.",
      );
      return;
    }

    const chatId = getGroupChatId(msg);
    if (!isAllowedGroup(chatId)) {
      if (DEBUG && COMMANDS.includes(command)) {
        console.log("[voley-bot] Comando ignorado: chat no permitido");
      }
      return;
    }

    // 🛑 evitar loops del bot
    if (
      msg.fromMe &&
      !COMMANDS.includes(command) &&
      command !== "partido_update" &&
      command !== "partido_reset"
    ) {
      return;
    }

    const rawId = getSenderId(msg);
    if (!rawId) {
      console.error(
        "❌ No se pudo resolver el remitente (author/from/client.info.wid).",
      );
      return;
    }

    const id = normalizeUserId(rawId);

    if (!id) {
      console.error(
        "❌ No se pudo resolver el remitente (author/from/client.info.wid).",
      );
      return;
    }
    const name = await getSenderDisplayName(msg, id);

    // =========================
    // ✅ COMANDO: ESTOY
    // =========================
    if (command === "estoy") {
      const result = manualName
        ? await addManualPlayer(manualName)
        : await addPlayer({ id, name, source: "member" });

      if ("error" in result) {
        return msg.reply(`⚠️ ${result.error}`);
      }

      return msg.reply(buildListMessage(await getPlayers(), getMatchConfig()));
    }

    // =========================
    // ❌ COMANDO: SALGO
    // =========================
    if (command === "salgo") {
      const result = manualName
        ? // ? await removeManualPlayerByName(manualName)
          await removePlayerByName(manualName)
        : await removePlayer(id);

      if ("error" in result) {
        return msg.reply(`⚠️ ${result.error}`);
      }

      return msg.reply(buildListMessage(await getPlayers(), getMatchConfig()));
    }

    // =========================
    // 📋 COMANDO: LISTA
    // =========================
    if (command === "lista") {
      return msg.reply(buildListMessage(await getPlayers(), getMatchConfig()));
    }

    // =========================
    // 📋 COMANDO: LIMPIAR LISTA
    // =========================

    if (command === "limpiar lista") {
      await resetPlayers();

      return msg.reply(
        "🧹 Lista reiniciada\n\n" +
          buildListMessage(await getPlayers(), getMatchConfig()),
      );
    }

    // =========================
    // ⚙️ COMANDO: CONFIG
    // =========================
    if (command === "config") {
      return msg.reply(buildConfigMessage());
    }

    // =========================
    // 🗓️ COMANDO: PARTIDO
    // =========================
    if (command === "partido") {
      return msg.reply(buildMatchTitle(getMatchConfig()));
    }

    if (command === "partido_update") {
      if (!manualName || !partidoField) {
        return msg.reply("⚠️ Falta valor. Ej: `partido dia: viernes`");
      }

      if (partidoField === "dia") {
        const normalized = normalizeDay(manualName);
        if (!normalized) {
          return msg.reply("⚠️ Día inválido. Usa: lunes a domingo.");
        }
        const config = await updateMatchConfigField("day", normalized);
        return msg.reply(
          `✅ Partido actualizado:\n${buildListMessage(await getPlayers(), config)}`,
        );
      }

      if (partidoField === "hora") {
        const normalized = normalizeHour(manualName);
        if (!normalized) {
          return msg.reply("⚠️ Hora inválida. Usa formato 0-23 o HH:MM.");
        }
        const config = await updateMatchConfigField("hour", normalized);
        return msg.reply(
          `✅ Partido actualizado:\n${buildListMessage(await getPlayers(), config)}`,
        );
      }

      const normalizedPlace = manualName.trim();
      if (normalizedPlace.length < 2) {
        return msg.reply("⚠️ Lugar inválido.");
      }
      const config = await updateMatchConfigField("place", normalizedPlace);
      return msg.reply(
        `✅ Partido actualizado:\n${buildListMessage(await getPlayers(), config)}`,
      );
    }

    if (command === "partido_reset") {
      const config = await resetMatchConfig();
      return msg.reply(
        `✅ Partido reiniciado:\n${buildListMessage(await getPlayers(), config)}`,
      );
    }
  } catch (error) {
    console.error("❌ Error en handler:", error);
  }
};
