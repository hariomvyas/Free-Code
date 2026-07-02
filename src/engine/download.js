import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import https from "node:https";
import { promisify } from "node:util";

const inflateRaw = promisify(zlib.inflateRaw);

// GET a URL and parse JSON. Follows redirects. Used for the GitHub releases API.
export function httpJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    get(url, opts, (res, body) => {
      try {
        resolve(JSON.parse(body.toString("utf8")));
      } catch (err) {
        reject(new Error(`Bad JSON from ${url}: ${err.message}`));
      }
    }, reject);
  });
}

// Internal: issue a GET, follow up to 5 redirects, buffer the whole response.
function get(url, opts, onDone, onErr, depth = 0) {
  if (depth > 5) return onErr(new Error(`Too many redirects for ${url}`));
  const req = https.get(url, { headers: { "User-Agent": "free-code", ...opts.headers } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      const next = new URL(res.headers.location, url).toString();
      return get(next, opts, onDone, onErr, depth + 1);
    }
    if (res.statusCode !== 200) {
      res.resume();
      return onErr(new Error(`GET ${url} → HTTP ${res.statusCode}`));
    }
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => onDone(res, Buffer.concat(chunks)));
  });
  req.on("error", onErr);
}

// Download `url` to `dest`, following redirects and streaming to disk (so large
// GGUF files never sit fully in memory). Calls onProgress(receivedBytes,
// totalBytes|null) periodically. Writes atomically via a .part temp file.
export function downloadFile(url, dest, onProgress = () => {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error(`Too many redirects for ${url}`));
    const req = https.get(url, { headers: { "User-Agent": "free-code" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadFile(next, dest, onProgress, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers["content-length"] || "", 10) || null;
      let received = 0;
      const tmp = dest + ".part";
      const out = fs.createWriteStream(tmp);
      res.on("data", (c) => {
        received += c.length;
        onProgress(received, total);
      });
      res.pipe(out);
      out.on("error", reject);
      out.on("finish", () => {
        out.close(async () => {
          try {
            await fsp.rename(tmp, dest);
            resolve({ path: dest, bytes: received });
          } catch (err) {
            reject(err);
          }
        });
      });
    });
    req.on("error", reject);
  });
}

// ---- Minimal ZIP extractor ----------------------------------------------
// llama.cpp releases ship as .zip. Node's stdlib has DEFLATE (zlib) but no zip
// container reader, so we parse the archive ourselves to avoid pulling in an npm
// dependency. Supports store (0) and deflate (8), which is everything these
// archives use. Reads the central directory to enumerate entries reliably.

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

export async function unzip(zipPath, destDir) {
  const buf = await fsp.readFile(zipPath);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error(`Not a zip (no EOCD): ${zipPath}`);

  const entryCount = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16); // central directory offset
  const written = [];

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(cd) !== CDH_SIG) throw new Error("Corrupt zip central directory");
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString("utf8", cd + 46, cd + 46 + nameLen);
    cd += 46 + nameLen + extraLen + commentLen;

    // Locate the file data via the local header (its extra field length can
    // differ from the central directory's, so re-read it here).
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);

    const outPath = path.join(destDir, name);
    if (name.endsWith("/")) {
      await fsp.mkdir(outPath, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    const data = method === 8 ? await inflateRaw(comp) : Buffer.from(comp);
    await fsp.writeFile(outPath, data);
    written.push(outPath);
  }
  return written;
}

// Scan backwards for the End Of Central Directory signature (the archive may
// have a trailing comment, so we can't assume a fixed offset).
function findEOCD(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
