import { randomInt } from "node:crypto";

// The short code a customer reads out at the counter. No 0, O, 1 or I, so it survives being spoken or
// read off a phone. Uniqueness is the database's job (orders.public_code is unique); the caller retries.

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;

export function generatePublicCode(random: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}
