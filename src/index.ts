// Debe ir primero: los demás imports leen process.env al cargarse (p. ej. GROUP_ID en message.handler).
import "dotenv/config";

import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { handleMessage } from "./handlers/message.handler";
import { initPlayerStore } from "./services/player.service";

const groupIds = (process.env.GROUP_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (groupIds.length > 0 && !groupIds.every((id) => id.endsWith("@g.us"))) {
  console.warn(
    "⚠️ GROUP_ID debe ser el JID del grupo (termina en @g.us). Un ID @lid no filtra mensajes de grupo.",
  );
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "voley-bot-fresh",
  }),
});

client.on("qr", (qr) => {
  if (process.env.NODE_ENV !== "production") {
    qrcode.generate(qr, { small: true });
  }
});

client.on("ready", () => {
  console.log("🤖 Bot listo");
});

client.on("message_create", handleMessage);

void initPlayerStore()
  .then(() => client.initialize())
  .catch((err) => {
    console.error("❌ Error al iniciar:", err);
    process.exitCode = 1;
  });
