"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";

/**
 * Redirects to /login if there's no logged-in user, once the initial
 * localStorage check has finished. Every page that requires a session
 * uses this instead of repeating the same effect + redirect logic.
 */
export function useRequireAuth() {
  const router = useRouter();
  const { token, user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!token) router.replace("/login");
  }, [isLoading, token, router]);

  return { token, user, isLoading };
}
