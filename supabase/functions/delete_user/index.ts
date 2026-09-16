// ════════════════════════════════════════════════════════════════════
// delete_user — privileged HARD delete of a user account
// ────────────────────────────────────────────────────────────────────
// Authorization:
//   - Caller must be authenticated.
//   - Caller must be superadmin OR an admin of the SAME school as the
//     target user (admins cannot delete users outside their school).
//   - Protected root accounts cannot be deleted.
//   - Caller cannot delete themselves.
//
// Server-side confirmation:
//   The client must submit a `confirmText` value matching
//     `<schoolSlug>/<fullName>` (case-insensitive, trimmed).
//   Where schoolSlug = lowercased school name stripped to [a-z0-9],
//   or "platform" if the user has no school assignment.
//   This stops accidental deletions even if the UI is bypassed.
//
// Effect: deletes from auth.users (profile row + related rows cascade
// through existing FKs); the action is irreversible.
// ════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
    evaluateDeletePermission,
    expectedConfirmText,
    normalize,
} from "./permissions.ts";

const getCorsHeaders = (req: Request) => {
    const origin = req.headers.get("Origin") ?? "";
    const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "")
        .split(",").map(v => v.trim()).filter(Boolean);
    const allowedOrigins = new Set(["https://kryinedu.lovable.app", ...configured]);
    const allowOrigin = allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com|sandbox\.lovable\.dev)$/i.test(origin)
        ? origin
        : "https://kryinedu.lovable.app";
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
};

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status,
        });

    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "Missing authorization header" }, 401);

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        if (!supabaseUrl || !anonKey || !serviceRoleKey)
            return json({ error: "Server misconfiguration" }, 500);

        const callerClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
        if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

        const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: callerProfile } = await admin
            .from("profiles").select("role, school_id").eq("id", caller.id).single();
        if (!callerProfile) return json({ error: "Caller profile not found" }, 403);

        let payload: { targetUserId?: string; confirmText?: string };
        try { payload = await req.json(); } catch { return json({ error: "Invalid JSON payload" }, 400); }

        const targetUserId = (payload.targetUserId || "").trim();
        const confirmText = normalize(payload.confirmText || "");
        if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
        if (!confirmText) return json({ error: "confirmText is required" }, 400);

        // Load target
        const { data: target, error: tgtErr } = await admin
            .from("profiles")
            .select("id, full_name, email, role, school_id")
            .eq("id", targetUserId).single();
        if (tgtErr || !target) return json({ error: "Target user not found" }, 404);

        // Centralised permission decision (covered by unit tests)
        const decision = evaluateDeletePermission(
            { id: caller.id, role: callerProfile.role, school_id: callerProfile.school_id },
            { id: target.id, role: target.role, school_id: target.school_id, email: target.email },
        );
        if (!decision.allowed) return json({ error: decision.reason }, decision.status);

        // Resolve expected confirmText: <schoolSlug>/<fullName>
        let schoolName: string | null = null;
        if (target.school_id) {
            const { data: school } = await admin
                .from("schools").select("name").eq("id", target.school_id).single();
            schoolName = school?.name ?? null;
        }
        const expected = expectedConfirmText(schoolName, target.full_name);
        if (confirmText !== expected)
            return json({ error: "Confirmation text does not match." }, 400);

        // If target is a student, guard against deleting active academic/financial records
        if (target.role === "student" && target.school_id) {
            const { data: eligibility, error: eligErr } = await admin.rpc(
                "fn_check_student_delete_eligibility",
                {
                    _school_id: target.school_id,
                    _student_id: targetUserId,
                },
            );
            if (eligErr) {
                return json({ error: `Failed to verify student deletion eligibility: ${eligErr.message}` }, 500);
            }
            if (eligibility && !eligibility.can_delete) {
                const reasonsList = (eligibility.reasons as string[] || []).join(", ");
                return json({
                    error: `Permanent deletion blocked: student has active records (${reasonsList}). To protect academic history, hard deletion is refused. Please mark the student as Withdrawn, Transferred, or Inactive instead.`,
                    eligibility,
                }, 400);
            }
        }

        // Hard delete from auth (profile + related rows cascade via FKs)
        const { error: delErr } = await admin.auth.admin.deleteUser(targetUserId);
        if (delErr) return json({ error: `Delete failed: ${delErr.message}` }, 400);

        // Best-effort: also delete profile row if it lingered without cascade
        await admin.from("profiles").delete().eq("id", targetUserId);

        // Canonical audit log
        await admin.from("admin_action_audit").insert({
            actor_id: caller.id,
            actor_role: callerProfile.role,
            school_id: target.school_id,
            target_user_id: targetUserId,
            action: target.role === "student" ? "student_hard_deleted" : "user_hard_deleted",
            detail: {
                target_name: target.full_name,
                target_email: target.email,
                target_role: target.role,
                school_id: target.school_id,
            },
            created_at: new Date().toISOString(),
        });

        return json({ success: true, deletedUserId: targetUserId }, 200);
    } catch (e: unknown) {
        return json({ error: e instanceof Error ? e.message : "Internal server error" }, 500);
    }
});
