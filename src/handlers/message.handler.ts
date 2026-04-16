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
  removePlayerByIdOrName,
  maybeAutoReset,
} from "../services/player.service";
import {
  buildMatchTitle,
  buildConfigMessage,
  buildListMessage,
  isValidLength,
} from "../utils/buildMessage";

/**
 * JIDs del grupo en .env (terminan en @g.us). Para filtrar mensajes se usa getGroupChatId.
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

const getGroupChatId = (msg: any): string => {
  const from = msg.from;
  if (typeof from === "string" && from.endsWith("@g.us")) {
    return from;
  }
  return msg.id?.remote || from;
};

/**
 * Estrategia híbrida:
 * - mensajes de otros usuarios: responder citando (`reply`) por UX
 * - mensajes propios (`fromMe`): enviar plano para evitar errores de quote
 */
// const sendGroupText = (msg: any, chatId: string, text: string) => {
//   if (!msg.fromMe) {
//     return msg.reply(text);
//   }
//   return msg.client.sendMessage(chatId, text, { sendSeen: false });
// };

const sendGroupText = async (msg: any, chatId: string, text: string) => {
  try {
    if (!msg.fromMe) {
      return await msg.reply(text);
    }

    return await msg.client.sendMessage(chatId, text, {
      sendSeen: false,
    });
  } catch (err) {
    console.error("❌ Error enviando mensaje, reintentando...", err);

    await new Promise((res) => setTimeout(res, 200));

    try {
      return await msg.client.sendMessage(chatId, text, {
        sendSeen: false,
      });
    } catch (err2) {
      console.error("❌ Segundo intento fallido:", err2);
      return null;
    }
  }
};

/**
 * En grupos, el autor del mensaje; en mensajes propios, el wid del cliente.
 */
const getSenderId = (msg: any): string | undefined => {
  if (msg.author) return msg.author;
  if (msg.fromMe) {
    return msg.client?.info?.wid?._serialized;
  }
  return msg.from;
};

const normalizeUserId = (id: string): string => {
  return id.split(":")[0].replace(/@.*/, "");
};

/**
 * Nombre para la lista sin `getContactById` / `getContact`: en grupos con
 * `message_create` la API de contactos suele fallar con `id` undefined.
 * Preferimos metadatos del mensaje si existen; si no, un fallback estable.
 */
