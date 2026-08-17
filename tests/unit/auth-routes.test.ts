import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_PREFIXES,
  PUBLIC_PREFIXES,
  ROLE_HOME,
  ROUTE_RULES,
  matchesPrefix,
  ruleFor,
} from "@/lib/auth/routes";
import { isPermissionCode } from "@/lib/rbac/permissions";
import { ROLE_SLUGS, permissionsForRole } from "@/lib/rbac/roles";

describe("mapa de rotas", () => {
  it("toda permissão exigida existe no catálogo", () => {
    for (const rule of ROUTE_RULES) {
      if (rule.permission) {
        expect(isPermissionCode(rule.permission), rule.prefix).toBe(true);
      }
    }
  });

  it("casa a regra mais específica, não a primeira", () => {
    // /configuracoes/usuarios exige users.admin, não o settings.view do pai.
    expect(ruleFor("/configuracoes/usuarios")?.permission).toBe("users.admin");
    expect(ruleFor("/configuracoes/papeis")?.permission).toBe("roles.admin");
    expect(ruleFor("/configuracoes")?.permission).toBe("settings.view");
  });

  it("casa subcaminhos, mas não prefixos parciais de outro nome", () => {
    expect(ruleFor("/reservas/nova")?.permission).toBe("reservations.view");
    expect(ruleFor("/imoveis/abc-123")?.permission).toBe("properties.view");
    // "/imoveisx" não é subcaminho de "/imoveis".
    expect(ruleFor("/imoveisx")).toBeUndefined();
  });

  it("não cobre rota desconhecida", () => {
    expect(ruleFor("/inexistente")).toBeUndefined();
  });

  it("prefixos públicos casam a raiz e os subcaminhos", () => {
    expect(matchesPrefix("/login", PUBLIC_PREFIXES)).toBe(true);
    expect(matchesPrefix("/api/auth/callback/credentials", PUBLIC_PREFIXES)).toBe(true);
    expect(matchesPrefix("/stays/casa-vista-mar", PUBLIC_PREFIXES)).toBe(true);
    expect(matchesPrefix("/politicas/privacidade", PUBLIC_PREFIXES)).toBe(true);
    expect(matchesPrefix("/dashboard", PUBLIC_PREFIXES)).toBe(false);
    // Não pode vazar: /api/reservas não é público só por começar com /api.
    expect(matchesPrefix("/api/reservas", PUBLIC_PREFIXES)).toBe(false);
  });

  it("toda rota de auth também é pública — senão o login redirecionaria para si mesmo", () => {
    for (const prefix of AUTH_PREFIXES) {
      expect(matchesPrefix(prefix, PUBLIC_PREFIXES), prefix).toBe(true);
    }
  });

  it("todo papel tem uma home, e a home é acessível ao próprio papel", () => {
    for (const slug of ROLE_SLUGS) {
      const home = ROLE_HOME[slug];
      expect(home, slug).toBeTruthy();

      const rule = ruleFor(home);
      if (rule?.permission) {
        // Sem isto, o proxy redirecionaria o papel para uma home que ele
        // mesmo não pode ver — laço infinito de redirecionamento.
        expect(permissionsForRole(slug), `${slug} → ${home}`).toContain(
          rule.permission,
        );
      }
      if (rule?.roles) {
        expect(rule.roles, `${slug} → ${home}`).toContain(slug);
      }
    }
  });
});

describe("sincronia com docs/06-mapa-navegacao.md", () => {
  const doc = readFileSync(
    path.join(process.cwd(), "docs", "06-mapa-navegacao.md"),
    "utf8",
  );

  it("cada prefixo do código aparece na documentação", () => {
    for (const rule of ROUTE_RULES) {
      expect(doc, `${rule.prefix} não está em docs/06`).toContain(rule.prefix);
    }
  });

  it("cada permissão exigida aparece na documentação", () => {
    for (const rule of ROUTE_RULES) {
      if (rule.permission) {
        expect(doc, `${rule.permission} não está em docs/06`).toContain(
          rule.permission,
        );
      }
    }
  });
});
