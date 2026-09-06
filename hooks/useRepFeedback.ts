"use client";

import { useEffect, useRef, useState } from "react";

import { playBloop } from "@/lib/audio";

/** Duración del destello. Suficiente para verlo, corto para no estorbar. */
const FLASH_MS = 150;

/**
 * Retroalimentación al completar una repetición: campanita y destello.
 *
 * Solo reacciona a subidas del contador. Un reinicio a cero (duelo nuevo) no
 * dispara nada.
 */
export function useRepFeedback(reps: number): { isFlashing: boolean } {
  const [isFlashing, setIsFlashing] = useState(false);
  const previousReps = useRef(reps);

  useEffect(() => {
    const previous = previousReps.current;
    previousReps.current = reps;

    if (reps <= previous) return;

    // El sonido sí es inmediato: es lo que hace que se sienta sin latencia.
    playBloop();

    // El destello se enciende en el siguiente tick. React 19 prohíbe setState
    // síncrono en el cuerpo de un efecto, y un timeout de 0 es imperceptible.
    const turnOn = setTimeout(() => setIsFlashing(true), 0);
    const turnOff = setTimeout(() => setIsFlashing(false), FLASH_MS);

    return () => {
      clearTimeout(turnOn);
      clearTimeout(turnOff);
    };
  }, [reps]);

  return { isFlashing };
}
