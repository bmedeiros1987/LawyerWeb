import { google } from "googleapis";

export const GOOGLE_CALENDAR_SCOPES=[
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created"
];

export const GOOGLE_GMAIL_SCOPES=[
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly"
];

export function appUrl(){
  const v=process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/,"");
  if(!v) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  return v;
}

export const calendarRedirectUri=()=>`${appUrl()}/api/integrations/google-calendar/callback`;
export const gmailRedirectUri=()=>`${appUrl()}/api/integrations/google-gmail/callback`;

export function createGoogleOAuthClient(redirectUri = calendarRedirectUri()){
  const id=process.env.AUTH_GOOGLE_ID, secret=process.env.AUTH_GOOGLE_SECRET;
  if(!id||!secret) throw new Error("Google OAuth credentials are not configured");
  return new google.auth.OAuth2(id,secret,redirectUri);
}
