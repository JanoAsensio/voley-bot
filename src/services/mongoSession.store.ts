import fs from "node:fs";
import path from "node:path";
import type mongoose from "mongoose";

/**
 * Misma API que `wwebjs-mongo` para RemoteAuth, pero lee el ZIP donde lo escribe
 * whatsapp-web.js: `{dataPath}/{session}.zip` (p. ej. `.wwebjs_auth/RemoteAuth-voley-bot.zip`).
 *
 * El paquete `wwebjs-mongo` usa por error `./${session}.zip` en el cwd, lo que rompe
 * tras el fix de RemoteAuth que pasa solo `session` sin ruta absoluta.
 */
export class MongoSessionStore {
  private readonly mongoose: typeof mongoose;
  private readonly dataPath: string;

  constructor(opts: { mongoose: typeof mongoose; dataPath: string }) {
    if (!opts?.mongoose) {
      throw new Error("MongoSessionStore requiere mongoose.");
    }
    this.mongoose = opts.mongoose;
    this.dataPath = opts.dataPath;
  }

  async sessionExists(options: { session: string }): Promise<boolean> {
    const db = this.mongoose.connection.db;
    if (!db) return false;
    const coll = db.collection(`whatsapp-${options.session}.files`);
    const count = await coll.countDocuments();
    return count > 0;
  }

  async save(options: { session: string; bucket?: unknown }): Promise<void> {
    const zipPath = path.join(this.dataPath, `${options.session}.zip`);
    const db = this.mongoose.connection.db;
    if (!db) throw new Error("Mongoose sin conexión a DB.");

    const bucket = new this.mongoose.mongo.GridFSBucket(db, {
      bucketName: `whatsapp-${options.session}`,
    });

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(bucket.openUploadStream(`${options.session}.zip`))
        .on("error", reject)
        .on("close", () => resolve());
    });

    options.bucket = bucket;
    await this.deletePrevious({
      session: options.session,
      bucket,
    });
  }

  async extract(options: { session: string; path: string }): Promise<void> {
    const db = this.mongoose.connection.db;
    if (!db) throw new Error("Mongoose sin conexión a DB.");

    const bucket = new this.mongoose.mongo.GridFSBucket(db, {
      bucketName: `whatsapp-${options.session}`,
    });

    return new Promise((resolve, reject) => {
      bucket
        .openDownloadStreamByName(`${options.session}.zip`)
        .pipe(fs.createWriteStream(options.path))
        .on("error", reject)
        .on("close", () => resolve());
    });
  }

  async delete(options: { session: string }): Promise<void> {
    const db = this.mongoose.connection.db;
    if (!db) return;

    const bucket = new this.mongoose.mongo.GridFSBucket(db, {
      bucketName: `whatsapp-${options.session}`,
    });
    const documents = await bucket
      .find({ filename: `${options.session}.zip` })
      .toArray();
    await Promise.all(documents.map((doc) => bucket.delete(doc._id)));
  }

  private async deletePrevious(options: {
    session: string;
    bucket: import("mongoose").mongo.GridFSBucket;
  }): Promise<void> {
    const documents = await options.bucket
      .find({ filename: `${options.session}.zip` })
      .toArray();
    if (documents.length > 1) {
      const oldSession = documents.reduce((a, b) =>
        a.uploadDate < b.uploadDate ? a : b,
      );
      await options.bucket.delete(oldSession._id);
    }
  }
}
