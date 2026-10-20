// ホーム画面のアイコン（緑の地に金色のコイン）を PNG で作る。npm run icons
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / size, dy = (y + 0.5 - c) / size, r = Math.hypot(dx, dy);
      let col = [0x1d, 0x6a, 0x50];
      if (r < 0.34) col = [0xe0, 0xb4, 0x3c];
      if (r < 0.34 && r > 0.29) col = [0xc4, 0x93, 0x22];
      // 円の中の「¥」：縦棒と2本の横棒と V 字
      const ax = Math.abs(dx);
      const yen = r < 0.29 && ((ax < 0.025 && dy > -0.04 && dy < 0.17) || (Math.abs(dy - 0.02) < 0.018 && ax < 0.1) || (Math.abs(dy - 0.08) < 0.018 && ax < 0.1) || (dy < -0.02 && dy > -0.17 && Math.abs(ax - (-dy - 0.02) * 0.75) < 0.03));
      if (yen) col = [0x1d, 0x6a, 0x50];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync("public/icon-192.png", png(192));
writeFileSync("public/icon-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));
writeFileSync("public/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d6a50"/><circle cx="32" cy="32" r="21" fill="#e0b43c" stroke="#c4932f" stroke-width="3"/><path d="M23 20l9 12 9-12M32 32v14M25 34h14M25 39h14" stroke="#1d6a50" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>`);
console.log("icons written");
