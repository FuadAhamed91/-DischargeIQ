/**
 * Table-driven checks for lib/ai/json.ts — a model's JSON reply that is
 * nearly right still parses:
 *   - a comma before } or ], a // or block comment, a line break or tab typed
 *     into a string are repaired
 *   - text inside strings is never changed ("https://…", ", }", \")
 *   - anything else still throws JSON.parse's own error
 *
 * No network or API keys needed. Run with:  npm run check:model-json
 */
import { parseModelJson } from '@/lib/ai/json'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}
/** The error a reply throws, or "parsed". */
const error = (text: string) => {
  try {
    parseModelJson(text)
    return 'parsed'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
const nativeError = (text: string) => {
  try {
    JSON.parse(text)
    return 'parsed'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

console.log('— valid JSON parses as before —')
eq('object', parseModelJson('{"a": 1, "b": [1, 2], "c": null}'), { a: 1, b: [1, 2], c: null })
eq('array', parseModelJson('[{"x": "y"}]'), [{ x: 'y' }])

console.log('— nearly right, repaired —')
eq('comma before }', parseModelJson('{\n  "a": 1,\n  "b": 2,\n}'), { a: 1, b: 2 })
eq('comma before ]', parseModelJson('{"times": ["08:00", "20:00", ]}'), { times: ['08:00', '20:00'] })
eq(
  'comma closing a medicine, 4 spaces in (the line 25 column 5 reply)',
  parseModelJson('{\n  "medications": [\n    {\n      "name": "Aspirin",\n      "reminder_times": ["08:00"],\n    },\n  ],\n}'),
  { medications: [{ name: 'Aspirin', reminder_times: ['08:00'] }] },
)
eq('// comment copied from the schema', parseModelJson('{\n  "mrn": "MRN-4471", // hospital number\n  "ward": "5B"\n}'), { mrn: 'MRN-4471', ward: '5B' })
eq('comment between a comma and }', parseModelJson('{"a": 1, // the last one\n}'), { a: 1 })
eq('block comment', parseModelJson('{"a": /* dose */ 1, "b": 2 /* done */}'), { a: 1, b: 2 })
eq('line break typed into a string', parseModelJson('{"instructions": "Take with food\nat night"}'), { instructions: 'Take with food\nat night' })
eq('tab and CRLF typed into a string', parseModelJson('{"note": "a\tb\r\nc"}'), { note: 'a\tb\r\nc' })
eq('Arabic text with a trailing comma', parseModelJson('{"symptoms": ["ألم في الصدر", "ضيق في التنفس",]}'), { symptoms: ['ألم في الصدر', 'ضيق في التنفس'] })

console.log('— strings untouched —')
eq('// inside a string', parseModelJson('{"url": "https://example.com/a//b", "b": 1,}'), { url: 'https://example.com/a//b', b: 1 })
eq('", }" and ", ]" inside strings', parseModelJson('{"text": "a, }", "list": ["x, ]",],}'), { text: 'a, }', list: ['x, ]'] })
eq('escaped quotes around a comment-like text', parseModelJson('{"q": "he said \\"stop\\", // then left",}'), { q: 'he said "stop", // then left' })
eq('escaped backslash before the closing quote', parseModelJson('{"path": "C:\\\\", "n": 1,}'), { path: 'C:\\', n: 1 })

console.log('— still an error, with JSON.parse’s own message —')
const cutOff = '{"medications": [{"name": "Aspir'
eq('reply cut off mid-string', error(cutOff), nativeError(cutOff))
const doubled = '{"a": 1,, "b": 2}'
eq('two commas in a row', error(doubled), nativeError(doubled))
eq('not JSON at all', error('Sorry, I cannot help with that.'), nativeError('Sorry, I cannot help with that.'))

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
