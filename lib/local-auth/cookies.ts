export const localCookieName = () => process.env.NODE_ENV === "production" ? "__Host-lawyermind.session" : "lawyermind.session";
export const googleCookieNames = ["authjs.session-token", "__Secure-authjs.session-token"];
export const localCookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" });
