// Myers O(ND) shortest edit script over arrays of comparable ids, with a hard cap on the edit distance so a
// pathological pair of inputs can never run away. Deterministic: ties always prefer deleting before inserting.
export type EditOp = { op: "eq" | "del" | "ins"; a: number; b: number }; // a: index in A (eq/del), b: index in B (eq/ins)

export class TooDifferent extends Error { constructor() { super("too-different"); } }

export function diffSequences<T>(A: readonly T[], B: readonly T[], maxD: number, same: (x: T, y: T) => boolean = (x, y) => x === y): EditOp[] {
  let lo = 0;
  while (lo < A.length && lo < B.length && same(A[lo], B[lo])) lo++;
  let ea = A.length, eb = B.length;
  while (ea > lo && eb > lo && same(A[ea - 1], B[eb - 1])) { ea--; eb--; }
  const ops: EditOp[] = [];
  for (let i = 0; i < lo; i++) ops.push({ op: "eq", a: i, b: i });
  const n = ea - lo, m = eb - lo;
  if (n === 0) for (let j = 0; j < m; j++) ops.push({ op: "ins", a: lo, b: lo + j });
  else if (m === 0) for (let i = 0; i < n; i++) ops.push({ op: "del", a: lo + i, b: lo });
  else ops.push(...middle(A, B, lo, n, m, maxD, same));
  for (let k = 0; k < A.length - ea; k++) ops.push({ op: "eq", a: ea + k, b: eb + k });
  return ops;
}

function middle<T>(A: readonly T[], B: readonly T[], lo: number, n: number, m: number, maxD: number, same: (x: T, y: T) => boolean): EditOp[] {
  const max = Math.min(n + m, maxD), off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && same(A[lo + x], B[lo + y])) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) throw new TooDifferent();
  const rev: EditOp[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d], k = x - y;
    const prevK = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
    const px = pv[off + prevK], py = px - prevK;
    while (x > px && y > py) { x--; y--; rev.push({ op: "eq", a: lo + x, b: lo + y }); }
    if (x === px) { y--; rev.push({ op: "ins", a: lo + x, b: lo + y }); } else { x--; rev.push({ op: "del", a: lo + x, b: lo + y }); }
  }
  while (x > 0 && y > 0) { x--; y--; rev.push({ op: "eq", a: lo + x, b: lo + y }); }
  return rev.reverse();
}
