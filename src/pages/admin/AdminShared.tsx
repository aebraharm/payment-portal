import type { ReactNode } from 'react';
import { AdminLayout } from '../../components/shells';
import { useGate, type AdminSession } from '../../lib/session';
import { Alert, Button, Skeleton } from '../../components/ui';
import { errorMessage } from '../../lib/api';

export function AdminFrame({ children }: { children: ReactNode }) {
  const { session } = useGate<AdminSession>();
  return (
    <AdminLayout adminName={session.admin.displayName || session.admin.email} roleLabel={session.admin.roleLabel} permissions={session.permissions}>
      {children}
    </AdminLayout>
  );
}

export function useGateSession(): AdminSession {
  return useGate<AdminSession>().session;
}

export function can(session: AdminSession, permission: string): boolean {
  return session.permissions.includes(permission);
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function LoadProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert tone="danger" title="We could not load this page.">
      <p>{errorMessage(error)}</p>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </Alert>
  );
}

export function moneyOrDash(value: string | null | undefined, formatted?: string | null): string {
  return formatted ?? value ?? '—';
}
