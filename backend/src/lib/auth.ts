import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // Fail loudly at startup rather than silently signing tokens with
  // `undefined` as the secret, which would make every token forgeable.
  throw new Error(
    "JWT_SECRET is not set. Add it to your .env file before starting the server."
  );
}

const TOKEN_EXPIRY = "7d";
// 10 rounds is bcrypt's well-established, widely-used default: strong
// enough for password storage without making login noticeably slow.
const BCRYPT_ROUNDS = 10;

export type JwtPayload = {
  userId: string;
  username: string;
};

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Returns the decoded payload if the token is valid, or `null` if it's
 * missing, malformed, expired, or tampered with. Callers should treat
 * `null` as "unauthenticated" and respond accordingly — this function
 * deliberately never throws, so call sites don't each need their own
 * try/catch around it.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET as string) as JwtPayload;
  } catch {
    return null;
  }
}
