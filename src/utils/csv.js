// Escapes a value for CSV and neutralises spreadsheet formula injection (=, +, -, @ at the start of a cell).
export function toCsv(rows, columns) {
  const escape = (value) => {
    let text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map((column) => escape(row[column])).join(','))
  return lines.join('\n')
}
