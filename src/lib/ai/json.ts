/**
 * JSON from a model, read the way a person would read it.
 *
 * Asked for JSON, a model now and then adds a character JSON does not allow: a
 * comma before a closing bracket, a // comment copied from the schema in the
 * prompt, or a line break typed straight into a string. JSON.parse rejects the
 * whole reply over that one character, and a discharge letter that was read
 * perfectly well shows the nurse "Couldn't read that letter" (24 Sep 2026,
 * gemini-2.5-flash: "Expected double-quoted property name in JSON at position
 * 739 (line 25 column 5)").
 */

/**
 * Parses a model's JSON. The reply is parsed as it is first; only when that
 * fails is it parsed again with comments, trailing commas and raw line breaks
 * in strings repaired. Anything else still throws JSON.parse's own error.
 */
export function parseModelJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch (err) {
    const repaired = repairModelJson(json)
    if (repaired === json) throw err
    try {
      return JSON.parse(repaired)
    } catch {
      throw err
    }
  }
}

const RAW_IN_STRING: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/** Index of the next character after i that is not white space or part of a comment. */
function nextSignificant(json: string, i: number): number {
  while (i < json.length) {
    if (/\s/.test(json[i])) i++
    else if (json.startsWith('//', i)) i = lineEnd(json, i)
    else if (json.startsWith('/*', i)) i = blockEnd(json, i)
    else break
  }
  return i
}

const lineEnd = (json: string, i: number) => {
  const nl = json.indexOf('\n', i)
  return nl === -1 ? json.length : nl
}

const blockEnd = (json: string, i: number) => {
  const end = json.indexOf('*/', i + 2)
  return end === -1 ? json.length : end + 2
}

/**
 * Drops // and block comments and any comma that only closes a list or an
 * object, and escapes line breaks and tabs inside strings. What is inside a
 * string is otherwise kept as it is: "https://…" and ", }" in a value are
 * content, not syntax.
 */
export function repairModelJson(json: string): string {
  let out = ''
  let i = 0
  while (i < json.length) {
    const c = json[i]
    if (c === '"') {
      // Copy the string up to its closing quote, escapes and all.
      out += c
      i++
      while (i < json.length && json[i] !== '"') {
        if (json[i] === '\\') {
          out += json.slice(i, i + 2)
          i += 2
        } else {
          out += RAW_IN_STRING[json[i]] ?? json[i]
          i++
        }
      }
      if (i < json.length) out += json[i++]
    } else if (json.startsWith('//', i)) {
      i = lineEnd(json, i)
    } else if (json.startsWith('/*', i)) {
      i = blockEnd(json, i)
    } else {
      const next = c === ',' ? json[nextSignificant(json, i + 1)] : undefined
      if (next !== '}' && next !== ']') out += c
      i++
    }
  }
  return out
}
