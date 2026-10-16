/** Documentation contract for the classic-script runtime (no TypeScript build required). */
export type PageType = 'basic' | 'education' | 'internship' | 'work' | 'project' | 'family' | 'campus' | 'skills' | string;
export interface PageContext { host: string; path: string; search?: string; platform?: string; pageType?: PageType; }
export interface Field {
  key: string; id: string | number; label: string; section: string; row: number;
  type: string; raw: unknown; options?: unknown[]; required?: boolean; disabled?: boolean;
  platform?: string; host?: string; siteScope?: string; scope?: string; pageType?: PageType;
  /** Optional exact key from AF.scan.scan(); never use an ambiguous label as a DOM locator. */
  domKey?: string; validationError?: string;
  [key: string]: unknown;
}
export type Target = { sem: string; perRow?: boolean } | { list: string; prop: string; row?: number };
export interface Encoded { raw?: unknown; error?: string; skip?: string; pick?: string[]; additional?: {key: string; raw: unknown; value?: unknown}[]; }
export interface Adapter {
  moduleId: string; moduleVersion: string; name: string;
  parse(): Promise<Field[]>;
  mapField(field: Field): Target | null;
  resolveValue(target: Target, facts: unknown, row: number): unknown;
  convertValue(field: Field, value: unknown, context: unknown): Encoded;
  execute(batch: {key: string; raw: unknown}[]): Promise<{key: string; ok: boolean; error?: string}[]>;
  verify(field: Field, expected: unknown): boolean;
  learning(): unknown;
  diagnostics(items: unknown[]): void;
}
export interface ScopedMemory {
  id: string; legacyId: string; scopeVersion: 2; scopeLevel: 'site' | 'platform';
  platform: string; host: string; siteScope: string; pageType: PageType;
  confirmedShared?: boolean; ident: string; map?: string; from?: unknown; to: unknown;
  label: string; section: string; row?: number; updatedAt: number;
}
export type FailureCode = 'FIELD_UNRECOGNIZED' | 'PROFILE_UNMATCHED' | 'PROFILE_MISSING' | 'AMBIGUOUS_MATCH' | 'FORMAT_INCOMPATIBLE' | 'CONTROL_UNSUPPORTED' | 'CONTROL_FAILED' | 'VALIDATION_FAILED' | 'REVIEW_REQUIRED';
