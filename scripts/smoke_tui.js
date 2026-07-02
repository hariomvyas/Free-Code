// Headless tests for the pure TUI frame composer — validates layout math,
// scrolling, wrapping, cursor placement, and the input line without a TTY.
import { composeFrame, stripAnsi, wrapToWidth } from "../src/tui.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  cond ? pass++ : fail++;
}

// 1. Frame has exactly `rows` lines.
const st = { title: "Free Code", lines: ["hello", "world"], scroll: 0, input: "hi", cursor: 2, status: "" };
let f = composeFrame(st, 40, 10);
ok("frame row count == rows", f.rows.length === 10);

// 2. Header on row 0; input (with prompt) on the input box's middle row.
// Layout reserves 6 rows at the bottom: status + 3-row input box + hint. For a
// 10-row screen the input line sits at index 7 (0-based); box borders are 6 & 8.
ok("header shows title", stripAnsi(f.rows[0]).includes("Free Code"));
ok("input line shows input", stripAnsi(f.rows[7]).includes("hi"));
ok("input box has rounded border", stripAnsi(f.rows[6]).startsWith("╭") && stripAnsi(f.rows[8]).startsWith("╰"));
ok("hint row present", stripAnsi(f.rows[9]).includes("ctrl+c"));

// 3. Cursor sits inside the input box (row height-2), past the border+space+prompt.
ok("cursor row is input box", f.cursorRow === 8);
ok("cursor col past prompt", f.cursorCol === 1 + 1 + "› ".length + 2 + 1);

// 4. Transcript shows most recent lines at the bottom of the body region.
const many = { title: "t", lines: Array.from({ length: 100 }, (_, i) => "line" + i), scroll: 0, input: "", cursor: 0, status: "" };
// body region is rows[1..(height-6)] inclusive => indices 1..4 for a 10-row screen
f = composeFrame(many, 40, 10);
const body = f.rows.slice(1, 5).map(stripAnsi).map((s) => s.trim());
ok("newest line visible at bottom", body[body.length - 1] === "line99");

// 5. Scrolling up shows older lines.
f = composeFrame({ ...many, scroll: 10 }, 40, 10);
const body2 = f.rows.slice(1, 5).map(stripAnsi).map((s) => s.trim());
ok("scroll shows older lines", body2[body2.length - 1] === "line89");

// 6. Long lines wrap to width.
const wrapped = wrapToWidth("a".repeat(50), 20);
ok("wrap splits long line", wrapped.length === 3 && wrapped.every((l) => stripAnsi(l).length <= 20));

// 7. Tiny terminal doesn't crash.
f = composeFrame(st, 10, 6);
ok("tiny terminal ok", f.rows.length === 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
