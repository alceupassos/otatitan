import NextAuth from "next-auth";
import { authConfig } from "./config";

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: updateSession,
} = NextAuth(authConfig);

export { SIGNIN_ERRORS, type SignInErrorCode } from "./errors";
