"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, loginUser } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await loginUser(username, password);
      login(result.token, result.user);
      router.push("/rooms");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.mark}>◆ RELAY</div>
        <h1 style={styles.heading}>Welcome back</h1>
        <p style={styles.sub}>Log in to rejoin your rooms.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Username
            <input
              style={styles.input}
              value={username}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" style={styles.button} disabled={isSubmitting}>
            {isSubmitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p style={styles.footer}>
          No account? <Link href="/register" style={styles.link}>Register</Link>
        </p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  card: {
    width: "100%",
    maxWidth: "380px",
    background: "#fff",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius)",
    padding: "32px",
  },
  mark: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    letterSpacing: "0.12em",
    color: "var(--signal)",
    marginBottom: "20px",
  },
  heading: { margin: "0 0 4px", fontSize: "1.6rem" },
  sub: { margin: "0 0 24px", color: "var(--slate)", fontSize: "0.95rem" },
  form: { display: "flex", flexDirection: "column", gap: "16px" },
  label: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem", color: "var(--slate)" },
  input: {
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid var(--line)",
    background: "var(--paper)",
    color: "var(--ink)",
  },
  error: {
    color: "var(--danger)",
    fontSize: "0.85rem",
    margin: 0,
    background: "#fbeceb",
    padding: "8px 12px",
    borderRadius: "8px",
  },
  button: {
    marginTop: "6px",
    padding: "11px",
    borderRadius: "8px",
    border: "none",
    background: "var(--ink)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  footer: { marginTop: "20px", fontSize: "0.85rem", color: "var(--slate)", textAlign: "center" },
  link: { color: "var(--signal)", fontWeight: 600, textDecoration: "none" },
};
