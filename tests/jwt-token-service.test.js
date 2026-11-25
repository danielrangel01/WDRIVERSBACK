import { describe, it, expect } from "vitest";
import { JwtTokenService } from "../src/infrastructure/security/JwtTokenService.js";

describe("JWT access and refresh tokens", () => {
  it("separa los tokens de acceso de los tokens de renovación", () => {
    const tokens = new JwtTokenService("test-secret", "12h", "90d");
    const claims = { id: "user-1", username: "admin" };
    const accessToken = tokens.sign(claims);
    const refreshToken = tokens.signRefresh(claims);

    expect(tokens.verify(accessToken).tokenUse).toBe("access");
    expect(tokens.verifyRefresh(refreshToken).tokenUse).toBe("refresh");
    expect(() => tokens.verifyRefresh(accessToken)).toThrow(/renovación inválido/);
  });

  it("asigna al refresh token una vigencia mayor que la de acceso", () => {
    const tokens = new JwtTokenService("test-secret", "12h", "90d");
    const access = tokens.verify(tokens.sign({ id: "user-1" }));
    const refresh = tokens.verify(tokens.signRefresh({ id: "user-1" }));

    expect(refresh.exp - refresh.iat).toBeGreaterThan(access.exp - access.iat);
  });
});
