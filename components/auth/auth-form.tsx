"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  Globe2,
  KeyRound,
  Loader2,
  UserRound,
} from "lucide-react";

import { login, signup, type AuthState } from "@/app/auth/actions";
import { COUNTRIES } from "@/lib/countries";

type Mode = "login" | "signup";

const inputClass =
  "w-full rounded-lg border border-arena-700 bg-arena-950/70 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-arena-500 transition-colors focus:border-volt-500 focus:outline-none";

const EMPTY_STATE: AuthState = {};

const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-arena-300";

export function AuthForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<Mode>("login");

  const [loginState, loginAction, loginPending] = useActionState(
    login,
    EMPTY_STATE,
  );
  const [signupState, signupAction, signupPending] = useActionState(
    signup,
    EMPTY_STATE,
  );

  const isLogin = mode === "login";
  const state: AuthState = isLogin ? loginState : signupState;
  const pending = isLogin ? loginPending : signupPending;

  // El error del proxy (sesión caducada) solo se muestra hasta el primer envío.
  const error = state.error ?? (!state.message ? initialError : undefined);

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-arena-700/70 bg-arena-900/80 p-6 shadow-2xl shadow-black/60 backdrop-blur sm:p-8">
        {/* Selector de modo */}
        <div
          role="tablist"
          aria-label="Autenticación"
          className="mb-7 grid grid-cols-2 gap-1 rounded-xl border border-arena-700/70 bg-arena-950 p-1"
        >
          {(["login", "signup"] as const).map((value) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(value)}
                className={`rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
                  active
                    ? "bg-volt-500 text-arena-950"
                    : "text-arena-300 hover:text-white"
                }`}
              >
                {value === "login" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            );
          })}
        </div>

        <form action={isLogin ? loginAction : signupAction} className="space-y-4">
          <div>
            <label htmlFor="email" className={labelClass}>
              Correo
            </label>
            <div className="relative">
              <AtSign
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-arena-500"
              />
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="tu@correo.com"
                className={inputClass}
              />
            </div>
          </div>

          {!isLogin && (
            <div>
              <label htmlFor="username" className={labelClass}>
                Nombre de usuario
              </label>
              <div className="relative">
                <UserRound
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-arena-500"
                />
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_]+"
                  autoComplete="username"
                  placeholder="ElRompeGyms"
                  className={inputClass}
                />
              </div>
              <p className="mt-1.5 text-xs text-arena-500">
                3–20 caracteres. Letras, números y guion bajo.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="password" className={labelClass}>
              Contraseña
            </label>
            <div className="relative">
              <KeyRound
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-arena-500"
              />
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                autoComplete={isLogin ? "current-password" : "new-password"}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
          </div>

          {!isLogin && (
            <div>
              <label htmlFor="country" className={labelClass}>
                País
              </label>
              <div className="relative">
                <Globe2
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-arena-500"
                />
                <select
                  id="country"
                  name="country"
                  required
                  defaultValue=""
                  className={`${inputClass} appearance-none`}
                >
                  <option value="" disabled>
                    Elige tu región…
                  </option>
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.flag} {country.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1.5 text-xs text-arena-500">
                Solo competirás contra gente de tu misma región.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-flex-500/40 bg-flex-500/10 px-3 py-2.5 text-sm text-flex-400"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {state.message && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg border border-volt-500/40 bg-volt-500/10 px-3 py-2.5 text-sm text-volt-400"
            >
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{state.message}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-volt-500 px-4 py-3 text-sm font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {pending
              ? "Cargando…"
              : isLogin
                ? "Entrar a la arena"
                : "Crear cuenta"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-arena-500">
        15 segundos. Un rival. Un juez que no parpadea.
      </p>
    </div>
  );
}
