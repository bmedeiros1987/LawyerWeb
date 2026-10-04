export class LocalAuthError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const invalidChallenge = () => new LocalAuthError("Link inválido ou expirado. Solicite um novo link.", 400);
export const invalidCredentials = () => new LocalAuthError("E-mail ou senha inválidos.", 401);
