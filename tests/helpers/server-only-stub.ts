/**
 * Substituto vazio do pacote `server-only` durante os testes.
 *
 * O `server-only` real lança ao ser importado fora de um Server Component,
 * o que é exatamente o que queremos em produção — e exatamente o que
 * impede o Vitest de importar `queries.ts` num teste de integração, que
 * roda em Node puro.
 *
 * Trocar o módulo pelo vazio nos testes não enfraquece a proteção: ela
 * continua valendo no build da aplicação, que é onde o erro importa.
 */
export {};
