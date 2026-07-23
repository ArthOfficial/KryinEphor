// Pure helpers for delete_user. Kept dependency-free so unit tests can
// import without a Supabase client or Deno network access.

export const PROTECTED_EMAILS = new Set([
    "admin@admin.com",
    "superadmin@edunex.com",
]);

export type ProfileLike = {
    id: string;
    role: string | null;
    school_id: string | null;
    email?: string | null;
    full_name?: string | null;
};

export type DeleteDecision =
    | { allowed: true }
    | { allowed: false; reason: string; status: 400 | 403 };

export function slugify(s: string): string {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalize(s: string): string {
    return (s || "").trim().toLowerCase();
}

export function expectedConfirmText(
    schoolName: string | null,
    fullName: string | null,
): string {
    const schoolSlug = schoolName ? slugify(schoolName) : "platform";
    return `${schoolSlug}/${normalize(fullName || "")}`;
}

/**
 * Decide whether `caller` may permanently delete `target`.
 *
 * Rules:
 *  - Self-deletion is always blocked.
 *  - Protected root accounts (PROTECTED_EMAILS) are never deletable.
 *  - Superadmins may delete any non-protected, non-self user.
 *  - Admins may delete users only in their own school and never a superadmin.
 *  - Any other role is denied.
 */
export function evaluateDeletePermission(
    caller: ProfileLike,
    target: ProfileLike,
): DeleteDecision {
    if (!caller?.id || !target?.id) {
        return { allowed: false, reason: "Missing caller or target.", status: 400 };
    }
    if (caller.id === target.id) {
        return { allowed: false, reason: "You cannot delete your own account.", status: 400 };
    }
    if (PROTECTED_EMAILS.has((target.email || "").toLowerCase())) {
        return { allowed: false, reason: "This account is protected and cannot be deleted.", status: 403 };
    }
    if (caller.role === "superadmin") {
        return { allowed: true };
    }
    if (caller.role === "admin") {
        if (!caller.school_id || caller.school_id !== target.school_id) {
            return {
                allowed: false,
                reason: "Forbidden: admins may only delete users in their own school.",
                status: 403,
            };
        }
        if (target.role === "superadmin") {
            return { allowed: false, reason: "Forbidden: cannot delete a superadmin.", status: 403 };
        }
        return { allowed: true };
    }
    return { allowed: false, reason: "Forbidden: admin access required.", status: 403 };
}
