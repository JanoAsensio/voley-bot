import { Player } from "../types/player";
import { MatchConfig } from "../services/player.service";

export const buildMatchTitle = (config: MatchConfig) => {
  const day = config.day || "{día}";
  const place = config.place || "{lugar}";

  // Normalize hour so it doesn't duplicate 'h'
  let hour = config.hour || "{hora}";
  if (hour !== "{hora}" && !hour.endsWith("h")) {
    hour = `${hour}h`;
  }

  return `🏐 ${day} ${hour} ${place}`;
};

export const buildListMessage = (players: Player[], config: MatchConfig) => {
  if (players.length === 0) return "📭 No hay jugadores";

  const titulares = players.slice(0, 12);
  const extras = players.slice(12);

  const titularesText = titulares
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");

  const extrasText = extras.map((p, i) => `${i + 13}. ${p.name}`).join("\n");

  return `${buildMatchTitle(config)}

${titularesText}

${extras.length ? `\nExtras:\n${extrasText}` : ""}`;
};

type BotCommandHelp = {
  name: string;
  description: string;
};

export const BOT_COMMANDS_HELP: BotCommandHelp[] = [
  { name: "config", description: "muestra estos comandos" },

  { name: "lista", description: "muestra el listado actual" },
  { name: "limpiar lista", description: "elimina todos los jugadores" },
  { name: "estoy", description: "te suma al listado" },
  { name: "estoy: nombre", description: "suma el nombre indicado" },
  { name: "salgo", description: "te remueve del listado" },
  { name: "salgo: nombre", description: "remueve el nombre indicado" },

  { name: "partido", description: "muestra día, hora y lugar del partido" },
  {
    name: "partido dia: valor",
    description: "actualiza el día y muestra listado",
  },
  {
    name: "partido hora: valor",
    description: "actualiza la hora y muestra listado",
  },
  {
    name: "partido lugar: valor",
    description: "actualiza el lugar y muestra listado",
  },
  { name: "partido reset", description: "vuelve a Domingo 20h Club Florida" },
];

export const buildConfigMessage = () => {
  return (
    "⚙️ Comandos disponibles\n\n" +
    BOT_COMMANDS_HELP.map((cmd) => {
      if (cmd.name === "config") {
        return `\`${cmd.name}\` = ${cmd.description}\n`; // 👈 salto extra
      }

      if (cmd.name === "salgo: nombre") {
        return `\`${cmd.name}\` = ${cmd.description}\n`; // 👈 salto extra
      }

      return `\`${cmd.name}\` = ${cmd.description}`;
    }).join("\n")
  );
};
