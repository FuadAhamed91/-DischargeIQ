/**
 * Standard API response envelope used by all /api/v1/* routes.
 */

export interface ApiResponse<T = unknown> {
  data: T | null
  error: string | null
  message?: string
  meta?: ApiMeta
}

export interface ApiMeta {
  page?: number
  limit?: number
  total?: number
  has_more?: boolean
}

export function apiSuccess<T>(data: T, meta?: ApiMeta): ApiResponse<T> {
  return { data, error: null, meta }
}

export function apiError(error: string, message?: string): ApiResponse<null> {
  return { data: null, error, message }
}

// ------------------------------------
// Common query param types
// ------------------------------------

export interface PaginationParams {
  page?: number
  limit?: number
}

export interface EpisodeFilters extends PaginationParams {
  status?: string
  risk_level?: string
  nurse_id?: string
  search?: string
}

export interface AlertFilters extends PaginationParams {
  status?: string
  type?: string
  severity?: string
}
