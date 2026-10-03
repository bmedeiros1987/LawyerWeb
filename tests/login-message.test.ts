import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "@/lib/login-message";

describe("login error display", () => {
  it("keeps the clean entry page free of an error", () => expect(loginErrorMessage()).toBeUndefined());
  it("explains denied access and existing account without suggesting a new account", () => {
    expect(loginErrorMessage("AccessDenied")).toContain("não foi autorizado");
    expect(loginErrorMessage("OAuthAccountNotLinked")).toContain("forma original");
  });
  it("does not echo arbitrary callback strings, tokens or markup", () => {
    expect(loginErrorMessage("<script>synthetic-secret</script>")).not.toContain("synthetic-secret");
  });
});
