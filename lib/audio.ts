/**
 * Sonido sintetizado con la Web Audio API. Sin archivos, sin descargas y sin
 * latencia: el "bloop" se genera matemáticamente en el momento.
 */

/**
 * Envolvente del sonido de repetición válida.
 *
 * Ojo con `floorGain`: `exponentialRampToValueAtTime` NO admite 0 como destino
 * (la rampa exponencial nunca alcanza el cero y el navegador lanza un error).
 * Por eso se baja hasta un valor mínimo audible-cero en vez de a 0.
 */
export const BLOOP = {
  type: "triangle" as OscillatorType,
  startFrequency: 400,
  endFrequency: 600,
  peakGain: 0.18,
  floorGain: 0.0001,
  /** Subida de volumen casi instantánea. */
  attackSeconds: 0.012,
  /** Lo que tarda el tono en subir de 400 a 600 Hz. */
  pitchSeconds: 0.06,
  /** Duración total: corto y seco, tipo campanita. */
  durationSeconds: 0.16,
} as const;

export type BloopSchedule = {
  start: number;
  attackEnd: number;
  pitchEnd: number;
  releaseEnd: number;
};

/** Calendario de la envolvente a partir del reloj del AudioContext. */
export function bloopSchedule(start: number): BloopSchedule {
  return {
    start,
    attackEnd: start + BLOOP.attackSeconds,
    pitchEnd: start + BLOOP.pitchSeconds,
    releaseEnd: start + BLOOP.durationSeconds,
  };
}

type AudioContextConstructor = typeof AudioContext;

declare global {
  interface Window {
    /** Safari antiguo. */
    webkitAudioContext?: AudioContextConstructor;
  }
}

/**
 * Un único AudioContext para toda la sesión.
 *
 * Crear uno por repetición agotaría el límite del navegador (media docena) y
 * dejaría de sonar a mitad del duelo.
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;

  try {
    sharedContext ??= new Ctor();
  } catch {
    return null;
  }

  return sharedContext;
}

/**
 * Despierta el audio aprovechando un gesto real del usuario.
 *
 * Los navegadores crean el AudioContext en estado `suspended` y solo permiten
 * reanudarlo desde una interacción. Si esperáramos a la primera repetición
 * (que ocurre a mitad del duelo, sin clic de por medio), Safari se negaría y
 * no sonaría nada.
 */
export function primeAudio(): void {
  const context = getContext();
  if (context?.state === "suspended") {
    void context.resume().catch(() => {});
  }
}

/** Campanita corta de repetición válida. Nunca lanza: el duelo manda. */
export function playBloop(): void {
  const context = getContext();
  if (!context || context.state === "closed") return;

  if (context.state === "suspended") {
    void context.resume().catch(() => {});
  }

  try {
    const time = bloopSchedule(context.currentTime);

    const oscillator = context.createOscillator();
    oscillator.type = BLOOP.type;
    oscillator.frequency.setValueAtTime(BLOOP.startFrequency, time.start);
    oscillator.frequency.exponentialRampToValueAtTime(
      BLOOP.endFrequency,
      time.pitchEnd,
    );

    const gain = context.createGain();
    gain.gain.setValueAtTime(BLOOP.floorGain, time.start);
    gain.gain.exponentialRampToValueAtTime(BLOOP.peakGain, time.attackEnd);
    gain.gain.exponentialRampToValueAtTime(BLOOP.floorGain, time.releaseEnd);

    oscillator.connect(gain).connect(context.destination);

    oscillator.start(time.start);
    oscillator.stop(time.releaseEnd);

    // Sin esto los nodos se acumulan en el grafo durante todo el duelo.
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch {
    // Un fallo de audio jamás puede tumbar un duelo.
  }
}
