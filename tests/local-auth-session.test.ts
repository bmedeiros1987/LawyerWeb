import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), local: vi.fn(), google: vi.fn(), revoke: vi.fn() }));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: state.google, signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined, set: vi.fn() }) }));
vi.mock("@/lib/local-auth/service", () => ({ readLocalSession: state.local, revokeLocalSession: state.revoke }));
import { auth } from "@/auth";
beforeEach(() => { state.cookies.clear(); vi.clearAllMocks(); });
it("keeps Google database auth without a local cookie", async () => {
  state.cookies.set("authjs.session-token", "synthetic"); state.google.mockResolvedValue({ user: { id: "google" } });
  expect((await auth())?.user.id).toBe("google"); expect(state.local).not.toHaveBeenCalled();
});
it("rejects conflicting identities instead of silently switching accounts", async () => {
  state.cookies.set("lawyermind.session", "synthetic"); state.cookies.set("authjs.session-token", "synthetic");
  state.local.mockResolvedValue({ user: { id: "local" } }); state.google.mockResolvedValue({ user: { id: "other" } });
  expect(await auth()).toBeNull();
});
it("does not fall back to Google after an invalid or expired local session", async () => {
  state.cookies.set("lawyermind.session", "expired"); state.cookies.set("authjs.session-token", "synthetic"); state.local.mockResolvedValue(null);
  expect(await auth()).toBeNull(); expect(state.google).not.toHaveBeenCalled();
});
it("allows same-user coexistence and local-only sessions", async () => {
  state.cookies.set("lawyermind.session", "synthetic"); state.local.mockResolvedValue({ user: { id: "local" } });
  expect((await auth())?.user.id).toBe("local"); state.cookies.set("authjs.session-token", "synthetic"); state.google.mockResolvedValue({ user: { id: "local" } });
  expect((await auth())?.user.id).toBe("local");
});
