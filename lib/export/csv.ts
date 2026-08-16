/**
 * CSV 生成 (PRD 11-3)。
 *
 * UTF-8 BOM 付き / CRLF 改行。Excel で開いたときに文字化けしないことを
 * 何よりも優先する（帳票の受け手は多くの場合 Excel で開く）。
 */

export const UTF8_BOM = '\uFEFF';

export type Column<T> = {
  key: string;
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const value = String(raw);
  // 先頭が = + - @ のセルは Excel が数式として解釈する。
  // CSV インジェクション対策として、シングルクォートで無害化する。
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCell(c.header)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  }
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}
