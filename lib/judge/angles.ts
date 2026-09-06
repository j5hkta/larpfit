/**
 * Geometría del juez. Lógica pura, sin React ni DOM.
 */

export type Point2D = {
  x: number;
  y: number;
};

/** Por debajo de esto los tres puntos son prácticamente el mismo. */
const EPSILON = 1e-9;

/**
 * Ángulo en grados (0-180) formado en el vértice `b` por los segmentos b→a y
 * b→c.
 *
 * Devuelve `null` si el ángulo no está definido, es decir cuando `a` o `c`
 * coinciden con el vértice. Devolver 0 en ese caso sería mucho peor que
 * devolver nada: el detector de planchas leería "codo totalmente flexionado" y
 * contaría repeticiones fantasma.
 *
 * Se usa atan2 en lugar del producto escalar con acos porque atan2 es estable
 * cerca de 0° y 180°, que es justo donde viven los umbrales de la máquina de
 * estados.
 */
export function calculateAngle(
  a: Point2D,
  b: Point2D,
  c: Point2D,
): number | null {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;

  // Vectores degenerados: no hay ángulo que medir.
  if (Math.hypot(baX, baY) < EPSILON || Math.hypot(bcX, bcY) < EPSILON) {
    return null;
  }

  const radians = Math.atan2(bcY, bcX) - Math.atan2(baY, baX);
  let degrees = Math.abs((radians * 180) / Math.PI);

  // atan2 devuelve el ángulo con signo en (-360, 360): nos quedamos con el
  // menor de los dos que forman los segmentos.
  if (degrees > 180) degrees = 360 - degrees;

  return degrees;
}
