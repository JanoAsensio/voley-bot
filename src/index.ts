// Debe ir primero: los demás imports leen process.env al cargarse (p. ej. GROUP_ID en message.handler).
import "dotenv/config";

import { Client, RemoteAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { handleMessage } from "./handlers/message.handler";
import { initPlayerStore } from "./services/player.service";

import mongoose from "mongoose";
import { MongoStore } from "wwebjs-mongo";

const groupIds = (process.env.GROUP_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (groupIds.length > 0 && !groupIds.every((id) => id.endsWith("@g.us"))) {
  console.warn(
    "⚠️ GROUP_ID debe ser el JID del grupo (termina en @g.us). Un ID @lid no filtra mensajes de grupo.",
  );
}

(async () => {
  try {
    // 1. Conectar Mongo (ya lo usás para players)
    await mongoose.connect(process.env.MONGODB_URI!);

    console.log("📥 MongoDB conectado");

    // 2. Crear store para sesión de WhatsApp
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

    // 3. Crear cliente con RemoteAuth
    const store = new MongoStore({ mongoose });

    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        clientId: "voley-bot",
        dataPath: "./sessions",
        backupSyncIntervalMs: 300000,
      }),
      puppeteer: {
        executablePath: process.env.RAILWAY_ENVIRONMENT
          ? "/usr/bin/chromium"
          : undefined,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    // 4. Eventos
    client.on("qr", (qr) => {
      if (!isRailway) {
        console.log("📲 Escaneá este QR (solo una vez)");
        qrcode.generate(qr, { small: true });
      }
    });

    client.on("authenticated", () => {
      console.log("🔐 Auth OK");
    });

    client.on("ready", () => {
      console.log("🤖 Bot listo");
    });

    client.on("message_create", handleMessage);

    // 5. Inicializar tu store actual (players)
    await initPlayerStore();

    // 6. Iniciar cliente
    await client.initialize();
  } catch (err) {
    console.error("❌ Error al iniciar:", err);
    process.exit(1);
  }
})();
