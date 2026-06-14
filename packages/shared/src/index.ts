export type Brand<TBase, TBrand extends string> = TBase & { readonly __brand: TBrand };

export type CompanyId = Brand<bigint, 'CompanyId'>;
export type UserId = Brand<bigint, 'UserId'>;
export type BranchId = Brand<bigint, 'BranchId'>;

export type IsoDateTime = Brand<string, 'IsoDateTime'>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const SHARED_PACKAGE_VERSION = '0.0.0';
