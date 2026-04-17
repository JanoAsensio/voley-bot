// Debe ir primero: los demás imports leen process.env al cargarse (p. ej. GROUP_ID en message.handler).
import "dotenv/config";

import path from "node:path";
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
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    const showQrOnRailway =
      process.env.BOT_SHOW_QR_ON_RAILWAY === "1" ||
      process.env.BOT_SHOW_QR_ON_RAILWAY === "true";

    // 1. Mongoose: mismo cluster que `player.service`, usado por wwebjs-mongo (GridFS de la sesión WA).
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("📥 Mongoose conectado (sesión WhatsApp → MongoDB / GridFS)");

    // 2. Store de sesión (RemoteAuth + wwebjs-mongo)
    const store = new MongoStore({ mongoose });

    // Ruta estable relativa al cwd del proceso (en Railway suele ser /app).
    const authDataPath = path.join(process.cwd(), ".wwebjs_auth");

    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        clientId: "voley-bot",
        backupSyncIntervalMs: 300000,
        dataPath: authDataPath,
      }),
      puppeteer: {
        executablePath: isRailway ? "/usr/bin/chromium" : undefined,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--disable-gpu",
        ],
      },
    });

    // 3. Eventos (diagnóstico útil en Railway)
    client.on("qr", (qr) => {
      if (!isRailway || showQrOnRailway) {
        console.log("📲 Escaneá este QR (vinculación de WhatsApp)");
        qrcode.generate(qr, { small: true });
      } else {
        console.warn(
          "⚠️ WhatsApp pidió QR pero en Railway no se muestra por defecto. " +
            "Si es la primera vez en este entorno, poné BOT_SHOW_QR_ON_RAILWAY=true en variables, redeploy, escaneá el QR de los logs y luego quitá esa variable.",
        );
      }
    });

    client.on("authenticated", () => {
      console.log("🔐 Auth OK");
    });

    client.on("auth_failure", (msg) => {
      console.error("❌ auth_failure:", msg);
    });

    client.on("change_state", (s) => {
      console.log("↪️ Estado WA:", s);
    });

    client.on("loading_screen", (percent, message) => {
      console.log(`⏳ Cargando WhatsApp Web: ${percent}% — ${message}`);
    });

    client.on("ready", () => {
      console.log("🤖 Bot listo");
    });

    client.on("disconnected", (reason) => {
      console.warn("⚠️ Cliente desconectado:", reason);
    });

    client.on("message_create", handleMessage);

    // 4. Lista de jugadores (driver nativo `mongodb`, misma URI)
    await initPlayerStore();

    // 5. Arranque del navegador (puede tardar varios minutos la primera vez)
    console.log("🚀 Inicializando cliente de WhatsApp…");
    await client.initialize();
  } catch (err) {
    console.error("❌ Error al iniciar:", err);
    process.exit(1);
  }
})();
