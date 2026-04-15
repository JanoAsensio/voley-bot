import { Player } from "../types/player";
import { MatchConfig } from "../services/player.service";

export const isValidLength = (text: string, max = 20) => {
  return text.trim().length <= max;
};

export const buildMatchTitle = (config: MatchConfig) => {
  const day = config.day || "{día}";
  const place = config.place || "{lugar}";

  let hour = config.hour || "{hora}";
  if (hour !== "{hora}" && !hour.endsWith("h")) {
    hour = `${hour}h`;
  }

  return `🏐 ${day} ${hour} ${place}`;
};

export const buildListMessage = (players: Player[], config: MatchConfig) => {
  const title = buildMatchTitle(config);

  if (players.length === 0) {
    return `${title}

📭 No hay jugadores`;
  }

  const titulares = players.slice(0, 12);
  const extras = players.slice(12);
  const titularesCount = titulares.length;
  const extrasCount = extras.length;

  const titularesText = titulares
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");

  const extrasText = extras.map((p, i) => `${i + 13}. ${p.name}`).join("\n");

  return `${title}

👥 Titulares (${titularesCount}/12)
${titularesText}${
    extras.length
      ? `

🪑 Extras (${extrasCount})
${extrasText}`
      : ""
  }`;
};

type BotCommandHelp = {
  name: string;
  description: string;
};

const formatHelpItems = (items: BotCommandHelp[]) =>
  items.map((item) => `• \`${item.name}\` — ${item.description}`).join("\n");

const PLAYER_COMMANDS: BotCommandHelp[] = [
  { name: "estoy", description: "sumar tu usuario a la lista" },
  { name: "estoy: nombre", description: "sumar un invitado por nombre" },
  { name: "salgo", description: "quitar tu usuario de la lista" },
  { name: "salgo: nombre", description: "quitar un invitado por nombre" },
  { name: "lista", description: "ver la lista actual" },
  { name: "limpiar lista", description: "reiniciar toda la lista" },
];

const MATCH_COMMANDS: BotCommandHelp[] = [
  { name: "partido", description: "ver día, hora y lugar" },
  { name: "partido dia: viernes", description: "actualizar el día" },
  { name: "partido hora: 21:30", description: "actualizar la hora" },
  { name: "partido lugar: Club Florida", description: "actualizar el lugar" },
  { name: "partido reset", description: "restaurar valores por defecto" },
];

const UTILITY_COMMANDS: BotCommandHelp[] = [
  { name: "config", description: "mostrar este menú de ayuda" },
];

export const buildConfigMessage = () => {
  return `⚙️ Configuración del bot

👥 Jugadores
${formatHelpItems(PLAYER_COMMANDS)}

🏐 Partido
${formatHelpItems(MATCH_COMMANDS)}

🧰 Utilidades
${formatHelpItems(UTILITY_COMMANDS)}

💡 Tip: Usa \`estoy: nombre\` para sumar invitados y \`salgo: nombre\` para quitarlos.`;
};
