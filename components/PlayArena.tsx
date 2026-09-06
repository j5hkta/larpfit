"use client";

import { useCallback, useState } from "react";

import { Matchmaker } from "@/components/Matchmaker";
import { ModeSelect } from "@/components/ModeSelect";
import { primeAudio } from "@/lib/audio";
import type { GameMode } from "@/types/match";

/**
 * Orquesta el flujo de /play: primero se elige disciplina, después se entra a
 * la cola de esa disciplina. La página sigue siendo un Server Component; el
 * estado de la selección vive aquí.
 */

type PlayArenaProps = {
  userId: string;
  username: string;
  country: string;
};

export function PlayArena({ userId, username, country }: PlayArenaProps) {
  const [mode, setMode] = useState<GameMode | null>(null);

  /**
   * Elegir disciplina es el último gesto real del usuario antes del duelo, así
   * que es el momento de despertar el AudioContext. Si esperásemos a la primera
   * repetición, la política de autoplay del navegador lo bloquearía y no
   * sonaría nada.
   */
  const selectMode = useCallback((selected: GameMode) => {
    primeAudio();
    setMode(selected);
  }, []);

  // Volver al selector saca al jugador de la cola: Matchmaker se desmonta y su
  // limpieza cierra el canal de Realtime.
  const backToSelect = useCallback(() => setMode(null), []);

  if (!mode) {
    return (
      <ModeSelect username={username} country={country} onSelect={selectMode} />
    );
  }

  return (
    <Matchmaker
      key={mode}
      userId={userId}
      username={username}
      country={country}
      gameMode={mode}
      onChangeMode={backToSelect}
    />
  );
}