const resolveMemberDisplayName = (msg: any, normalizedId: string): string => {
  const data = msg?._data as Record<string, unknown> | undefined;
  const fromMeta = data?.notifyName ?? data?.senderName ?? data?.pushname;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  if (normalizedId.length >= 4) return `Jugador ${normalizedId.slice(-4)}`;
  return normalizedId ? `Jugador ${normalizedId}` : "Sin nombre";
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
  let chatIdForError: string | undefined;
  try {
    await maybeAutoReset();

    const rawText = (msg.body || msg.caption || "").trim();
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
          /^partido\s+(dia|día|hora|lugar)\s*:\s*(.+)$/i,
        );
        if (matchConfigCommand) {
          command = "partido_update";
          manualName = matchConfigCommand[2]?.trim();
          partidoField = matchConfigCommand[1]
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") as "dia" | "hora" | "lugar";
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
    chatIdForError = chatId;

    if (!isAllowedGroup(chatId)) {
      if (DEBUG && COMMANDS.includes(command)) {
        console.log("[voley-bot] Comando ignorado: chat no permitido");
      }
      return;
    }

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

    if (command === "estoy") {
      const result = manualName
        ? await addManualPlayer(manualName)
        : await addPlayer({
            id,
            name: resolveMemberDisplayName(msg, id),
            source: "member",
          });

      if ("error" in result) {
        return sendGroupText(msg, chatId, `⚠️ ${result.error}`);
      }

      return sendGroupText(
        msg,
        chatId,
        buildListMessage(await getPlayers(), getMatchConfig()),
      );
    }

    if (command === "salgo") {
      const result = manualName
        ? await removePlayerByName(manualName)
        : await removePlayerByIdOrName(id, resolveMemberDisplayName(msg, id));

      if ("error" in result) {
        return sendGroupText(msg, chatId, `⚠️ ${result.error}`);
      }

      return sendGroupText(
        msg,
        chatId,
        buildListMessage(await getPlayers(), getMatchConfig()),
      );
    }

    if (command === "lista") {
      return sendGroupText(
        msg,
        chatId,
        buildListMessage(await getPlayers(), getMatchConfig()),
      );
    }

    if (command === "limpiar lista") {
      try {
        await resetPlayers();
      } catch (err) {
        console.error("❌ Error reiniciando lista:", err);
        return sendGroupText(
          msg,
          chatId,
          "⚠️ No pude reiniciar la lista (error de persistencia). Intenta de nuevo en unos segundos.",
        );
      }

      return sendGroupText(
        msg,
        chatId,
        "🧹 Lista reiniciada\n\n" +
          buildListMessage(await getPlayers(), getMatchConfig()),
      );
    }

    if (command === "config") {
      return sendGroupText(msg, chatId, buildConfigMessage());
    }

    if (command === "partido") {
      return sendGroupText(msg, chatId, buildMatchTitle(getMatchConfig()));
    }

    if (command === "partido_update") {
      if (!manualName || !partidoField) {
        return sendGroupText(
          msg,
          chatId,
          "⚠️ Falta valor para actualizar. Ej: `partido dia: viernes`.",
        );
      }

      if (partidoField === "dia") {
        const normalized = normalizeDay(manualName);
        if (!normalized) {
          return sendGroupText(
            msg,
            chatId,
            "⚠️ Día inválido. Usa de lunes a domingo. Ej: `partido dia: viernes`.",
          );
        }
        let config;
        try {
          config = await updateMatchConfigField("day", normalized);
        } catch (err) {
          console.error("❌ Error actualizando partido (día):", err);
          return sendGroupText(
            msg,
            chatId,
            "⚠️ No pude guardar el cambio en MongoDB. Intenta de nuevo en unos segundos.",
          );
        }
        return sendGroupText(
          msg,
          chatId,
          `✅ Partido actualizado:
          \n${buildListMessage(await getPlayers(), config)}`,
        );
      }

      if (partidoField === "hora") {
        const normalized = normalizeHour(manualName);
        if (!normalized) {
          return sendGroupText(
            msg,
            chatId,
            "⚠️ Hora inválida. Usa formato 0-23 o HH:MM. Ej: `partido hora: 21:30`.",
          );
        }
        let config;
        try {
          config = await updateMatchConfigField("hour", normalized);
        } catch (err) {
          console.error("❌ Error actualizando partido (hora):", err);
          return sendGroupText(
            msg,
            chatId,
            "⚠️ No pude guardar el cambio en MongoDB. Intenta de nuevo en unos segundos.",
          );
        }
        return sendGroupText(
          msg,
          chatId,
          `✅ Partido actualizado:
          \n${buildListMessage(await getPlayers(), config)}`,
        );
      }

      const normalizedPlace = manualName.trim();
      if (!isValidLength(normalizedPlace)) {
        return sendGroupText(
          msg,
          chatId,
          "⚠️ El lugar no puede superar los 20 caracteres.",
        );
      }
      if (normalizedPlace.length < 2) {
        return sendGroupText(
          msg,
          chatId,
          "⚠️ Lugar inválido. Debe tener al menos 2 caracteres. Ej: `partido lugar: Club Florida`.",
        );
      }
      let config;
      try {
        config = await updateMatchConfigField("place", normalizedPlace);
      } catch (err) {
        console.error("❌ Error actualizando partido (lugar):", err);
        return sendGroupText(
          msg,
          chatId,
          "⚠️ No pude guardar el cambio en MongoDB. Intenta de nuevo en unos segundos.",
        );
      }
      return sendGroupText(
        msg,
        chatId,
        `✅ Partido actualizado:
        \n${buildListMessage(await getPlayers(), config)}`,
      );
    }

    if (command === "partido_reset") {
      let config;
      try {
        config = await resetMatchConfig();
      } catch (err) {
        console.error("❌ Error reiniciando partido:", err);
        return sendGroupText(
          msg,
          chatId,
          "⚠️ No pude reiniciar el partido (error de persistencia). Intenta de nuevo en unos segundos.",
        );
      }
      return sendGroupText(
        msg,
        chatId,
        `✅ Partido reiniciado:
        \n${buildListMessage(await getPlayers(), config)}`,
      );
    }
  } catch (error) {
    console.error("❌ Error en handler:", error);
    // Mejor UX: si el error ocurre ya dentro de un chat permitido, avisar genérico.
    try {
      const chatId = chatIdForError ?? getGroupChatId(msg);
      if (typeof chatId === "string" && isAllowedGroup(chatId)) {
        await sendGroupText(
          msg,
          chatId,
          "⚠️ Ocurrió un error interno. Si vuelve a pasar, probá de nuevo en unos segundos.",
        );
      }
    } catch {
      // no-op: si no se puede responder, al menos ya quedó logueado arriba
    }
  }
};
