import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_CODES,
  isPermissionCode,
  describePermission,
} from "@/lib/rbac/permissions";
import { ROLE_SLUGS, SYSTEM_ROLES, permissionsForRole } from "@/lib/rbac/roles";

/**
 * O catálogo de permissões vive em três lugares (tipos, seed do banco e
 * docs/07-matriz-permissoes.md). Estes testes existem para que os três não
 * se soltem em silêncio — o modo clássico de um RBAC apodrecer.
 */
describe("catálogo de permissões", () => {
  it("todo código tem o formato modulo.acao e é reconhecido", () => {
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(isPermissionCode(code)).toBe(true);
    }
  });

  it("não tem códigos duplicados", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });

  it("rejeita códigos inexistentes", () => {
    expect(isPermissionCode("reservations.destroy")).toBe(false);
    expect(isPermissionCode("audit.create")).toBe(false);
    expect(isPermissionCode("")).toBe(false);
  });

  it("toda permissão tem descrição em pt-BR", () => {
    for (const code of PERMISSION_CODES) {
      const desc = describePermission(code);
      expect(desc.length).toBeGreaterThan(3);
      expect(desc).not.toContain("undefined");
    }
  });
});

describe("papéis de sistema", () => {
  it("todo papel só concede permissões que existem no catálogo", () => {
    for (const slug of ROLE_SLUGS) {
      for (const code of permissionsForRole(slug)) {
        expect(
          isPermissionCode(code),
          `papel "${slug}" concede permissão inexistente: "${code}"`,
        ).toBe(true);
      }
    }
  });

  it("nenhum papel repete a mesma permissão", () => {
    for (const slug of ROLE_SLUGS) {
      const perms = permissionsForRole(slug);
      expect(new Set(perms).size, `papel "${slug}" tem duplicatas`).toBe(
        perms.length,
      );
    }
  });

  it("company_admin detém TODAS as permissões do catálogo", () => {
    // Invariante do RBAC: uma empresa não pode conceder o que ela própria
    // não tem, então o admin precisa ser o superconjunto (docs/07).
    const admin = new Set<string>(SYSTEM_ROLES.company_admin);
    const faltando = PERMISSION_CODES.filter((c) => !admin.has(c));
    expect(faltando, `company_admin não tem: ${faltando.join(", ")}`).toEqual(
      [],
    );
  });

  it("papéis de campo não enxergam financeiro nem configurações", () => {
    for (const slug of ["cleaning_staff", "maintenance_staff"] as const) {
      const perms = permissionsForRole(slug) as readonly string[];
      expect(perms.some((p) => p.startsWith("payments."))).toBe(false);
      expect(perms.some((p) => p.startsWith("settings."))).toBe(false);
      expect(perms.some((p) => p.startsWith("users."))).toBe(false);
    }
  });

  it("hóspede não tem nenhuma permissão de escrita", () => {
    for (const p of permissionsForRole("guest") as readonly string[]) {
      expect(p.endsWith(".view")).toBe(true);
    }
  });

  it("só company_admin administra papéis, usuários e configurações", () => {
    for (const slug of ROLE_SLUGS) {
      if (slug === "company_admin") continue;
      const perms = permissionsForRole(slug) as readonly string[];
      expect(perms).not.toContain("roles.admin");
      expect(perms).not.toContain("users.admin");
      expect(perms).not.toContain("settings.admin");
    }
  });

  it("todo papel de sistema aparece em docs/07-matriz-permissoes.md", () => {
    const doc = readFileSync(
      path.join(process.cwd(), "docs", "07-matriz-permissoes.md"),
      "utf8",
    );
    for (const slug of ROLE_SLUGS) {
      expect(doc, `papel "${slug}" não documentado`).toContain(slug);
    }
  });
});
