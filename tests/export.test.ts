import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toCsv, UTF8_BOM, type Column } from '@/lib/export/csv';
import { columnName, toXlsx } from '@/lib/export/xlsx';
import { createZip, crc32 } from '@/lib/export/zip';

type Row = { name: string; count: number; note: string | null };

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: '氏名', value: (r) => r.name },
  { key: 'count', header: '来店回数', value: (r) => r.count },
  { key: 'note', header: '備考', value: (r) => r.note },
];

describe('CSV', () => {
  it('UTF-8 BOM で始まり CRLF で改行する', () => {
    const csv = toCsv([{ name: '田中', count: 3, note: null }], COLUMNS);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(UTF8_BOM).toBe('﻿');
    expect(csv).toContain('\r\n');
    expect(csv.slice(1).split('\r\n')[0]).toBe('氏名,来店回数,備考');
  });

  it('null は空欄になる', () => {
    const csv = toCsv([{ name: '田中', count: 0, note: null }], COLUMNS);
    expect(csv.slice(1).split('\r\n')[1]).toBe('田中,0,');
  });

  it('カンマ・改行・引用符を含む値をエスケープする', () => {
    const csv = toCsv(
      [{ name: '田中, 太郎', count: 1, note: '改行\nあり "引用" 付き' }],
      COLUMNS
    );
    expect(csv).toContain('"田中, 太郎"');
    expect(csv).toContain('""引用""');
  });

  it('数式として解釈される値を無害化する', () => {
    // CSVインジェクション対策。Excel で開いた瞬間に式が走らないようにする
    const csv = toCsv([{ name: '=1+1', count: 1, note: '@SUM(A1)' }], COLUMNS);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1)");
  });
});

describe('ZIP', () => {
  it('CRC32 が既知の値と一致する', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('格納したファイルを取り出せる', () => {
    const content = Buffer.from('hello reception', 'utf8');
    const zip = createZip([{ name: 'a.txt', data: content }]);

    // local file header を読んで deflate を展開する
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLength = zip.readUInt16LE(26);
    const extraLength = zip.readUInt16LE(28);
    const compressedSize = zip.readUInt32LE(18);
    const start = 30 + nameLength + extraLength;
    const compressed = zip.subarray(start, start + compressedSize);

    expect(inflateRawSync(compressed).toString('utf8')).toBe('hello reception');
    expect(zip.toString('utf8', 30, 30 + nameLength)).toBe('a.txt');
  });
});

describe('xlsx', () => {
  it('列番号を A, B, ... AA へ変換する', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
  });

  it('zip として妥当な xlsx を生成する', () => {
    const buffer = toXlsx([{ name: '田中', count: 3, note: null }], COLUMNS, {
      sheetName: '顧客',
    });
    // PK シグネチャで始まり、EOCD で終わる
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);
    expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50);
    // 必要なパートが全て入っている
    const asText = buffer.toString('latin1');
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/styles.xml',
    ]) {
      expect(asText).toContain(part);
    }
  });

  it('数値は数値セル、文字列は inlineStr で書く', () => {
    const buffer = toXlsx([{ name: '田中', count: 3, note: null }], COLUMNS);
    const sheet = extractEntry(buffer, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<v>3</v>');
    expect(sheet).toContain('t="inlineStr"');
    // null セルは空タグ
    expect(sheet).toContain('<c r="C2"/>');
  });

  it('XML 特殊文字をエスケープする', () => {
    const buffer = toXlsx([{ name: '<田中> & "太郎"', count: 1, note: null }], COLUMNS);
    const sheet = extractEntry(buffer, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('&lt;田中&gt; &amp; &quot;太郎&quot;');
  });
});

/** テスト用の簡易 zip 読み出し。local file header を順に辿る。 */
function extractEntry(zip: Buffer, name: string): string {
  let offset = 0;
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const entryName = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    if (entryName === name) {
      return inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize)).toString('utf8');
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`entry not found: ${name}`);
}
