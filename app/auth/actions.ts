"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isValidCountry } from "@/lib/countries";
import { createClient } from "@/utils/supabase/server";

export type AuthState = {
  error?: string;
  message?: string;
};

// Nota: un archivo "use server" solo puede exportar funciones asíncronas.
// El estado inicial del formulario vive en el componente cliente.

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Traduce los errores de Supabase Auth a algo que un usuario pueda entender.
 */
function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Confirma tu correo antes de entrar. Revisa tu bandeja de entrada.";
  }
  if (normalized.includes("user already registered")) {
    return "Ya existe una cuenta con ese correo.";
  }
  if (normalized.includes("duplicate key") || normalized.includes("profiles_username_key")) {
    return "Ese nombre de usuario ya está en uso.";
  }
  if (normalized.includes("password")) {
    return "La contraseña no cumple los requisitos mínimos.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
  }

  return message;
}

// -----------------------------------------------------------------------------
// LOGIN
// -----------------------------------------------------------------------------

export async function login(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = readString(formData, "email");
  const password = readString(formData, "password");

  if (!email || !password) {
    return { error: "Introduce tu correo y tu contraseña." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  revalidatePath("/", "layout");
  // redirect() lanza una excepción de control: debe quedar fuera de try/catch.
  redirect("/play");
}

// -----------------------------------------------------------------------------
// SIGNUP
// -----------------------------------------------------------------------------

export async function signup(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = readString(formData, "email");
  const password = readString(formData, "password");
  const username = readString(formData, "username");
  const country = readString(formData, "country");

  if (!email || !password || !username || !country) {
    return { error: "Rellena todos los campos para crear tu cuenta." };
  }

  if (!USERNAME_PATTERN.test(username)) {
    return {
      error:
        "El nombre de usuario debe tener entre 3 y 20 caracteres (letras, números o guion bajo).",
    };
  }

  if (password.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres." };
  }

  // El país se valida también en el servidor: nunca confiamos en el <select>.
  if (!isValidCountry(country)) {
    return { error: "Selecciona un país válido." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // CRÍTICO: estos datos llegan a auth.users.raw_user_meta_data, que es de
      // donde el trigger handle_new_user() saca el username y el country para
      // crear la fila en public.profiles.
      data: { username, country },
    },
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  // Si el proyecto exige confirmación por correo, signUp no devuelve sesión.
  if (!data.session) {
    return {
      message:
        "Cuenta creada. Te hemos enviado un correo de confirmación: verifícalo y vuelve a iniciar sesión.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/play");
}

// -----------------------------------------------------------------------------
// LOGOUT
// -----------------------------------------------------------------------------

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/");
}
