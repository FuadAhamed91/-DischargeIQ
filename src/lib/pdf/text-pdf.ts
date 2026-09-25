/**
 * A small writer for text-only PDF letters: A4 pages, the built-in Helvetica
 * fonts, wrapped paragraphs, hanging indents for list items and hairline
 * rules. Enough to print the sample discharge letters with today's dates
 * (lib/intake/sample-letters.ts) without a PDF dependency; not a general PDF
 * library. Text is written in WinAnsi: characters outside it become "?".
 */

export type PdfFont = 'regular' | 'bold' | 'italic'

export type PdfBlock =
  | {
      kind: 'text'
      text: string
      font?: PdfFont
      /** Points (default 10). */
      size?: number
      align?: 'left' | 'center'
      /** Extra space above the block, in points. */
      spaceBefore?: number
      /** Where lines after the first start, relative to the margin: hangs a list item under its marker. */
      hangingIndent?: number
      /** Grey instead of black. */
      muted?: boolean
    }
  | { kind: 'rule'; spaceBefore?: number; spaceAfter?: number }

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 50
const MARGIN_TOP = 56
const MARGIN_BOTTOM = 56
const LINE_HEIGHT = 1.45

/** Adobe's core-font widths (1/1000 em) for ASCII 32..126; Helvetica-Oblique shares Helvetica's. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

const FONT_KEY: Record<PdfFont, string> = { regular: 'F1', bold: 'F2', italic: 'F3' }

/** Typographic punctuation the letters may use, mapped to its WinAnsi byte. */
const WIN_ANSI: Record<string, number> = {
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
}

/** One character as a WinAnsi byte (Latin-1 maps to itself). */
function byteOf(ch: string): number {
  const code = ch.charCodeAt(0)
  if (code >= 32 && code <= 126) return code
  if (code >= 0xa0 && code <= 0xff) return code
  return WIN_ANSI[ch] ?? 63 // "?"
}

function charWidth(byte: number, font: PdfFont): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA
  return byte >= 32 && byte <= 126 ? table[byte - 32] : 556
}

function textWidth(text: string, font: PdfFont, size: number): number {
  let units = 0
  for (const ch of text) units += charWidth(byteOf(ch), font)
  return (units * size) / 1000
}

/** Breaks text into lines no wider than `width` points, at spaces (a word longer than a line is split). */
export function wrapText(text: string, font: PdfFont, size: number, width: number, laterWidth = width): string[] {
  const lines: string[] = []
  let line = ''
  const limit = () => (lines.length === 0 ? width : laterWidth)
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (textWidth(candidate, font, size) <= limit()) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word
    while (textWidth(line, font, size) > limit()) {
      let cut = line.length - 1
      while (cut > 1 && textWidth(line.slice(0, cut), font, size) > limit()) cut--
      lines.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** A PDF string literal: WinAnsi bytes, with the delimiters escaped. */
function pdfString(text: string): string {
  let out = '('
  for (const ch of text) {
    const byte = byteOf(ch)
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\'
    out += String.fromCharCode(byte)
  }
  return out + ')'
}

const num = (n: number) => (Math.round(n * 100) / 100).toString()

/** Lays the blocks out on A4 pages and returns the PDF file. */
export function renderTextPdf(blocks: PdfBlock[], meta: { title: string; author?: string }): Uint8Array {
  const usable = PAGE_WIDTH - 2 * MARGIN_X
  const pages: string[][] = [[]]
  let y = PAGE_HEIGHT - MARGIN_TOP
  const page = () => pages[pages.length - 1]
  const newPage = () => { pages.push([]); y = PAGE_HEIGHT - MARGIN_TOP }

  for (const block of blocks) {
    if (block.kind === 'rule') {
      y -= block.spaceBefore ?? 6
      if (y < MARGIN_BOTTOM) newPage()
      page().push(`0.8 0.82 0.86 RG 0.6 w ${num(MARGIN_X)} ${num(y)} m ${num(PAGE_WIDTH - MARGIN_X)} ${num(y)} l S`)
      y -= block.spaceAfter ?? 10
      continue
    }
    const font = block.font ?? 'regular'
    const size = block.size ?? 10
    const leading = size * LINE_HEIGHT
    const hang = block.hangingIndent ?? 0
    const lines = wrapText(block.text, font, size, usable, usable - hang)
    y -= block.spaceBefore ?? 0
    lines.forEach((line, i) => {
      if (y - size < MARGIN_BOTTOM) newPage()
      y -= size
      const x = block.align === 'center'
        ? (PAGE_WIDTH - textWidth(line, font, size)) / 2
        : MARGIN_X + (i > 0 ? hang : 0)
      const colour = block.muted ? '0.42 0.45 0.5 rg' : '0.1 0.12 0.16 rg'
      page().push(`BT ${colour} /${FONT_KEY[font]} ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfString(line)} Tj ET`)
      y -= leading - size
    })
  }

  // Objects: 1 catalog, 2 page tree, 3-5 fonts, 6 info, then a page and its content per page.
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 7 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'
  objects[6] = `<< /Title ${pdfString(meta.title)}${meta.author ? ` /Author ${pdfString(meta.author)}` : ''} /Producer (CareLoop) >>`
  pages.forEach((ops, i) => {
    const content = ops.join('\n')
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`
    objects[pageIds[i] + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })

  // Every character is one byte (WinAnsi), so string lengths are byte offsets.
  let out = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i)
  return bytes
}
