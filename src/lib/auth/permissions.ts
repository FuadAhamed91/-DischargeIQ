import type { UserRole } from '@/types/enums'

const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  hospital_admin: 80,
  discharge_coordinator: 60,
  case_manager: 50,
  nurse: 40,
  read_only: 10,
}

export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

export function canManageHospital(role: UserRole): boolean {
  return hasMinimumRole(role, 'hospital_admin')
}

export function canManageStaff(role: UserRole): boolean {
  return hasMinimumRole(role, 'hospital_admin')
}

export function canViewAllPatients(role: UserRole): boolean {
  return role !== 'nurse'
}

export function canUploadDischarge(role: UserRole): boolean {
  return hasMinimumRole(role, 'nurse') && role !== 'case_manager' && role !== 'read_only'
}

export function canApproveDischarge(role: UserRole): boolean {
  return canUploadDischarge(role)
}

export function canSendToPatient(role: UserRole): boolean {
  return canUploadDischarge(role)
}

export function canAcknowledgeAlerts(role: UserRole): boolean {
  return hasMinimumRole(role, 'nurse') && role !== 'read_only'
}

export function canViewAnalytics(role: UserRole): boolean {
  return role !== 'nurse'
}

export function canExportData(role: UserRole): boolean {
  return hasMinimumRole(role, 'hospital_admin')
}

export function canAccessAuditLogs(role: UserRole): boolean {
  return hasMinimumRole(role, 'hospital_admin')
}

/**
 * Throws a 403 response if the user does not have the required role.
 * Use inside API route handlers.
 */
export function assertRole(userRole: UserRole, required: UserRole): void {
  if (!hasMinimumRole(userRole, required)) {
    throw new Response(
      JSON.stringify({ error: 'Forbidden', message: 'Insufficient permissions' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
