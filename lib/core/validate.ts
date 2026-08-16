import { ApiError, validationFailed, type FieldError } from './errors';

/**
 * 依存を増やしたくないので最小限のバリデータを自前で持つ。
 * 目的は「外部連携先に、どのフィールドがなぜ弾かれたかを返す」こと。
 */

export class Validator {
  private readonly errors: FieldError[] = [];

  constructor(private readonly input: Record<string, unknown>) {}

  private fail(field: string, message: string) {
    this.errors.push({ field, message });
  }

  string(field: string, opts: { required?: boolean; max?: number; min?: number } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (opts.required) this.fail(field, '必須項目です');
      return undefined;
    }
    if (typeof value !== 'string') {
      this.fail(field, '文字列で指定してください');
      return undefined;
    }
    if (opts.max !== undefined && value.length > opts.max) {
      this.fail(field, `${opts.max}文字以内で指定してください`);
      return undefined;
    }
    if (opts.min !== undefined && value.length < opts.min) {
      this.fail(field, `${opts.min}文字以上で指定してください`);
      return undefined;
    }
    return value;
  }

  enum<T extends string>(field: string, allowed: readonly T[], opts: { required?: boolean } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (opts.required) this.fail(field, '必須項目です');
      return undefined;
    }
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(field, `${allowed.join(' / ')} のいずれかを指定してください`);
      return undefined;
    }
    return value as T;
  }

  /** ISO 8601 の日時。正規化した ISO 文字列を返す。 */
  dateTime(field: string, opts: { required?: boolean } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (opts.required) this.fail(field, '必須項目です');
      return undefined;
    }
    if (typeof value !== 'string') {
      this.fail(field, 'ISO 8601 形式の日時で指定してください');
      return undefined;
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      this.fail(field, 'ISO 8601 形式の日時で指定してください');
      return undefined;
    }
    return new Date(ms).toISOString();
  }

  integer(field: string, opts: { required?: boolean; min?: number; max?: number } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (opts.required) this.fail(field, '必須項目です');
      return undefined;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(num)) {
      this.fail(field, '整数で指定してください');
      return undefined;
    }
    if (opts.min !== undefined && num < opts.min) {
      this.fail(field, `${opts.min} 以上で指定してください`);
      return undefined;
    }
    if (opts.max !== undefined && num > opts.max) {
      this.fail(field, `${opts.max} 以下で指定してください`);
      return undefined;
    }
    return num;
  }

  boolean(field: string, opts: { required?: boolean } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null) {
      if (opts.required) this.fail(field, '必須項目です');
      return undefined;
    }
    if (typeof value !== 'boolean') {
      this.fail(field, 'true / false で指定してください');
      return undefined;
    }
    return value;
  }

  stringArray(field: string, opts: { required?: boolean } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null) {
      if (opts.required) this.fail(field, '必須項目です');
      return undefined;
    }
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      this.fail(field, '文字列の配列で指定してください');
      return undefined;
    }
    return value as string[];
  }

  /** 4桁のアクセス番号。 */
  accessNumber(field: string, opts: { required?: boolean } = {}) {
    const value = this.string(field, opts);
    if (value === undefined) return undefined;
    if (!/^\d{4}$/.test(value)) {
      this.fail(field, '4桁の数字で指定してください');
      return undefined;
    }
    return value;
  }

  custom(field: string, message: string) {
    this.fail(field, message);
  }

  /** 1件でもエラーがあれば 422 を投げる。 */
  throwIfInvalid(): void {
    if (this.errors.length > 0) throw validationFailed(this.errors);
  }
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw validationFailed([{ field: '_body', message: 'JSONオブジェクトを指定してください' }]);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw validationFailed([{ field: '_body', message: 'JSONとして解釈できません' }]);
  }
}
