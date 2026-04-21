import mongoose from "mongoose";

export const checkWhatsAppSession = async () => {
  const db = mongoose.connection.db;

  if (!db) {
    console.log("❌ Mongo no está conectado");
    return false;
  }

  const collections = await db.listCollections().toArray();

  const hasChunks = collections.some((c) =>
    c.name.includes("whatsapp-voley-bot.chunks"),
  );

  const hasFiles = collections.some((c) =>
    c.name.includes("whatsapp-voley-bot.files"),
  );

  if (!hasChunks || !hasFiles) {
    console.log("❌ No existe sesión de WhatsApp en Mongo");
    return false;
  }

  const chunksCount = await db
    .collection("whatsapp-voley-bot.chunks")
    .countDocuments();

  const filesCount = await db
    .collection("whatsapp-voley-bot.files")
    .countDocuments();

  if (chunksCount === 0 || filesCount === 0) {
    console.log("❌ Sesión vacía en Mongo");
    return false;
  }

  console.log("✅ Sesión válida encontrada en Mongo");
  console.log(`📦 chunks: ${chunksCount}`);
  console.log(`📁 files: ${filesCount}`);

  return true;
};
