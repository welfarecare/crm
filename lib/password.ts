// Password temporanea: 14 caratteri, sempre con minuscole, maiuscole, numeri e un simbolo.
// Esclusi i caratteri facili da confondere quando la si detta a voce (0/O, 1/l/I).
const MINUSCOLE = "abcdefghijkmnpqrstuvwxyz";
const MAIUSCOLE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMERI = "23456789";
const SIMBOLI = "!@#$%*?+=-";
const TUTTI = MINUSCOLE + MAIUSCOLE + NUMERI + SIMBOLI;

function casuale(max: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}
const uno = (s: string) => s[casuale(s.length)];

export function passwordCasuale(lunghezza = 14) {
  const c = [uno(MINUSCOLE), uno(MAIUSCOLE), uno(NUMERI), uno(SIMBOLI)];
  while (c.length < lunghezza) c.push(uno(TUTTI));
  // mescola
  for (let i = c.length - 1; i > 0; i--) {
    const j = casuale(i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.join("");
}

export function passwordValida(p: string) {
  return p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
}

export const REGOLA_PASSWORD = "Almeno 12 caratteri, con minuscole, maiuscole, numeri e un simbolo.";
