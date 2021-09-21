import { ReadTransaction, WriteTransaction } from "replicache";
import * as t from "io-ts";
import { must } from "./decode";
import { nanoid } from "nanoid";
import { randInt } from "./rand";

export const shape = t.type({
  type: t.literal("rect"),
  x: t.number,
  y: t.number,
  width: t.number,
  height: t.number,
  rotate: t.number,
  fill: t.string,
  opacity: t.number,
});

export type Shape = t.TypeOf<typeof shape>;

export async function getShape(
  tx: ReadTransaction,
  id: string
): Promise<Shape | null> {
  const jv = await tx.get(key(id));
  if (!jv) {
    console.log(`Specified shape ${id} not found.`);
    return null;
  }
  return must(shape.decode(jv));
}

export function putShape(
  tx: WriteTransaction,
  { id, shape }: { id: string; shape: Shape }
): Promise<void> {
  return tx.put(key(id), shape);
}

export async function deleteShape(
  tx: WriteTransaction,
  id: string
): Promise<void> {
  await tx.del(key(id));
}

export async function moveShape(
  tx: WriteTransaction,
  { id, dx, dy }: { id: string; dx: number; dy: number }
): Promise<void> {
  const shape = await getShape(tx, id);
  if (shape) {
    shape.x += dx;
    shape.y += dy;
    await putShape(tx, { id, shape });
  }
}

export async function resizeShape(
  tx: WriteTransaction,
  { id, ds }: { id: string; ds: number }
): Promise<void> {
  const shape = await getShape(tx, id);
  if (shape) {
    const minSize = 10;
    const dw = Math.max(minSize - shape.width, ds);
    const dh = Math.max(minSize - shape.height, ds);
    shape.width += dw;
    shape.height += dh;
    shape.x -= dw / 2;
    shape.y -= dh / 2;
    await putShape(tx, { id, shape });
  }
}

export async function rotateShape(
  tx: WriteTransaction,
  { id, ddeg }: { id: string; ddeg: number }
): Promise<void> {
  const shape = await getShape(tx, id);
  if (shape) {
    shape.rotate += ddeg;
    await putShape(tx, { id, shape });
  }
}

export async function initShapes(
  tx: WriteTransaction,
  shapes: { id: string; shape: Shape }[]
) {
  if (await tx.has("initialized")) {
    return;
  }
  await Promise.all([
    tx.put("initialized", true),
    ...shapes.map((s) => putShape(tx, s)),
  ]);
}

export async function adjustOpacity(
  tx: WriteTransaction,
  { id, delta }: { id: string; delta: number }
): Promise<void> {
  const shape = await getShape(tx, id);
  if (shape) {
    shape.opacity += delta;
    shape.opacity = Math.min(1, Math.max(0, shape.opacity));
    await putShape(tx, { id, shape });
  }
}

function key(id: string): string {
  return `${shapePrefix}${id}`;
}

export const shapePrefix = "shape-";

const colors = ["red", "blue", "white", "green", "yellow"];
let nextColor = 0;

export function randomShape() {
  const s = randInt(100, 400);
  const fill = colors[nextColor++];
  if (nextColor == colors.length) {
    nextColor = 0;
  }
  return {
    id: nanoid(),
    shape: {
      type: "rect",
      x: randInt(0, 400),
      y: randInt(0, 400),
      width: s,
      height: s,
      rotate: randInt(0, 359),
      fill,
      opacity: 1,
    } as Shape,
  };
}
