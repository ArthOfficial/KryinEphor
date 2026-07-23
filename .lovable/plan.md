# Performance, UX, and security pass

Four workstreams, done in order so later steps build on earlier ones. Each ships as one commit-sized change.

## 1. React Query caching + dedup

Goal: stop firing the same query on every render/mount.

- Confirm `QueryClientProvider` wraps the app in `src/App.tsx` (add if missing) with sane defaults: `staleTime: 30_000`, `gcTime: 5 * 60_000`, `refetchOnWindowFocus: false`.
- Introduce `src/hooks/queries/` with typed hooks for the hot data sources, each with a stable `queryKey`:
  - `useSchoolsSummary()` → `school_summary_metrics`
  - `useProfilesByRole(role, schoolId)`
  - `useAdminDashboardStats()` → `rpc('fn_admin_dashboard_stats')`
  - `useSuperAdminMetrics()` → `dashboard_metrics`
  - `useNotifications(userId)` (+ Realtime `invalidateQueries` in the bell)
  - `useInvoices(schoolId, filters)`
  - `useTransactions(schoolId, filters)`
- Refactor `SuperAdminDatabase`, `Dashboard`, `UserManagement`, `SchoolFinance`, `NotificationsBell` to consume these hooks. Delete their local `useState` + `useEffect` fetchers.
- Mutations (create/update/delete school, mark paid, etc.) call `queryClient.invalidateQueries` on the right keys instead of manual `fetchX()` calls.

## 2. Empty, loading, and error states

Goal: no dashboard section renders blank or with stale placeholders.

- Add reusable primitives in `src/components/ui/`:
  - `<SectionSkeleton rows={n} />` — shadcn Skeleton grid
  - `<EmptyState icon title description action />`
  - `<QueryBoundary query={...}>{data => ...}</QueryBoundary>` — handles isLoading/isError/empty in one place
- Apply to: dashboard cards, schools list, users list, invoices list, transactions list, notifications dropdown, class detail drawer, top payers widget.
- Error path shows the actual message + a Retry button (calls `refetch`).

## 3. Pagination on big tables

Goal: never fetch more than one page at a time from the DB.

- Add server-side pagination (`.range(from, to)` + `count: 'exact'`) via a shared `usePaginatedQuery` helper for:
  - Schools list (page size 25)
  - Users list (page size 50)
  - Invoices/Transactions (page size 50)
  - System logs (page size 100, if the page is used)
- Search inputs debounce 300 ms and reset to page 1.
- Table footer shows `Page X of Y — Total N` and Prev/Next buttons using shadcn `Pagination`.

## 4. Security scan + fixes

Goal: no new critical findings from the recent changes.

- Run the full security scanner.
- Address any NEW critical/high findings introduced by this session (the existing accepted lints in `mem://security/baseline` stay accepted).
- Update the security memory only if the acceptance list actually changes.

## Technical notes

- No schema changes needed; last migration already added indexes.
- Keep client-side info logging silent (already done); warn/error still hit `system_logs`.
- All new hooks are typed against `src/integrations/supabase/types.ts` — do not edit that file.
- No changes to auth, RLS, or edge functions unless the security scan flags one.

## Out of scope

- Reworking the design system.
- Building a background job queue (Postgres has no worker here; would need a separate service).
- Rewriting existing edge functions.
