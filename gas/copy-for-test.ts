import { copyFileSync } from "node:fs";
// .gs は Node から require できないので、テストの前に .cjs として写す
export default function setup() {
  copyFileSync("gas/Code.gs", "gas/Code.gs.cjs");
}
