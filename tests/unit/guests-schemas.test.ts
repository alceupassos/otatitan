import { describe, expect, it } from "vitest";
import {
  hospedeSchema,
  nomeCompleto,
  normalizarDocumento,
  normalizarTelefone,
  ultimosQuatro,
  validarCpf,
} from "@/lib/guests/schemas";

const HOSPEDE_OK = {
  firstName: "Ana Paula",
  lastName: "Souza",
  email: "Ana.Souza@Exemplo.com ",
  phone: "(21) 99999-1234",
  documentType: "CPF",
  documentNumber: "529.982.247-25",
  birthDate: "1990-03-10",
  nationality: "Brasileira",
  country: "br",
  notes: "",
};

/** Mensagens de um campo, para checar o texto sem depender da ordem. */
function mensagens(dados: Record<string, unknown>, campo: string): string[] {
  const r = hospedeSchema.safeParse(dados);
  if (r.success) return [];
  return r.error.issues.filter((i) => i.path[0] === campo).map((i) => i.message);
}

describe("hospedeSchema", () => {
  it("aceita uma ficha completa e normaliza os campos", () => {
    const r = hospedeSchema.safeParse(HOSPEDE_OK);
    expect(r.success).toBe(true);
    if (!r.success) return;

    expect(r.data.email).toBe("ana.souza@exemplo.com");
    expect(r.data.phone).toBe("+5521999991234");
    expect(r.data.country).toBe("BR");
    // O documento sai em forma canônica, pronto para cifrar.
    expect(r.data.documentNumber).toBe("52998224725");
    expect(r.data.birthDate?.toISOString().slice(0, 10)).toBe("1990-03-10");
  });

  it("aceita a ficha mínima que a reserva de balcão consegue preencher", () => {
    const r = hospedeSchema.safeParse({ firstName: "Ana", lastName: "Souza" });
    expect(r.success).toBe(true);
    if (!r.success) return;

    expect(r.data.email).toBeNull();
    expect(r.data.phone).toBeNull();
    expect(r.data.documentType).toBeNull();
    expect(r.data.documentNumber).toBeNull();
    expect(r.data.birthDate).toBeNull();
    // País é NOT NULL no banco e assume Brasil quando ninguém informa.
    expect(r.data.country).toBe("BR");
  });

  it("exige nome e sobrenome, com mensagem em português", () => {
    expect(mensagens({ ...HOSPEDE_OK, firstName: " " }, "firstName")).toContain(
      "Informe o nome do hóspede.",
    );
    expect(mensagens({ ...HOSPEDE_OK, lastName: "" }, "lastName")).toContain(
      "Informe o sobrenome do hóspede.",
    );
  });

  it("recusa e-mail inválido com mensagem em português", () => {
    for (const email of ["ana", "ana@", "@exemplo.com", "ana souza@exemplo.com"]) {
      expect(mensagens({ ...HOSPEDE_OK, email }, "email"), email).toContain(
        "Informe um e-mail válido.",
      );
    }
  });

  it("trata e-mail em branco como não informado", () => {
    const r = hospedeSchema.safeParse({ ...HOSPEDE_OK, email: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBeNull();
  });

  it("recusa data de nascimento no futuro", () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(mensagens({ ...HOSPEDE_OK, birthDate: amanha }, "birthDate")).toContain(
      "A data de nascimento precisa estar no passado.",
    );
  });

  it("recusa data de nascimento inexistente ou fora de escala humana", () => {
    expect(
      hospedeSchema.safeParse({ ...HOSPEDE_OK, birthDate: "1990-02-31" }).success,
    ).toBe(false);
    expect(
      hospedeSchema.safeParse({ ...HOSPEDE_OK, birthDate: "1092-03-10" }).success,
    ).toBe(false);
  });

  it("recusa CPF com dígito verificador errado", () => {
    expect(
      mensagens({ ...HOSPEDE_OK, documentNumber: "529.982.247-26" }, "documentNumber"),
    ).toContain("CPF inválido.");
  });

  it("aceita passaporte alfanumérico sem passar pela regra do CPF", () => {
    const r = hospedeSchema.safeParse({
      ...HOSPEDE_OK,
      documentType: "PASSPORT",
      documentNumber: "fx-123456",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.documentNumber).toBe("FX123456");
  });

  it("exige tipo e número do documento juntos", () => {
    expect(
      mensagens({ ...HOSPEDE_OK, documentType: "" }, "documentType"),
    ).toContain("Selecione o tipo do documento.");
    expect(
      mensagens({ ...HOSPEDE_OK, documentNumber: "" }, "documentNumber"),
    ).toContain("Informe o número do documento.");
  });

  it("recusa telefone que não é telefone", () => {
    for (const phone of ["1234", "(21) 8888-123", "00 99999-1234"]) {
      expect(mensagens({ ...HOSPEDE_OK, phone }, "phone").length, phone).toBeGreaterThan(
        0,
      );
    }
  });

  it("recusa sigla de país que não tem duas letras", () => {
    expect(
      mensagens({ ...HOSPEDE_OK, country: "Brasil" }, "country"),
    ).toContain("Use a sigla de duas letras do país, ex.: BR.");
  });

  it("nunca marca o opt-in de marketing por conta própria", () => {
    const semCampo = hospedeSchema.safeParse(HOSPEDE_OK);
    expect(semCampo.success && semCampo.data.marketingOptIn).toBe(false);

    // Checkbox desmarcado nem chega no FormData; marcado chega como "on".
    const marcado = hospedeSchema.safeParse({ ...HOSPEDE_OK, marketingOptIn: "on" });
    expect(marcado.success && marcado.data.marketingOptIn).toBe(true);

    const vazio = hospedeSchema.safeParse({ ...HOSPEDE_OK, marketingOptIn: "" });
    expect(vazio.success && vazio.data.marketingOptIn).toBe(false);
  });
});

describe("normalizarTelefone", () => {
  it("leva o formato brasileiro para E.164", () => {
    expect(normalizarTelefone("(21) 99999-1234")).toBe("+5521999991234");
    expect(normalizarTelefone("21 3333-4444")).toBe("+552133334444");
    expect(normalizarTelefone("5521999991234")).toBe("+5521999991234");
    expect(normalizarTelefone("+55 (21) 99999-1234")).toBe("+5521999991234");
  });

  it("preserva número internacional informado com +", () => {
    expect(normalizarTelefone("+351 912 345 678")).toBe("+351912345678");
  });

  it("recusa DDD com zero e celular sem o nono dígito", () => {
    expect(normalizarTelefone("(01) 99999-1234")).toBeNull();
    expect(normalizarTelefone("21 89999-1234")).toBeNull();
  });

  it("recusa quantidade de dígitos que não forma telefone", () => {
    expect(normalizarTelefone("999")).toBeNull();
    expect(normalizarTelefone("219999912345678")).toBeNull();
  });
});

describe("validarCpf", () => {
  it("aceita CPF com dígitos verificadores corretos", () => {
    expect(validarCpf("529.982.247-25")).toBe(true);
    expect(validarCpf("52998224725")).toBe(true);
  });

  it("recusa dígito verificador errado, tamanho errado e sequência repetida", () => {
    expect(validarCpf("529.982.247-26")).toBe(false);
    expect(validarCpf("5299822472")).toBe(false);
    expect(validarCpf("111.111.111-11")).toBe(false);
  });
});

describe("normalizarDocumento e ultimosQuatro", () => {
  it("reduz CPF a dígitos e demais documentos a alfanumérico maiúsculo", () => {
    expect(normalizarDocumento("CPF", "529.982.247-25")).toBe("52998224725");
    expect(normalizarDocumento("RG", "12.345.678-x")).toBe("12345678X");
    expect(normalizarDocumento("PASSPORT", " fx 123456 ")).toBe("FX123456");
  });

  it("expõe só o final do documento — o resto vai cifrado", () => {
    expect(ultimosQuatro("52998224725")).toBe("4725");
  });
});

describe("nomeCompleto", () => {
  it("junta nome e sobrenome para exibição", () => {
    expect(nomeCompleto({ firstName: "Ana Paula", lastName: "Souza" })).toBe(
      "Ana Paula Souza",
    );
  });
});
