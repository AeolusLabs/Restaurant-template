import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { listStaff } from "@/auth/staff";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { valuesFrom } from "@/lib/notice-url";
import { createStaffAction, changeRoleAction, sendResetAction, setBlockedAction } from "./actions";

export const metadata: Metadata = { title: "Staff" };

const ROLES = [
  { value: "kitchen", label: "Kitchen" },
  { value: "manager", label: "Manager" },
  { value: "owner", label: "Owner" },
];
const mini = "min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2";

async function Staff({ searchParams }: { searchParams: PageProps<"/admin/staff">["searchParams"] }) {
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/staff");
  const staff = await listStaff(ctx);
  const isOwner = ctx.role === "owner";
  const v = valuesFrom(params);

  return (
    <div className="space-y-8">
      <Notice notice={params.notice} error={params.error} />
      {!isOwner && <p className="text-muted">Only owners can add staff or change their access.</p>}

      <ul className="space-y-3">
        {staff.map((s) => {
          const self = s.id === ctx.userId;
          return (
            <li key={s.id} className={`${card} space-y-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {s.name} {self && <span className="font-normal text-muted">(you)</span>}
                  </p>
                  <p className="text-sm text-muted">{s.email}</p>
                </div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="rounded-full border border-line-strong px-3 py-0.5 capitalize">{s.role}</span>
                  {s.blocked && <span className="rounded-full border border-bad bg-bad-soft px-3 py-0.5 text-bad">&#10005; Blocked</span>}
                </p>
              </div>
              {isOwner && !self && (
                <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
                  <form action={changeRoleAction} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <div>
                      <label htmlFor={`role-${s.id}`} className="mb-1 block text-sm font-semibold">
                        Role
                      </label>
                      <select id={`role-${s.id}`} name="role" defaultValue={s.role} className={mini}>
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className={button.secondary}>
                      Change role
                    </button>
                  </form>
                  <form action={setBlockedAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="blocked" value={String(!s.blocked)} />
                    <button type="submit" className={s.blocked ? button.secondary : button.danger}>
                      {s.blocked ? "Unblock" : "Block"}
                    </button>
                  </form>
                  <form action={sendResetAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className={button.quiet}>
                      Email a password reset
                    </button>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner && (
        <form action={createStaffAction} className={`${card} max-w-xl space-y-4 p-5`} aria-labelledby="add-h">
          <h2 id="add-h" className="text-lg font-bold">
            Add a staff member
          </h2>
          <div>
            <label htmlFor="s-name" className={label}>
              Name
            </label>
            <input id="s-name" name="name" defaultValue={v.name} required maxLength={200} className={field} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="s-email" className={label}>
              Email
            </label>
            <input id="s-email" name="email" type="email" defaultValue={v.email} required className={field} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="s-role" className={label}>
              Role
            </label>
            <select id="s-role" name="role" defaultValue={v.role ?? "kitchen"} className={field}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="s-pass" className={label}>
              Temporary password
            </label>
            <input id="s-pass" name="temporaryPassword" type="password" required minLength={8} className={field} autoComplete="new-password" aria-describedby="s-pass-help" />
            <p id="s-pass-help" className="mt-1 text-sm text-muted">
              At least 8 characters. Give it to them in person; they can choose their own with the reset link.
            </p>
          </div>
          <button type="submit" className={button.primary}>
            Add staff member
          </button>
        </form>
      )}
    </div>
  );
}

export default function StaffPage(props: PageProps<"/admin/staff">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Staff</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading staff" />}>
        <Staff searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
