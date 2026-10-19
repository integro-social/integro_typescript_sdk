export type Preprocess = "trim" | "lowercase" | "uppercase";

export type Constraint =
  | { kind: "minLen"; min: number }
  | { kind: "maxLen"; max: number }
  | { kind: "exactLen"; len: number }
  | { kind: "minBytes"; min: number }
  | { kind: "maxBytes"; max: number }
  | { kind: "minDigits"; min: number }
  | { kind: "maxDigits"; max: number }
  | { kind: "noControlChars" }
  | { kind: "asciiDigitsOnly" }
  | { kind: "regex"; source: string; hint: string | null }
  | { kind: "requireUppercase" }
  | { kind: "requireLowercase" }
  | { kind: "requireDigit" }
  | { kind: "requireSymbol" }
  | { kind: "min"; value: number }
  | { kind: "max"; value: number };

export type Violation =
  | { kind: "tooShort"; min: number }
  | { kind: "tooLong"; max: number }
  | { kind: "exactLength"; expected: number; actual: number }
  | { kind: "tooFewBytes"; min: number }
  | { kind: "tooManyBytes"; max: number }
  | { kind: "tooFewDigits"; min: number }
  | { kind: "tooManyDigits"; max: number }
  | { kind: "tooFewItems"; min: number }
  | { kind: "tooManyItems"; max: number }
  | { kind: "invalidFormat"; hint: string | null }
  | { kind: "invalidChars" }
  | { kind: "invalidCharAt"; position: number; character: string }
  | { kind: "notDigits" }
  | { kind: "notANumber" }
  | { kind: "notABoolean" }
  | { kind: "tooSmall"; min: number }
  | { kind: "tooLarge"; max: number }
  | { kind: "missingUppercase" }
  | { kind: "missingLowercase" }
  | { kind: "missingDigit" }
  | { kind: "missingSymbol" };

export interface ValidationSpec {
  preprocess: Preprocess[];
  constraints: Constraint[];
}

export type Value = string | number | number;

function numeric(value: Value): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "number") return Number(value);
  return null;
}

function charLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    n++;
  }
  return n;
}

function byteLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function digitCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const REGEX_CACHE = new Map<string, RegExp>();
function regexFor(source: string): RegExp {
  let re = REGEX_CACHE.get(source);
  if (re === undefined) {
    re = new RegExp(source);
    REGEX_CACHE.set(source, re);
  }
  return re;
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function asciiUpper(s: string): string {
  return s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

function normalizeOne(step: Preprocess, value: string): string {
  switch (step) {
    case "trim":
      return value.trim();
    case "lowercase":
      return asciiLower(value);
    case "uppercase":
      return asciiUpper(value);
  }
}

export function normalize(spec: ValidationSpec, value: string): string {
  return spec.preprocess.reduce((current, step) => normalizeOne(step, current), value);
}

function checkOne(c: Constraint, value: Value): Violation | null {
  const s = typeof value === "string" ? value : "";
  switch (c.kind) {
    case "minLen":
      return charLen(s) < c.min ? { kind: "tooShort", min: c.min } : null;
    case "maxLen":
      return charLen(s) > c.max ? { kind: "tooLong", max: c.max } : null;
    case "exactLen": {
      const actual = charLen(s);
      return actual !== c.len ? { kind: "exactLength", expected: c.len, actual } : null;
    }
    case "minBytes":
      return byteLen(s) < c.min ? { kind: "tooFewBytes", min: c.min } : null;
    case "maxBytes":
      return byteLen(s) > c.max ? { kind: "tooManyBytes", max: c.max } : null;
    case "minDigits":
      return digitCount(s) < c.min ? { kind: "tooFewDigits", min: c.min } : null;
    case "maxDigits":
      return digitCount(s) > c.max ? { kind: "tooManyDigits", max: c.max } : null;
    case "noControlChars":
      return CONTROL_CHARS.test(s) ? { kind: "invalidChars" } : null;
    case "asciiDigitsOnly":
      return !/^[0-9]*$/.test(s) ? { kind: "notDigits" } : null;
    case "regex":
      return !regexFor(c.source).test(s) ? { kind: "invalidFormat", hint: c.hint } : null;
    case "requireUppercase":
      return !/\p{Lu}/u.test(s) ? { kind: "missingUppercase" } : null;
    case "requireLowercase":
      return !/\p{Ll}/u.test(s) ? { kind: "missingLowercase" } : null;
    case "requireDigit":
      return !/[0-9]/.test(s) ? { kind: "missingDigit" } : null;
    case "requireSymbol":
      return !/[^\p{L}\p{N}]/u.test(s) ? { kind: "missingSymbol" } : null;
    case "min": {
      const n = numeric(value);
      return n !== null && n < c.value ? { kind: "tooSmall", min: c.value } : null;
    }
    case "max": {
      const n = numeric(value);
      return n !== null && n > c.value ? { kind: "tooLarge", max: c.value } : null;
    }
  }
}

export function check(spec: ValidationSpec, value: Value): Violation | null {
  const v = typeof value === "string" ? normalize(spec, value) : value;
  for (const c of spec.constraints) {
    const viol = checkOne(c, v);
    if (viol) return viol;
  }
  return null;
}

export function checkAll(spec: ValidationSpec, value: Value): Violation[] {
  const v = typeof value === "string" ? normalize(spec, value) : value;
  const out: Violation[] = [];
  for (const c of spec.constraints) {
    const viol = checkOne(c, v);
    if (viol) out.push(viol);
  }
  return out;
}

export function message(v: Violation): string {
  switch (v.kind) {
    case "tooShort":
      return `muito curto (mínimo ${v.min} caracteres)`;
    case "tooLong":
      return `muito longo (máximo ${v.max} caracteres)`;
    case "exactLength":
      return `tamanho inválido (esperado ${v.expected}, recebido ${v.actual})`;
    case "tooFewBytes":
      return `muito curto (mínimo ${v.min} bytes)`;
    case "tooManyBytes":
      return `muito longo (máximo ${v.max} bytes)`;
    case "tooFewDigits":
      return `muito curto (mínimo ${v.min} dígitos)`;
    case "tooManyDigits":
      return `muito longo (máximo ${v.max} dígitos)`;
    case "tooFewItems":
      return `poucos itens (mínimo ${v.min})`;
    case "tooManyItems":
      return `muitos itens (máximo ${v.max})`;
    case "invalidFormat":
      return v.hint ? `formato inválido (${v.hint})` : "formato inválido";
    case "invalidChars":
      return "caracteres inválidos";
    case "invalidCharAt":
      return `caractere inválido na posição ${v.position} ('${v.character}')`;
    case "notDigits":
      return "deve conter apenas dígitos";
    case "notANumber":
      return "deve ser um número";
    case "notABoolean":
      return "deve ser verdadeiro ou falso";
    case "tooSmall":
      return `muito pequeno (mínimo ${v.min})`;
    case "tooLarge":
      return `muito grande (máximo ${v.max})`;
    case "missingUppercase":
      return "deve conter uma letra maiúscula";
    case "missingLowercase":
      return "deve conter uma letra minúscula";
    case "missingDigit":
      return "deve conter um dígito";
    case "missingSymbol":
      return "deve conter um símbolo";
  }
}
