/**
 * Copia los assets de @mediapipe/pose a public/mediapipe/pose.
 *
 * Por qué hace falta: el paquete npm de MediaPipe no es un módulo ES real.
 * `pose.js` es un IIFE que asigna `window.Pose` y no exporta nada (cero
 * `module.exports`), y el runtime necesita cargar por HTTP sus propios .wasm,
 * .data y .tflite. Nada de eso lo sirve Next desde node_modules, así que lo
 * copiamos a public/ antes de `dev` y de `build`.
 *
 * Los archivos NO se versionan (ver .gitignore): se regeneran en cada install.
 */

import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@mediapipe", "pose");
const target = join(root, "public", "mediapipe", "pose");

// 27 MB que no usamos: solo hace falta con modelComplexity: 2.
const SKIP = new Set([
  "pose_landmark_heavy.tflite",
  "package.json",
  "README.md",
  "index.d.ts",
]);

async function main() {
  try {
    await stat(source);
  } catch {
    console.warn(
      "[mediapipe] @mediapipe/pose no está instalado; me salto la copia.",
    );
    return;
  }

  await mkdir(target, { recursive: true });

  const files = await readdir(source);
  let copied = 0;

  for (const file of files) {
    if (SKIP.has(file)) continue;
    await cp(join(source, file), join(target, file));
    copied += 1;
  }

  console.log(
    `[mediapipe] ${copied} archivos copiados a public/mediapipe/pose`,
  );
}

await main();
