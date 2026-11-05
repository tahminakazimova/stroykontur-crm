# Real Supabase API verification

Executed: 2026-11-05T18:29:24.472Z

Project: susuopetvkuliqxixnnx

All 16 checks passed using only the public key and regular user sessions. No admin key was used by these tests. Isolated fixture objects were removed afterwards.

- ✅ Email/password login succeeds for manager and both executors
- ✅ Invalid password is rejected
- ✅ Public signup is disabled in settings and by signup endpoint
- ✅ Anonymous cannot read CRM data
- ✅ Seeded manager sees three objects, six tasks and three profiles
- ✅ Executor sees only assigned tasks and related objects
- ✅ Foreign task and history cannot be read or changed
- ✅ Executor cannot edit details, reassign, create tasks, delete tasks or elevate role
- ✅ History INSERT/UPDATE/DELETE is forbidden for both roles
- ✅ Forbidden transitions are blocked even through direct REST updates
- ✅ Concurrent transition requests allow exactly one expected-status update
- ✅ Revision requires a nonblank comment in both REST and RPC
- ✅ Revision cycle, review and manager acceptance work end to end
- ✅ Server writes seven genuine history events with correct authors and comment
- ✅ Author and creation timestamp cannot be forged
- ✅ Reassignment immediately removes old executor access to task, object and history
