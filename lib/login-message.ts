export function loginErrorMessage(error?: string): string | undefined {
  if (!error) return undefined;
  if (error === "AccessDenied") return "O acesso não foi autorizado. Tente novamente com a conta que você usa neste escritório.";
  if (error === "OAuthAccountNotLinked") return "Este e-mail já está associado a outra forma de acesso. Use a forma original para entrar.";
  return "A tentativa de acesso não foi concluída. Tente novamente. Se o problema continuar, entre em contato com o administrador do escritório.";
}
