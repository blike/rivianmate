import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, passwordProblem } from "./password-policy.js";

describe("passwordProblem", () => {
  it("accepts long, unpredictable passwords and passphrases", () => {
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(passwordProblem("Tr4il-mix-Moab-gravel")).toBeNull();
    expect(passwordProblem("k9#vQ2!mZp7&xW")).toBeNull();
  });

  it("requires a minimum and maximum length", () => {
    expect(passwordProblem("Xk9#vQ2!mZp")).toMatch(/at least 12/);
    expect(passwordProblem("a1b2c3d4e5f6".repeat(11))).toMatch(/at most/);
    expect(passwordProblem("x".repeat(PASSWORD_MAX_LENGTH))).not.toMatch(/at most/);
  });

  it("rejects low-variety passwords", () => {
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/wider mix/);
    expect(passwordProblem("abababababababab")).toMatch(/wider mix/);
  });

  it("rejects common words, the app name, and sequences", () => {
    for (const weak of [
      "rivianmate2024!",
      "RivianMate1234",
      "Password12345!",
      "qwertyuiop1234",
      "123456789012",
      "abcdefghijklmn",
      "letmein!!letmein",
      "iloveyou1111!!",
    ]) {
      expect(passwordProblem(weak), weak).toMatch(/easy to guess/);
    }
  });
});
