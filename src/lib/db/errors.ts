export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Tentativa de acessar o modelo "${model}" (operação "${operation}") sem contexto de tenant. ` +
        `Todo acesso a dados tenant-scoped precisa passar por withTenant(...).`,
    );
    this.name = "MissingTenantContextError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Permissão negada.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}
